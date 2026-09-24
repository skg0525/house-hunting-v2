/**
 * Scan orchestration.
 *
 * The cost story lives here. Perception is the expensive part — a vision call
 * per house — but it is a pure function of the IMAGES. It does not depend on
 * what you want. So perception is cached per house and reused forever, while
 * scoring re-runs on every request for nothing.
 *
 * That is what makes changing your mind cheap. Decide the yard matters more
 * than walkability after all, and all forty houses re-rank in a few
 * milliseconds without a single model call.
 *
 * Orientation is cached the same way and for the same reason: a house does not
 * turn around.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { Listing, Perception, Orientation, EvidenceBase, Assessment, TraceStep } from '../types/listing.js';
import { PreferenceProfile } from '../types/preferences.js';
import { perceiveProperty } from './geminiEvaluator.js';
import { resolveOrientation } from './orientation.js';
import { scoreProperty, withObserved } from './scoringEngine.js';

const FACING_DEG: Record<string, number> = {
  North: 0, 'North-East': 45, East: 90, 'South-East': 135,
  South: 180, 'South-West': 225, West: 270, 'North-West': 315,
};
import { buildNarrative } from './narrator.js';
import { readVastu } from './vastu.js';
import { healthAdvisories, systemsOutlook } from './healthAndSystems.js';
import { assessNegotiation } from './negotiation.js';
import { buildHighlights } from './highlights.js';
import { readMarket } from './comps.js';
import { STORE_DIR } from '../paths.js';

const CACHE_FILE = join(STORE_DIR, 'perception-cache.json');

interface CacheEntry {
  perception: Perception;
  evidence: EvidenceBase;
  orientation: Orientation;
  model: string;
  at: string;
  /**
   * Which images this reading was taken from.
   *
   * A cache keyed only on the listing id goes stale silently the moment a new
   * image is attached. A floor plan was found, downloaded and attached to a
   * house, and the very next scan still reported its kitchen as unmeasured —
   * because the reading it reused had been taken when the house had no plan.
   * Keying on the inputs makes that impossible.
   */
  inputs?: string;
}

/** A stable fingerprint of everything the model would be shown. */
function inputSignature(listing: Listing): string {
  const i = listing.images;
  return [
    i.floorPlan ?? '',
    ...(i.floorPlanExtra ?? []),
    i.aerial ?? '',
    i.aerialWide ?? '',
  ].join('|');
}

let cache: Record<string, CacheEntry> | null = null;
/** Two scans racing the same house share one call rather than paying twice. */
const inflight = new Map<string, Promise<CacheEntry>>();

async function loadCache(): Promise<Record<string, CacheEntry>> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
  } catch {
    cache = {};
  }
  return cache!;
}

async function persistCache() {
  await mkdir(dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache ?? {}, null, 2));
}

export async function clearPerception(listingId?: string) {
  const c = await loadCache();
  if (listingId) delete c[listingId];
  else cache = {};
  await persistCache();
}

export async function hasPerception(listingId: string): Promise<boolean> {
  return Boolean((await loadCache())[listingId]);
}

export async function cacheStats() {
  const c = await loadCache();
  return { entries: Object.keys(c).length, ids: Object.keys(c) };
}

async function look(
  listing: Listing,
  force: boolean,
): Promise<{ entry: CacheEntry; trace: TraceStep[]; cached: boolean }> {
  const c = await loadCache();
  const signature = inputSignature(listing);
  const hit = c[listing.id];

  /* Reuse only when the pictures are the same pictures.
   *
   * Entries written before this field existed carry no signature. Treating
   * those as a match was the bug wearing a different hat: a house whose plan
   * had just been found kept scoring off a reading taken when it had none. So
   * an unsigned entry is trusted only when it demonstrably used everything the
   * listing now has — a reading that never saw a plan, for a house that has
   * one, is stale whatever its signature says. */
  const readEverythingAvailable = hit
    && (!listing.images.floorPlan || hit.evidence?.planRead)
    && (!listing.images.aerial || hit.evidence?.aerialRead);

  const sameInputs = hit
    && (hit.inputs === signature || (hit.inputs === undefined && readEverythingAvailable));

  if (!force && hit && sameInputs) {
    return {
      entry: hit,
      cached: true,
      trace: [{
        step: 'Cache hit',
        detail: `Reusing the reading from ${new Date(hit.at).toLocaleString()} — same images, so the answer cannot have changed.`,
        ms: 0,
        status: 'cached',
      }],
    };
  }

  const existing = inflight.get(listing.id);
  if (existing) return { entry: await existing, trace: [], cached: false };

  const trace: TraceStep[] = [];
  const job = (async (): Promise<CacheEntry> => {
    const t0 = Date.now();

    /* Vision and mapping are independent, so they run together. The compass
       does not come from the drawing, which is the whole reason this works on
       real listing plans that have no north arrow on them. */
    const [vision, orientation] = await Promise.all([
      perceiveProperty(listing),
      resolveOrientation(listing.address, listing.coords, listing.geocodeQuality),
    ]);

    trace.push(...vision.trace);
    trace.push({
      step: 'Measure facing direction',
      detail: orientation.method,
      ms: Date.now() - t0,
      status: orientation.confidence === 'high' ? 'ok'
            : orientation.confidence === 'none' ? 'error' : 'degraded',
    });

    const entry: CacheEntry = {
      perception: vision.perception,
      evidence: vision.evidence,
      orientation,
      model: vision.model ?? 'unavailable',
      at: new Date().toISOString(),
      inputs: signature,
    };

    // Only cache a reading worth keeping. Caching a failure would freeze it in.
    if (!vision.degraded) {
      const store = await loadCache();
      store[listing.id] = entry;
      await persistCache();
    }
    return entry;
  })();

  inflight.set(listing.id, job);
  try {
    return { entry: await job, trace, cached: false };
  } finally {
    inflight.delete(listing.id);
  }
}

