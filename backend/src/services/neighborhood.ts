/**
 * The things about a house that are not in the house.
 *
 * Census tract data, walkability, schools. All of it keyed off the coordinates,
 * all of it cached on the listing so a re-score costs nothing.
 *
 * Tract, not ZIP code. A ZIP in Atlanta can span a walkable main street and a
 * cul-de-sac subdivision three miles apart, and averaging them tells you about
 * neither. A tract is a few thousand people — close to what you would call a
 * neighbourhood.
 */
import { Listing } from '../types/listing.js';

const CENSUS_KEY = process.env.CENSUS_API_KEY ?? '';
const WALKSCORE_KEY = process.env.WALKSCORE_API_KEY ?? '';

/** ACS 5-year table B03002: Hispanic or Latino origin by race. */
const RACE_VARS = [
  'B03002_001E', // total
  'B03002_003E', // White alone, not Hispanic
  'B03002_004E', // Black alone, not Hispanic
  'B03002_005E', // American Indian / Alaska Native, not Hispanic
  'B03002_006E', // Asian alone, not Hispanic
  'B03002_007E', // Native Hawaiian / Pacific Islander, not Hispanic
  'B03002_008E', // Some other race, not Hispanic
  'B03002_009E', // Two or more races, not Hispanic
  'B03002_012E', // Hispanic or Latino, any race
];

/**
 * Table B02015, "Asian Alone by Selected Groups" — the whole South Asian block.
 *
 * Do not shortcut this to one variable. B02015_002E looks like the obvious
 * choice and is "Chinese, except Taiwanese": the Census reorganised this table
 * into East / South / Southeast Asian sections, so the low-numbered codes are
 * East Asian. Reading _002E as "Asian Indian" reported a tract that is 12%
 * South Asian as 3.1%, which is the difference between a neighbourhood we would
 * fit into and one where we would be the only family like ours.
 *
 * Summing the section is also more right than Asian Indian alone. Pakistani,
 * Bangladeshi, Nepalese and Sri Lankan neighbours are the same answer to the
 * question actually being asked.
 */
const SOUTH_ASIAN_VARS = [
  'B02015_021E', // Asian Indian
  'B02015_022E', // Bangladeshi
  'B02015_023E', // Bhutanese
  'B02015_024E', // Nepalese
  'B02015_025E', // Pakistani
  'B02015_026E', // Sikh
  'B02015_027E', // Sri Lankan
  'B02015_028E', // Other South Asian
];

interface Tract {
  state: string; county: string; tract: string; name: string;
  /** Present when the finer geography resolved; absent falls back to the tract. */
  blockGroup?: string;
}

/**
 * Coordinates to census tract, via the Census Bureau's own geocoder.
 * Free, no key, no rate limit worth worrying about at forty houses.
 */
export async function tractFor(lat: number, lng: number): Promise<Tract | null> {
  /* Block group, not tract.
   *
   * A tract is a few thousand people spread over a wide area, and he found out
   * the hard way what that hides: the tract around 5280 Blue Mountain Ln reads
   * 21.5% South Asian, and the street itself is essentially all South Asian —
   * every owner on the county tax roll. The tract average was not wrong, it was
   * answering a different question from the one he was asking.
   *
   * A block group is the smallest geography the ACS publishes, typically 600 to
   * 3,000 people — a neighbourhood rather than a region. It is the right unit
   * for "what is this area actually like", and all three tables we read are
   * published at this level, including the detailed Asian-origin table.
   *
   * `layers=all` because the geocoder omits Block Groups from its default set.
   * If it does not come back, the tract is still returned and everything works
   * as before at the coarser resolution. */
  const url =
    'https://geocoding.geo.census.gov/geocoder/geographies/coordinates' +
    `?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Census2020_Current` +
    '&layers=all&format=json';
  try {
    const res = await fetch(url);
    const json: any = await res.json();
    const geos = json?.result?.geographies ?? {};
    const bgKey = Object.keys(geos).find((k) => /block group/i.test(k));
    const b = bgKey ? geos[bgKey]?.[0] : undefined;
    const t = geos['Census Tracts']?.[0] ?? b;
    if (!t) return null;
    return {
      state: t.STATE, county: t.COUNTY, tract: t.TRACT,
      name: t.NAME ?? `Tract ${t.TRACT}`,
      blockGroup: b?.BLKGRP,
    };
  } catch {
    return null;
  }
}

