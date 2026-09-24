/**
 * One polite fetch per listing page, cached.
 *
 * Redfin started refusing us partway through an afternoon. It does not answer
 * 403 or 429 — it answers **202 with a zero-length body**, which a naive parser
 * reads as "this listing has no floor plan". A wrong answer dressed as a
 * finding, which is the failure this codebase keeps stamping out.
 *
 * There is no consumer API to move to. Redfin's Data Center publishes bulk
 * market statistics, not per-listing detail, and Zillow's API is for brokers
 * with a signed agreement. So the only honest lever is asking less often:
 *
 *   - one fetch per listing, cached on disk for a day
 *   - a pause between fetches, so a scan of ten houses is not ten rapid hits
 *   - a single retry after a real wait, then give up and say so
 *
 * If a browser session cookie is supplied, it is sent. A logged-in session is
 * treated far more generously than an anonymous one, which is the actual reason
 * the same page loads fine in a browser tab and fails here.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { STORE_DIR } from '../paths.js';
import { spend } from './rateBudget.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

const CACHE_DIR = join(STORE_DIR, 'pages');

/**
 * Thirty days, not one.
 *
 * A day was arbitrary and expensive: re-fetching sixty-seven pages to relearn
 * a floor plan, a lot size and a year of construction is sixty-seven requests
 * spent on facts that cannot change. The things that DO change — price, status,
 * open houses — are refreshed on demand for the handful of houses actually
 * being watched, which is a few requests instead of all of them.
 */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Gap between two fetches to the same host. */
const POLITE_GAP_MS = 4_000;
let lastFetchAt = 0;

export class RateLimited extends Error {
  constructor(public readonly host: string) {
    super(
      `${host} is rate-limiting us. It answers with an empty page rather than an ` +
      `error, so nothing can be read from it right now. Wait an hour, or save the ` +
      `floor plan from the listing yourself and drop it on the house.`,
    );
    this.name = 'RateLimited';
  }
}

const cacheFile = (url: string) =>
  join(CACHE_DIR, `${createHash('sha1').update(url).digest('hex').slice(0, 16)}.html`);

async function readCache(url: string): Promise<string | null> {
  try {
    const path = cacheFile(url);
    const raw = await readFile(path, 'utf8');
    const [stamp, ...rest] = raw.split('\n');
    if (Date.now() - Number(stamp) > MAX_AGE_MS) return null;
    return rest.join('\n');
  } catch {
    return null;
  }
}

async function writeCache(url: string, html: string) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cacheFile(url), `${Date.now()}\n${html}`);
  } catch { /* a cache miss is not worth failing a scan over */ }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Browser cookies for the listing site, if the user chose to supply them.
 *
 * Optional, and deliberately not required for anything. A signed-in session is
 * why the same page opens fine in a browser tab while this gets refused.
 */
function cookieHeader(host: string): Record<string, string> {
  const jar = host.includes('zillow') ? process.env.ZILLOW_COOKIE : process.env.REDFIN_COOKIE;
  return jar ? { Cookie: jar } : {};
}

async function attempt(url: string): Promise<string> {
  const host = new URL(url).hostname.replace(/^www\./, '');

  /* Budget first, then the gap. Being slow about five hundred requests is
     still five hundred requests. */
  spend();

  const wait = POLITE_GAP_MS - (Date.now() - lastFetchAt);
  if (wait > 0) await sleep(wait);
  lastFetchAt = Date.now();

  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Upgrade-Insecure-Requests': '1',
      ...cookieHeader(host),
    },
    redirect: 'follow',
  });

  const body = await res.text();

  /* The tell: a 202, or a body far too short to be a listing page. */
  if (res.status === 202 || body.trim().length < 2000) throw new RateLimited(host);
  if (!res.ok) throw new Error(`${host} returned ${res.status}.`);
  return body;
}

/** Throw away the cached page for one URL, so the next read fetches it. */
export async function forgetCachedPage(url: string): Promise<void> {
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(cacheFile(url));
  } catch { /* not cached is the desired end state either way */ }
}

/** Is this page already on disk and still fresh? Lets callers avoid a fetch. */
export async function hasCachedPage(url: string): Promise<boolean> {
  return (await readCache(url)) !== null;
}

export async function fetchListingPage(url: string, opts?: { fresh?: boolean }): Promise<string> {
  /* `fresh` is for the price-and-status check, which is the only thing worth
     paying a request for on a house already read. */
  const cached = opts?.fresh ? null : await readCache(url);
  if (cached) return cached;

  try {
    const html = await attempt(url);
    await writeCache(url, html);
    return html;
  } catch (err) {
    if (!(err instanceof RateLimited)) throw err;

    /* One retry, after a wait long enough to be worth making. Hammering a
       block is how a soft block becomes a hard one. */
    await sleep(8_000);
    const html = await attempt(url);
    await writeCache(url, html);
    return html;
  }
}