/**
 * The middle of his own list, cached for a minute.
 *
 * This is the FALLBACK yardstick, used only where a house has no comparable
 * set of its own — `readMarket` builds a proper one from houses within two
 * miles and 70–135% of the subject's size, and that is what scoring prefers.
 *
 * It is deliberately the whole corpus, rejections included: a house he turned
 * down for a south-facing door is still a real asking price in this market, and
 * dropping it would make the median track his taste instead of the market. It
 * moves as he adds and removes houses. Recomputed at most once a minute because
 * a full scan asks for it ninety times in a row.
 *
 * Houses whose stated floor area cannot hold their stated bedrooms are excluded
 * — see `plausibleArea`. 725 Caney Fork Rd claims 1,241 sq ft for five bedrooms
 * at $1.18M, and that single impossible $952/sq ft was sitting in the median
 * every other house got measured against.
 */
let marketCache: { at: number; medianPsf?: number; medianLandPsf?: number } | null = null;

async function listPriceMiddle(): Promise<{ medianPsf?: number; medianLandPsf?: number }> {
  if (marketCache && Date.now() - marketCache.at < 60_000) return marketCache;
  const { allListings } = await import('./listingStore.js');
  const all = (await allListings()).filter((l) => !l.archivedAt && l.price > 0);

  const psf = all
    .filter((l) => l.sqft > 0)
    .filter((l) => !l.beds || l.sqft / l.beds >= 300)
    /* Floor area that equals lot area is the lot area in the wrong field —
       see `plausibleArea`. It must not set the median either. */
    .filter((l) => {
      const lot = (l.lotSizeAcres || 0) * 43_560;
      return !lot || Math.abs(l.sqft - lot) > Math.max(2, lot * 0.001);
    })
    .map((l) => l.price / l.sqft)
    .sort((a, b) => a - b);

  /* The same question asked of the ground rather than the building. A lot size
     cannot be implausible the way a floor area can, so it needs no guard —
     only a size, since a listing with no acreage recorded would otherwise
     divide by zero and read as infinitely expensive land. */
  const land = all
    .filter((l) => l.lotSizeAcres > 0)
    .map((l) => l.price / (l.lotSizeAcres * 43_560))
    .sort((a, b) => a - b);

  marketCache = {
    at: Date.now(),
    medianPsf: psf.length ? psf[Math.floor(psf.length / 2)] : undefined,
    medianLandPsf: land.length ? land[Math.floor(land.length / 2)] : undefined,
  };
  return marketCache;
}

