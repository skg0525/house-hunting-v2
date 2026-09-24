/**
 * What else is on this street, and what it is really going for.
 *
 * An asking price on its own says nothing. What says something is the eight
 * houses around it: how many have cut, by how much, and how long they have sat.
 * Two sales in one Toll Brothers community went for -18.9% and -6.6% off their
 * first ask, and neither number is visible from the listing of the house next
 * door that is still for sale.
 *
 * Redfin's map search reliably returns ACTIVE and COMING SOON homes. Its sold
 * filters are ignored no matter how they are passed, so sold prices come from
 * each home's own price history instead — the same endpoint used for the
 * subject property, called for a handful of the closest comparables rather than
 * all fifty, because each one is a request and we are a guest here.
 *
 * Coming Soon is worth as much as the rest put together for new construction:
 * it is the inventory that is finished but not yet marketed, which is precisely
 * what he could not find by browsing.
 */
import { fetchPriceHistory } from './priceHistory.js';
import { metresBetween } from './orientation.js';

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STORE_DIR } from '../paths.js';
import { spend } from './rateBudget.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

export interface Comp {
  address: string;
  url: string;
  price: number;
  sqft: number;
  pricePerSqft: number;
  beds: number;
  baths: number;
  yearBuilt: number;
  lotSqft: number;
  status: string;
  daysOnMarket?: number;
  metresAway: number;
  isNewConstruction: boolean;
  /** Filled for the few we look up in detail. */
  firstListPrice?: number;
  cutPct?: number;
  soldPrice?: number;
}

/**
 * A nearby house worth actually looking at.
 *
 * The bar is deliberately high. Ten suggestions is noise and gets ignored; one
 * or two that clearly beat the house you are already reading is worth the
 * interruption. So this only surfaces homes that pass every cheap filter AND
 * beat the subject on something concrete — and it says which, because "you
 * might like this" is not a reason to spend a Saturday.
 */
export interface Suggestion {
  comp: Comp;
  reasons: string[];
}

export interface MarketRead {
  comps: Comp[];
  comingSoon: Comp[];
  medianPricePerSqft?: number;
  /** How many of the nearby actives have already cut, and by how much. */
  cutting?: { count: number; of: number; averagePct: number };
  summary: string;
  available: boolean;
  suggestions: Suggestion[];
}

/**
 * Screen nearby homes on what a listing record can tell us for free.
 *
 * These are not scored — scoring means geocoding, satellite tiles and a vision
 * pass, which is real money per house and would be spent on homes that fail on
 * price anyway. This is the cheap pass that decides which are worth that spend.
 */
function screen(
  pool: Comp[],
  subject: { price: number; sqft: number; yearBuilt: number; lotSqft: number },
  budget: { maxPrice: number; minYearBuilt: number; minLotAcres: number },
  medianPpsf?: number,
): Suggestion[] {
  const out: Suggestion[] = [];

  for (const c of pool) {
    if (/coming soon/i.test(c.status)) continue;

    /* Hard filters first. A house over budget or older than the cutoff is not a
       suggestion however good it looks. */
    if (c.price > budget.maxPrice) continue;
    if (c.yearBuilt && c.yearBuilt < budget.minYearBuilt) continue;
    if (c.beds && c.beds < 4) continue;
    if (c.lotSqft && c.lotSqft < budget.minLotAcres * 43_560) continue;

    const reasons: string[] = [];

    if (subject.price && c.price <= subject.price * 0.94)
      reasons.push(`$${(subject.price - c.price).toLocaleString()} cheaper`);

    if (medianPpsf && c.pricePerSqft && c.pricePerSqft <= medianPpsf * 0.9)
      reasons.push(`${Math.round((1 - c.pricePerSqft / medianPpsf) * 100)}% under the local $/sq ft`);

    if (subject.sqft && c.sqft >= subject.sqft * 1.12)
      reasons.push(`${Math.round(c.sqft - subject.sqft).toLocaleString()} sq ft larger`);

    if (subject.yearBuilt && c.yearBuilt >= subject.yearBuilt + 8)
      reasons.push(`${c.yearBuilt - subject.yearBuilt} years newer`);

    if (subject.lotSqft && c.lotSqft >= subject.lotSqft * 1.3)
      reasons.push(`${(c.lotSqft / 43_560).toFixed(2)} acre lot`);

    if ((c.cutPct ?? 0) >= 5)
      reasons.push(`already cut ${c.cutPct!.toFixed(0)}%, so there is room`);

    /* Two independent advantages, not one. A house that is merely cheaper is
       usually cheaper for a reason, and one bullet point is not worth a drive. */
    if (reasons.length >= 2) {
      reasons.push(
        `${(c.metresAway / 1609).toFixed(1)} miles away in a straight line — ` +
        `further by road, since these streets wind`,
      );
      out.push({ comp: c, reasons });
    }
  }

  return out
    .sort((a, b) => b.reasons.length - a.reasons.length || a.comp.price - b.comp.price)
    .slice(0, 3);
}

