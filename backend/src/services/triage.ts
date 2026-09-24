/**
 * The fast pass: which of these can I stop thinking about?
 *
 * After six weeks of searching, 100 favourites and 40 open tabs, the useful
 * question is not "score everything" — it is "which of these are already out".
 * And the answer to that is cheap, because the one rule he is certain of needs
 * nothing but an address:
 *
 *   geocode the address, find the nearest Street View camera, take the bearing.
 *
 * No listing page, so no rate limit. No floor plan, so no vision call. About a
 * cent a house and a couple of seconds, run wide.
 *
 * Everything expensive — reading plans, aerials, census, comps — waits until
 * the list is short enough to be worth it. That is the whole point: spend the
 * effort on the twenty that survive, not the hundred and forty that don't.
 */
import { resolveOrientation, geocode } from './orientation.js';
import { parsePastedUrls } from './listingStore.js';
import { CardinalDirection } from '../types/listing.js';

export interface TriageResult {
  url: string;
  address: string;
  site: string;
  facing: CardinalDirection;
  bearingDeg: number | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  /** 'out' only when the measurement is good enough to act on. */
  verdict: 'out' | 'check yourself' | 'keep';
  why: string;
}

export interface TriageSummary {
  results: TriageResult[];
  out: number;
  keep: number;
  checkYourself: number;
  failed: number;
}

/** A few at a time. Geocoding is fast but the quota is shared with everything else. */
const CONCURRENCY = 6;

export async function triage(
  pastedText: string,
  onProgress?: (done: number, total: number) => void,
): Promise<TriageSummary> {
  const parsed = parsePastedUrls(pastedText);
  const results: TriageResult[] = [];
  let done = 0;

  const one = async (p: ReturnType<typeof parsePastedUrls>[number]): Promise<TriageResult> => {
    const address = p.addressGuess ?? '';
    if (!address) {
      return {
        url: p.url, address: '', site: p.site,
        facing: 'Unknown', bearingDeg: null, confidence: 'none',
        verdict: 'check yourself',
        why: 'No address in that link, so it could not be placed.',
      };
    }

    const g = await geocode(address).catch(() => null);
    const o = await resolveOrientation(address, g?.coords, g?.locationType).catch(() => null);

    if (!o || o.confidence === 'none') {
      return {
        url: p.url, address: g?.formatted ?? address, site: p.site,
        facing: 'Unknown', bearingDeg: null, confidence: 'none',
        verdict: 'check yourself',
        why: o?.method ?? 'Could not measure which way it faces.',
      };
    }

    /* South rules a house out, but only on a measurement worth acting on.
       A low-confidence south reading sends him to Street View for thirty
       seconds rather than discarding a house he might have loved. */
    const south = o.entranceDirection === 'South';
    const solid = o.confidence === 'high' || o.confidence === 'medium';

    return {
      url: p.url,
      address: g?.formatted ?? address,
      site: p.site,
      facing: o.entranceDirection,
      bearingDeg: o.bearingDeg,
      confidence: o.confidence,
      verdict: south && solid ? 'out' : south ? 'check yourself' : 'keep',
      why: south && solid
        ? `Faces south${o.bearingDeg !== null ? ` (${o.bearingDeg.toFixed(0)}°)` : ''}. Out.`
        : south
          ? 'Might be south-facing, but the reading is shaky — open Street View before dropping it.'
          : `Faces ${o.entranceDirection.toLowerCase()}.`,
    };
  };

  let cursor = 0;
  const worker = async () => {
    while (cursor < parsed.length) {
      const p = parsed[cursor++]!;
      try {
        results.push(await one(p));
      } catch {
        results.push({
          url: p.url, address: p.addressGuess ?? '', site: p.site,
          facing: 'Unknown', bearingDeg: null, confidence: 'none',
          verdict: 'check yourself', why: 'Lookup failed.',
        });
      }
      onProgress?.(++done, parsed.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, parsed.length) }, worker),
  );

  /* Keepers first, then the ones needing a look, then the dead. */
  const rank = { keep: 0, 'check yourself': 1, out: 2 } as const;
  results.sort((a, b) => rank[a.verdict] - rank[b.verdict] || a.address.localeCompare(b.address));

  return {
    results,
    out: results.filter((r) => r.verdict === 'out').length,
    keep: results.filter((r) => r.verdict === 'keep').length,
    checkYourself: results.filter((r) => r.verdict === 'check yourself').length,
    failed: results.filter((r) => r.confidence === 'none').length,
  };
}