/**
 * Simpson diversity index: the chance that two people picked at random from
 * this tract are of different backgrounds.
 *
 * 1 minus the sum of squared shares. A tract that is 100% any one group scores
 * 0. An even eight-way split scores 0.875. Around 0.7 is what a genuinely mixed
 * American neighbourhood looks like.
 *
 * Worth being clear about what this does and does not tell you: it is a measure
 * of composition, not of welcome. It cannot tell you whether the people on that
 * street will be good neighbours to your family. It can tell you whether your
 * family would be the only one of its kind there, which is a different and
 * smaller question, but a real one and the only one the data can answer.
 */
export function simpsonIndex(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  return 1 - counts.reduce((s, c) => s + (c / total) ** 2, 0);
}

export interface NeighborhoodData {
  diversityIndex?: number;
  southAsianPct?: number;
  whitePct?: number;
  /* Named plainly, because "diversity index 0.53" tells you nothing about who
     actually lives there — and who lives there is the question being asked. */
  blackPct?: number;
  hispanicPct?: number;
  asianPct?: number;
  otherPct?: number;
  censusTract?: string;
  /** Share of households with someone under 18 — will there be other children. */
  familiesWithKidsPct?: number;
  /** Children aged 0-9 in the block group, the cohort a young child grows up beside. */
  youngChildren?: number;
  /** Owner-occupied share. A street of renters turns over; a street of owners stays. */
  ownerOccupiedPct?: number;
  walkScore?: number;
  schoolRating?: number;
}

