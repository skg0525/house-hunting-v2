/**
 * The things that hurt a child or cost five figures.
 *
 * Neither is on a listing filter, and both are knowable from the year built
 * plus where the house is. Two separate concerns that happen to share an input:
 *
 *   Health — what a house of this vintage was legally allowed to be built with,
 *   at a time when a six-year-old is going to be crawling around on the floor
 *   of it.
 *
 *   Systems — a roof and an HVAC are twenty-year items. The year built alone
 *   cannot tell a 1998 house with a 2021 roof from a 2005 house with all its
 *   original equipment, and the first is the better buy.
 *
 * None of this rules a house out. All of it is either inspectable before
 * closing or fixable after, and the point is to know the number before making
 * an offer rather than after.
 */
import { Listing } from '../types/listing.js';

export interface Advisory {
  label: string;
  detail: string;
  severity: 'watch' | 'check' | 'budget';
}

/**
 * EPA Radon Zone 1 counties in metro Atlanta — predicted indoor average above
 * the 4 pCi/L action level. Zone 1 is not a prediction about one house; radon
 * varies enormously street to street. It means test, and the test is cheap.
 */
const RADON_ZONE_1 = [
  'fulton', 'dekalb', 'cobb', 'gwinnett', 'cherokee', 'forsyth',
  'fayette', 'coweta', 'paulding', 'douglas', 'clayton', 'rockdale',
  'barrow', 'jackson', 'hall', 'pickens', 'dawson', 'lumpkin',
];

export function healthAdvisories(l: Listing): Advisory[] {
  const out: Advisory[] = [];
  const y = l.yearBuilt;
  if (!y || y < 1800) return out;

  /* Lead paint was banned in US residential use in 1978. Federal disclosure is
     required for anything older, and the risk is dust from friction surfaces —
     window sashes and door jambs — which is exactly what a small child touches
     and then puts in their mouth. */
  if (y < 1978) {
    out.push({
      label: 'Lead paint likely',
      detail:
        `Built ${y}, before the 1978 residential lead-paint ban. The seller must ` +
        `disclose. The real risk is dust from window sashes and door jambs, which ` +
        `is a problem specifically for a young child. A lead risk assessment runs ` +
        `a few hundred dollars and is worth doing before you commit.`,
      severity: 'check',
    });
  }

  /* Asbestos in residential materials was largely phased out through the
     1980s. Intact and undisturbed it is harmless; the exposure comes from
     renovation, which is precisely what you would want to do to a kitchen. */
  if (y < 1990) {
    out.push({
      label: 'Asbestos possible in original materials',
      detail:
        `A ${y} build may have asbestos in floor tile, pipe wrap, or popcorn ` +
        `ceilings. Left alone it is inert. It matters because you would be ` +
        `renovating — test before anyone opens a wall or pulls up flooring.`,
      severity: 'check',
    });
  }

  /* Polybutylene supply pipe, used roughly 1978-1995, fails without warning and
     is effectively uninsurable in places. Whole-house repipe territory. */
  if (y >= 1978 && y <= 1995) {
    out.push({
      label: 'Check for polybutylene plumbing',
      detail:
        `Grey plastic supply pipe was common in ${y}-era construction and fails ` +
        `without warning. Some insurers will not cover it. A repipe is $5-15k, so ` +
        `find out before you make an offer, not during due diligence.`,
      severity: 'budget',
    });
  }

  const county = (l.neighborhood?.censusTract ?? '').toLowerCase();
  const addr = l.address.toLowerCase();
  if (RADON_ZONE_1.some((c) => county.includes(c) || addr.includes(c))) {
    out.push({
      label: 'EPA Radon Zone 1',
      detail:
        `This part of north Georgia is EPA Zone 1, where indoor averages are ` +
        `predicted above the action level. That says nothing about this house — ` +
        `radon varies street to street — which is why you test. A test is about ` +
        `$150 and mitigation about $1,500 if it comes back high.`,
      severity: 'check',
    });
  }

  return out;
}

/**
 * What the big-ticket systems are likely to cost you, and when.
 *
 * Falls back to the year built when an install year is unknown, and says so —
 * an assumed age must never read like a known one.
 */