export async function assessListing(
  listing: Listing,
  profile: PreferenceProfile,
  opts: { force?: boolean; cachedOnly?: boolean; deep?: boolean } = {},
): Promise<Assessment | null> {
  const t0 = Date.now();

  /* Re-scoring after you change a weight must never trigger a vision call.
     Perception does not depend on the profile, so if it is not already cached
     there is nothing to re-score — returning null lets the caller leave that
     house exactly as it was instead of stalling behind model calls you never
     asked for. */
  if (opts.cachedOnly && !(await hasPerception(listing.id))) return null;

  const { entry, trace, cached } = await look(listing, opts.force ?? false);
  /* What he saw beats what was measured — the same rule as the fence.
     The bearing is a line from the house to the nearest camera, and on a
     cul-de-sac or a corner plot that camera can be on the wrong street. He can
     look at the photograph; the arithmetic cannot. */
  /* 'Unknown' is him rejecting the reading without supplying a replacement —
     he has looked and it is not what the tool measured, but he cannot name the
     direction. That has to clear the bearing as well as the name: leaving
     179° in place would keep the house inside the barred sector on a number he
     has just told us is wrong. Nothing scores, nothing is ruled out. */
  const orientation = listing.observedFacing === 'Unknown'
    ? {
        ...entry.orientation,
        entranceDirection: 'Unknown' as const,
        bearingDeg: null,
        confidence: 'none' as const,
        method: 'You looked and said this is not what was measured, without naming a ' +
                'direction — so the facing is unknown rather than wrong. It scores ' +
                `nothing and rules out nothing. The measurement said: ${entry.orientation.method}`,
      }
    : listing.observedFacing
    ? {
        ...entry.orientation,
        entranceDirection: listing.observedFacing,
        bearingDeg: FACING_DEG[listing.observedFacing] ?? entry.orientation.bearingDeg,
        confidence: 'high' as const,
        method: `${listing.observedFacing}, because you looked and said so. ` +
                `That replaces the measurement, which read: ${entry.orientation.method}`,
      }
    : entry.orientation;
  /* Readings cached before this field existed have no record of what was read. */
  /* Applied once, before anything reads it, so the card and the score cannot
     disagree about a fence he has stood next to. */
  const { perception, evidence } = withObserved(
    entry.perception,
    entry.evidence ?? { planRead: false, aerialRead: false },
    listing.observed,
  );

  /* What the street is doing, which is what makes an asking price mean
     something. Cached alongside the reading because it costs several requests. */
  /* The market read costs four or five requests to a listing site, so it is not
     run on every house in a sweep of sixty. It is run when a house is being
     seriously considered — which is what having a price and a verdict means. */
  const worthComps =
    Boolean(listing.coords) &&
    listing.price > 0 &&
    (opts.deep === true || ['shortlisted', 'selfTour', 'agentTour'].includes(profile.propertyFeedback?.[listing.id] ?? ''));

  const market = worthComps && listing.coords
    ? await readMarket(
        listing.coords,
        {
          sqft: listing.sqft, price: listing.price, url: listing.sourceUrl,
          yearBuilt: listing.yearBuilt, lotSqft: listing.lotSizeAcres * 43_560,
        },
        {
          maxPrice: profile.preferences.maxPrice,
          minYearBuilt: profile.preferences.minYearBuilt,
          minLotAcres: profile.preferences.minLotAcres,
        },
      ).catch(() => null)
    : null;

  const scoreStart = Date.now();
  /* The neighbourhood median first, the corpus median only if there isn't one.
     Read before scoring rather than after it, which is the whole change: the
     comparable set was already being computed and then shown in a panel the
     score never looked at. */
  const { matchScore, baseScore, math, ruledOut, dimensions, concerns, verdict } =
    scoreProperty(listing, perception, evidence, orientation, profile, {
      ...(await listPriceMiddle()),
      neighbourhoodPsf: market?.medianPricePerSqft,
    });

  trace.push({
    step: 'Score against your profile',
    detail:
      `${dimensions.filter((d) => d.available).length} of ${dimensions.length} dimensions had data. ` +
      (ruledOut ? 'Ruled out on a non-negotiable.' : `${concerns.length} concern(s).`),
    ms: Date.now() - scoreStart,
    status: 'ok',
  });

  const { pros, cons, summary } =
    buildNarrative(listing, perception, evidence, orientation, dimensions, matchScore, ruledOut, profile);

  /* All four are reported next to the score and none of them move it.
     The Vastu reading beyond the south-facing rule is a set of beliefs he asked
     to see, not a set he asked to be ranked on; the health and systems notes
     are things to inspect or budget for, not reasons to reject; and the
     negotiation is advice about a house he has already decided he likes. */
  const vastu = readVastu(
    perception, orientation, (perception.planPositions ?? {}) as Record<string, string>,
    profile.preferences.vastuSchool ?? 'classical',
  );
  const highlights = buildHighlights(listing, orientation);
  const health = healthAdvisories(listing);
  const systems = systemsOutlook(listing);
  const negotiation = assessNegotiation(
    listing, profile.preferences.maxPrice, profile.preferences.negotiationRoomPct, vastu,
  );

  return {
    listingId: listing.id,
    matchScore,
    baseScore,
    math,
    ruledOut,
    dimensions,
    perception,
    evidence,
    orientation,
    pros,
    cons: [...concerns, ...cons].slice(0, 8),
    summary,
    verdict,
    vastu,
    highlights,
    market,
    health,
    systems,
    negotiation,
    trace,
    cached,
    totalMs: Date.now() - t0,
  };
}