async function gis(coords: { lat: number; lng: number }, boxDeg: number): Promise<any[]> {
  const d = boxDeg;
  const pts: [number, number][] = [
    [coords.lng - d, coords.lat - d], [coords.lng + d, coords.lat - d],
    [coords.lng + d, coords.lat + d], [coords.lng - d, coords.lat + d],
    [coords.lng - d, coords.lat - d],
  ];
  const q = new URLSearchParams({
    al: '1', market: 'atlanta', num_homes: '50', ord: 'redfin-recommended-asc',
    page_number: '1', poly: pts.map(([x, y]) => `${x.toFixed(6)} ${y.toFixed(6)}`).join(','),
    sf: '1,2,3,5,6,7', uipt: '1', v: '8',
  });

  spend();
  const res = await fetch(`https://www.redfin.com/stingray/api/gis?${q}`, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      Referer: 'https://www.redfin.com/',
      ...(process.env.REDFIN_COOKIE ? { Cookie: process.env.REDFIN_COOKIE } : {}),
    },
  });
  if (!res.ok) return [];

  const raw = await res.text();
  const i = raw.indexOf('&&');
  if (i === -1) return [];
  try {
    const j = JSON.parse(raw.slice(i + 2));
    return j?.resultCode === 0 ? (j.payload?.homes ?? []) : [];
  } catch {
    return [];
  }
}

const val = (h: any, k: string) => (h?.[k] && typeof h[k] === 'object' ? h[k].value : h?.[k]);

/**
 * The market read, kept on disk for a week.
 *
 * This is the single most expensive thing in a scan and nothing said so. It
 * costs about seven listing-site requests — a map search, then a price history
 * for each comparable — and it runs for every house he has marked to tour or
 * shortlisted. Twenty marked houses turned an ordinary scan into a hundred and
 * forty-seven requests, which is a whole hour's allowance spent on comparables
 * that had not changed since the last scan an hour earlier.
 *
 * A week is the right window. Comparable sales move on the timescale of
 * closings, not minutes, and a stale median is a far smaller error than an
 * exhausted budget that stops him adding the house he just found.
 */
const MARKET_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MARKET_FILE = join(STORE_DIR, 'market-cache.json');

type MarketCache = Record<string, { at: number; read: MarketRead }>;

async function loadMarketCache(): Promise<MarketCache> {
  try { return JSON.parse(await readFile(MARKET_FILE, 'utf8')) as MarketCache; }
  catch { return {}; }
}

export async function readMarket(
  coords: { lat: number; lng: number },
  subject: { sqft: number; price: number; url: string; yearBuilt?: number; lotSqft?: number },
  budget?: { maxPrice: number; minYearBuilt: number; minLotAcres: number },
  opts?: { fresh?: boolean },
): Promise<MarketRead> {
  /* Keyed on the things that would change the answer: where, how big, and what
     it is being asked. A price cut re-reads; a re-scan does not. */
  const key = `${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}|${subject.sqft}|${subject.price}`;
  const cache = await loadMarketCache();
  const hit = cache[key];
  if (!opts?.fresh && hit && Date.now() - hit.at < MARKET_TTL_MS) return hit.read;

  const fresh = await readMarketUncached(coords, subject, budget);
  try {
    cache[key] = { at: Date.now(), read: fresh };
    await mkdir(STORE_DIR, { recursive: true });
    await writeFile(MARKET_FILE, JSON.stringify(cache));
  } catch { /* the read still works; losing the cache is not fatal */ }
  return fresh;
}