export function systemsOutlook(l: Listing): { advisories: Advisory[]; assumedFromYearBuilt: boolean } {
  const now = new Date().getFullYear();
  const advisories: Advisory[] = [];
  const s = l.systems ?? {};
  let assumed = false;

  const item = (
    name: string, installed: number | undefined, life: number, cost: string,
  ) => {
    if (!l.yearBuilt || l.yearBuilt < 1800) return;
    const year = installed ?? l.yearBuilt;
    if (!installed) assumed = true;
    const age = now - year;
    const left = life - age;

    if (left > 6) {
      if (installed)
        advisories.push({
          label: `${name} replaced ${year}`,
          detail: `About ${left} years of service life left. Already paid for — this is money you are not spending.`,
          severity: 'watch',
        });
      return;
    }

    advisories.push({
      label: left <= 0 ? `${name} at or past end of life` : `${name} due within ${left} years`,
      detail:
        (installed ? `Installed ${year}. ` : `No install year given, so assuming original to the ${year} build. `) +
        `${age} years old against a typical ${life}-year life. Budget ${cost}` +
        (installed ? '.' : ', or ask the seller for the install date — if it has been done, this concern disappears.'),
      severity: 'budget',
    });
  };

  item('Roof', s.roofYear, 22, '$12,000-25,000');
  item('HVAC', s.hvacYear, 18, '$8,000-15,000 per system');
  item('Water heater', s.waterHeaterYear, 12, '$1,500-3,000');
  item('Windows', s.windowsYear, 30, '$10,000-25,000');

  return { advisories, assumedFromYearBuilt: assumed };
}

/**
 * What the ageing systems will actually cost, as one number.
 *
 * The advisories already say the roof is past its life and the HVAC is close;
 * they were reported beside the score and never counted in it. But a house
 * needing a roof and two air handlers inside five years is thirty thousand
 * dollars more expensive than the identical house next door with new ones, and
 * that is not a footnote — it is a bigger sum than most of the price
 * differences on his list.
 *
 * Midpoints of the ranges, discounted by how far away the spend is: money due
 * in six years hurts about a third as much as money due now.
 */
export function deferredCapital(l: Listing): { total: number; items: string[] } {
  const now = new Date().getFullYear();
  const s = l.systems ?? {};
  const items: string[] = [];
  let total = 0;

  if (!l.yearBuilt || l.yearBuilt < 1800) return { total: 0, items };

  const claimed = new Set(l.systemsClaimed ?? []);

  /* Three tiers, because a 2003 house is not one thing.
   *
   * Age alone treated "roof replaced in 2022" exactly like "original roof,
   * never touched" — the same twenty-three-year-old house, the same markdown,
   * a $18,000 difference in what you actually have to spend. His words: old
   * with no updates is worst, old with everything done should barely be
   * penalised, partial sits between.
   *
   *   dated   — a year in the remarks. Charged from that year. Usually free.
   *   claimed — "newer roof", no date. Sixteen of the twenty listings that
   *             mention a system are this. Charged HALF: it is a written claim
   *             by someone who wants it believed, but nobody has seen a
   *             receipt, and it could mean five years old or fifteen.
   *   silent  — nothing said. Charged in full from the year built.
   */
  const due = (
    name: string, key: 'roof' | 'hvac' | 'waterHeater' | 'windows',
    installed: number | undefined, life: number, cost: number,
  ) => {
    const age = now - (installed ?? l.yearBuilt);
    const left = life - age;
    if (left > 8) return;
    /* Full weight when it is already overdue, tapering to a quarter at eight
       years out — by then it is the next owner's problem as much as his. */
    let weight = left <= 0 ? 1 : 1 - (left / 8) * 0.75;

    const undated = installed === undefined && claimed.has(key);
    if (undated) weight *= 0.5;

    total += cost * weight;
    items.push(
      undated ? `${name} (seller says newer, no date)`
      : left <= 0 ? `${name} (overdue)`
      : `${name} (~${left}y)`,
    );
  };

  due('roof', 'roof', s.roofYear, 22, 18_000);
  due('HVAC', 'hvac', s.hvacYear, 18, 11_000);
  due('water heater', 'waterHeater', s.waterHeaterYear, 12, 2_200);
  due('windows', 'windows', s.windowsYear, 30, 17_000);

  return { total: Math.round(total), items };
}