async function censusDemographics(t: Tract): Promise<Partial<NeighborhoodData>> {
  if (!CENSUS_KEY) return {};
  const base = 'https://api.census.gov/data/2023/acs/acs5';
  /* Two resolutions, because the Census publishes them differently.
   *
   * The basic race table (B02001) and Hispanic origin (B03003) are published at
   * block group — 600 to 3,000 people, a neighbourhood. The detailed
   * Asian-origin table (B02015), which is where the South Asian number comes
   * from, is SUPPRESSED at that level: the columns come back, every value is
   * null. Reading those nulls as zero reported three shortlisted houses as 0%
   * South Asian, which is worse than the coarse number it replaced.
   *
   * So: the general mix at block-group resolution, the South Asian share from
   * the tract, and the labels say which is which. A number at the wrong
   * resolution is still useful; a number that is silently wrong is not. */
  const bgGeo = t.blockGroup
    ? `&for=block%20group:${t.blockGroup}&in=state:${t.state}%20county:${t.county}%20tract:${t.tract}&key=${CENSUS_KEY}`
    : `&for=tract:${t.tract}&in=state:${t.state}%20county:${t.county}&key=${CENSUS_KEY}`;
  const tractGeo = `&for=tract:${t.tract}&in=state:${t.state}%20county:${t.county}&key=${CENSUS_KEY}`;
  const geo = bgGeo;

  try {
    const [raceRes, indianRes] = await Promise.all([
      fetch(`${base}?get=${RACE_VARS.join(',')}${geo}`),
      fetch(`${base}?get=${SOUTH_ASIAN_VARS.join(',')}${tractGeo}`),
    ]);

    const race: any = await raceRes.json();
    const row = race?.[1]?.map(Number);
    if (!row) return {};

    const total = row[0];
    // Skip index 0 (the total) and the trailing geography columns.
    const groups = row.slice(1, 9);

    /* The South Asian share is a TRACT figure, so it has to be divided by the
       tract's population — not the block group's. Mixing the two produced a
       percentage of one area's people over another area's total. */
    let southAsianPct: number | undefined;
    try {
      const sa: any = await indianRes.json();
      const row = sa?.[1]?.slice(0, SOUTH_ASIAN_VARS.length).map(Number) as number[];
      const tot: any = await fetch(`${base}?get=B02001_001E${tractGeo}`).then((r) => r.json());
      const tractTotal = Number(tot?.[1]?.[0]);
      if (row?.every(Number.isFinite) && Number.isFinite(tractTotal) && tractTotal > 0) {
        southAsianPct = (row.reduce((a, b) => a + b, 0) / tractTotal) * 100;
      }
    } catch { /* the detailed table is suppressed in very small areas; fine */ }

    /* Who else lives here, which is the question underneath "will a child have
       anyone to play with". Ethnicity was never going to answer that; households
       with children and the number of under-tens on the block do.
       Owner-occupancy comes along because a street that turns over every two
       years does not make the friendships he is describing. */
    let familiesWithKidsPct: number | undefined;
    let youngChildren: number | undefined;
    let ownerOccupiedPct: number | undefined;
    try {
      const fam: any = await fetch(
        `${base}?get=B11005_001E,B11005_002E,B01001_003E,B01001_004E,B01001_027E,B01001_028E,B25003_001E,B25003_002E${geo}`,
      ).then((r) => r.json());
      const f = fam?.[1]?.slice(0, 8).map(Number) as number[];
      if (f?.every(Number.isFinite)) {
        if (f[0] > 0) familiesWithKidsPct = (f[1]! / f[0]!) * 100;
        youngChildren = f[2]! + f[3]! + f[4]! + f[5]!;
        if (f[6] > 0) ownerOccupiedPct = (f[7]! / f[6]!) * 100;
      }
    } catch { /* suppressed in very small areas; leave unknown */ }

    const pct = (i: number) => (total > 0 ? (row[i]! / total) * 100 : undefined);
    return {
      diversityIndex: simpsonIndex(groups),
      whitePct: pct(1),
      blackPct: pct(2),
      asianPct: pct(4),
      hispanicPct: pct(8),
      /* Everything not in the four named groups, so the percentages a person
         reads add up to a hundred instead of leaving a silent remainder. */
      otherPct: total > 0
        ? ((row[3]! + row[5]! + row[6]! + row[7]!) / total) * 100
        : undefined,
      southAsianPct,
      familiesWithKidsPct,
      youngChildren,
      ownerOccupiedPct,
      censusTract: t.blockGroup
        ? `${t.name}, Block Group ${t.blockGroup} (${t.state}${t.county}${t.tract}${t.blockGroup})`
        : `${t.name} (${t.state}${t.county}${t.tract})`,
    };
  } catch {
    return {};
  }
}

async function walkScore(lat: number, lng: number, address: string): Promise<number | undefined> {
  if (!WALKSCORE_KEY) return undefined;
  try {
    const url = `https://api.walkscore.com/score?format=json&transit=1` +
      `&address=${encodeURIComponent(address)}&lat=${lat}&lon=${lng}&wsapikey=${WALKSCORE_KEY}`;
    const res = await fetch(url);
    const json: any = await res.json();
    return typeof json?.walkscore === 'number' ? json.walkscore : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Everything we can learn from a set of coordinates.
 *
 * Whatever is missing stays missing — the scoring engine leaves an unavailable
 * dimension out of the average rather than scoring it as a neutral 50, so a
 * house with no Census key configured is simply ranked on what is known.
 */
export async function enrich(listing: Listing): Promise<NeighborhoodData> {
  if (!listing.coords) return {};
  const { lat, lng } = listing.coords;

  const [tract, ws] = await Promise.all([
    tractFor(lat, lng),
    walkScore(lat, lng, listing.address),
  ]);

  const demo = tract ? await censusDemographics(tract) : {};
  return { ...demo, walkScore: ws };
}

/**
 * Which data sources are actually live.
 *
 * Surfaced in the UI so a missing dimension reads as "no key configured"
 * rather than as a fact about the house.
 */
export function dataSourceStatus() {
  return {
    census: Boolean(CENSUS_KEY),
    walkScore: Boolean(WALKSCORE_KEY),
    maps: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
  };
}