async function readMarketUncached(
  coords: { lat: number; lng: number },
  subject: { sqft: number; price: number; url: string; yearBuilt?: number; lotSqft?: number },
  budget?: { maxPrice: number; minYearBuilt: number; minLotAcres: number },
): Promise<MarketRead> {
  /* Roughly a mile and a quarter. Wide enough to find eight comparables in a
     subdivision, tight enough that they are the same market. */
  const homes = await gis(coords, 0.018);
  if (!homes.length)
    return {
      comps: [], comingSoon: [], suggestions: [],
      summary: 'No nearby listings could be read.', available: false,
    };

  const mapped: Comp[] = homes.map((h) => {
    const price = Number(val(h, 'price')) || 0;
    const sqft = Number(val(h, 'sqFt')) || 0;
    const ll = h.latLong?.value ?? h.latLong ?? {};
    return {
      address: `${val(h, 'streetLine') ?? ''}, ${h.city ?? ''}`.replace(/^, /, ''),
      url: h.url ? `https://www.redfin.com${h.url}` : '',
      price, sqft,
      pricePerSqft: sqft ? Math.round(price / sqft) : 0,
      beds: Number(val(h, 'beds')) || 0,
      baths: Number(val(h, 'baths')) || 0,
      yearBuilt: Number(val(h, 'yearBuilt')) || 0,
      lotSqft: Number(val(h, 'lotSize')) || 0,
      status: String(h.mlsStatus ?? 'Active'),
      daysOnMarket: typeof val(h, 'dom') === 'number' ? val(h, 'dom') : undefined,
      metresAway: Number.isFinite(ll.latitude)
        ? Math.round(metresBetween(coords, { lat: ll.latitude, lng: ll.longitude }))
        : 0,
      isNewConstruction: Boolean(h.isNewConstruction),
    };
  }).filter((c) => c.price > 0 && c.url && !c.url.includes(subject.url));

  const comingSoon = mapped.filter((c) => /coming soon/i.test(c.status));
  const active = mapped.filter((c) => !/coming soon/i.test(c.status));

  /* Comparable means similar size, not merely nearby. A 6,000 sq ft estate two
     streets over prices nothing about a 3,600 sq ft house. */
  const similar = subject.sqft
    ? active.filter((c) => c.sqft >= subject.sqft * 0.7 && c.sqft <= subject.sqft * 1.35)
    : active;

  /* Distance caps, which were missing entirely.
   *
   * Redfin's map search ignores the bounding box it is given, so without a cap
   * of our own the "nearby" list stretched past three miles — which in these
   * subdivisions is a different school, a different HOA and a different market.
   *
   * Straight-line, and the difference matters here: 1.8 miles as the crow flies
   * was 4.9 by road, because the streets wind. So the distance is shown in the
   * UI rather than left implicit. */
  /* Two different jobs, two different radii. Reading the market wants a
     handful of comparables and tolerates a wider net; suggesting an
     alternative house has to be somewhere he would genuinely consider, which
     is much closer. */
  const COMP_MAX_M = 3_200;      // ~2 miles: enough comparables to see a median
  const SUGGEST_MAX_M = 1_600;   // ~1 mile: close enough to be the same decision

  const pool = (similar.length >= 4 ? similar : active)
    .filter((c) => c.metresAway > 0 && c.metresAway <= COMP_MAX_M)
    .sort((a, b) => a.metresAway - b.metresAway)
    .slice(0, 12);

  const ppsf = pool.map((c) => c.pricePerSqft).filter(Boolean).sort((a, b) => a - b);
  const medianPricePerSqft = ppsf.length ? ppsf[Math.floor(ppsf.length / 2)] : undefined;

  /* Look up the price story for the six closest. Each is a request, so the
     number is a budget rather than a preference. */
  const detailed = pool.slice(0, 6);


  const cut = detailed.filter((c) => (c.cutPct ?? 0) > 0.5);
  const cutting = detailed.length
    ? {
        count: cut.length,
        of: detailed.length,
        averagePct: cut.length ? cut.reduce((s, c) => s + (c.cutPct ?? 0), 0) / cut.length : 0,
      }
    : undefined;

  const parts: string[] = [];
  if (medianPricePerSqft && subject.sqft && subject.price) {
    const mine = Math.round(subject.price / subject.sqft);
    const gap = ((mine - medianPricePerSqft) / medianPricePerSqft) * 100;
    parts.push(
      `Asking $${mine}/sq ft against a neighbourhood median of $${medianPricePerSqft} — ` +
      `${Math.abs(gap).toFixed(0)}% ${gap > 0 ? 'above' : 'below'} the homes around it`,
    );
  }
  if (cutting?.count)
    parts.push(
      `${cutting.count} of the ${cutting.of} closest comparables have already cut, ` +
      `by ${cutting.averagePct.toFixed(1)}% on average`,
    );
  if (comingSoon.length)
    parts.push(`${comingSoon.length} more coming to market shortly`);

  const suggestions = budget
    ? screen(
        detailed.filter((c) => c.metresAway <= SUGGEST_MAX_M),
        {
          price: subject.price, sqft: subject.sqft,
          yearBuilt: subject.yearBuilt ?? 0, lotSqft: subject.lotSqft ?? 0,
        },
        budget,
        medianPricePerSqft,
      )
    : [];

  if (suggestions.length)
    parts.push(
      `${suggestions.length} nearby ${suggestions.length === 1 ? 'home looks' : 'homes look'} like a better buy`,
    );

  return {
    comps: pool,
    comingSoon,
    suggestions,
    medianPricePerSqft,
    cutting,
    available: true,
    summary: parts.length ? parts.join('. ') + '.' : 'Not enough comparable sales nearby to read the market.',
  };
}
