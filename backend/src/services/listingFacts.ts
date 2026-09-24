/**
 * Read the facts off the listing page instead of making him type them.
 *
 * Price, beds, lot size, year built, days on market, whether the range is gas —
 * all printed on the page he already has open. Typing them was twenty seconds a
 * house, which is fine for three houses and not for forty.
 *
 * Everything here is best-effort andevery field is optional: a fact that cannot be
 * found is left undefined so it reads as "not entered" rather than as zero. A
 * wrong number typed in automatically is worse than a blank one, because he
 * would never think to check it.
 */

import { fetchListingPage, RateLimited } from './listingPage.js';
import { readSashes } from './sashes.js';



export interface ScrapedFacts {
  price?: number;
  originalPrice?: number;
  redfinEstimate?: number;
  beds?: number;
  baths?: number;
  sqft?: number;
  lotSizeAcres?: number;
  yearBuilt?: number;
  hoaMonthly?: number;
  daysOnMarket?: number;
  cooktopFuel?: 'gas' | 'electric' | 'induction' | 'unknown';
  cooktopEvidence?: string;
  description?: string;
  ageRestricted?: boolean;
  ageRestrictedEvidence?: string;
  systems?: { roofYear?: number; hvacYear?: number; waterHeaterYear?: number; windowsYear?: number };
  systemsClaimed?: ('roof' | 'hvac' | 'waterHeater' | 'windows')[];
  propertyType?: string;
  /**
   * Whether it is actually for sale.
   *
   * A house that sold in 2021 was sitting in the shortlist at a $905,579
   * estimate, competing for attention with houses he could actually buy. Its
   * page says OFF MARKET in the first screenful; nothing was reading it.
   */
  status?: 'for sale' | 'pending' | 'sold' | 'off market' | 'unknown';
  /** The badges on the listing photo, and what they mean. */
  sashes?: string[];
  hoursOnMarket?: number;
  has3dTour?: boolean;
  isHot?: boolean;

  /**
   * Basements matter here for one specific reason: a finished one is party
   * space and a guest suite, an unfinished one is a project. The listing prose
   * distinguishes them and no filter does.
   */
  basement?: 'finished' | 'partly finished' | 'unfinished' | 'none' | 'unknown';
  basementEvidence?: string;
  /**
   * Septic or municipal sewer.
   *
   * Larger lots in Milton and north Alpharetta are frequently on septic rather
   * than public sewer. It is not a dealbreaker — plenty of good houses are —
   * but it is a $300-500 scoping contingency before you offer, and mature tree
   * roots do breach drain fields over a twenty-five year lifecycle. Worth
   * knowing, and never on a listing filter.
   */
  sewer?: 'public' | 'septic' | 'unknown';
  sewerEvidence?: string;
  /**
   * Where the listing site says this house is.
   *
   * Better than geocoding the address, and free. Google does not know streets
   * that were platted last year: asked for "4835 Rosarian Dr, Cumming" it
   * returns "Cumming, GA, USA" and the centroid of the town, five and a half
   * miles from the house. The listing site knows, because it is their listing —
   * the page carries a schema.org GeoCoordinates block for the subject.
   */
  coords?: { lat: number; lng: number };
  readiness?: 'move-in ready' | 'weeks' | 'months' | 'to be built' | 'unknown';
  completionEstimate?: string;
  isNewConstruction?: boolean;
  /** Mean of the assigned elementary / middle / high ratings, out of 10. */
  schoolRating?: number;
  /** Redfin prints walkability out of 10; converted to the 0-100 scale. */
  walkScore?: number;
}

/** Strip scripts and tags so prose patterns match against readable text. */
function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&rsquo;|&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

const num = (s?: string) => {
  if (!s) return undefined;
  const n = Number(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * Gas, electric or induction.
 *
 * The cook in this household is on gas and will not go back to electric, so this is a
 * requirement rather than a detail. It is almost never a filter on a listing
 * site, but it is nearly always in the prose — "gas range", "gas cooktop",
 * "chef's kitchen with gas".
 *
 * Ambiguity is reported as unknown rather than guessed. "Stainless steel
 * appliances" tells you nothing about what the range burns.
 */
export function detectCooktop(text: string): { fuel: ScrapedFacts['cooktopFuel']; evidence: string } {
  const t = text.toLowerCase();

  const quote = (re: RegExp) => {
    const m = t.match(re);
    if (!m) return '';
    const i = Math.max(0, (m.index ?? 0) - 45);
    return '…' + text.slice(i, i + 130).trim() + '…';
  };

  const induction = /induction (?:range|cooktop|stove)/;
  const gas = /\bgas (?:range|cooktop|stove|burner)|\brange is gas\b|gas line (?:to|for) (?:the )?(?:range|cooktop)/;
  const electric = /\belectric (?:range|cooktop|stove)\b|\bsmooth[- ]top\b/;

  if (induction.test(t)) return { fuel: 'induction', evidence: quote(induction) };
  if (gas.test(t)) return { fuel: 'gas', evidence: quote(gas) };
  if (electric.test(t)) return { fuel: 'electric', evidence: quote(electric) };

  /* Gas service to the house is not the same as a gas range, but it does mean
     converting is a plumber rather than a new service line. Worth saying. */
  if (/\bgas (?:heat|furnace|water heater|logs|fireplace)\b/.test(t))
    return {
      fuel: 'unknown',
      evidence: 'The range is not described, but the house has gas service for something ' +
                'else — so converting an electric range would be a short run of pipe, not a new line.',
    };

  return { fuel: 'unknown', evidence: 'The listing does not say what the range burns. Ask, or look at the photos.' };
}

/**
 * Finished, unfinished, or none.
 *
 * "Terrace level" and "daylight basement" are the local vocabulary and both
 * usually mean finished. An unfinished basement is not a negative — it is
 * cheaper space you can finish later — but it is not the party room today, and
 * conflating the two would flatter a house unfairly.
 */
export function detectBasement(text: string): {
  state: ScrapedFacts['basement']; evidence: string;
} {
  const t = text.toLowerCase();
  const quote = (re: RegExp) => {
    const m = t.match(re);
    if (!m) return '';
    const i = Math.max(0, (m.index ?? 0) - 40);
    return '…' + text.slice(i, i + 150).trim() + '…';
  };

  const finished = /(?:fully )?finished (?:basement|terrace level|lower level)|finished daylight basement|terrace level (?:is )?finished|basement[^.]{0,40}\bfinished\b/;
  const partly = /partially finished basement|partial(?:ly)? finished (?:basement|terrace)|stubbed for a bath/;
  const unfinished = /unfinished (?:basement|terrace level|lower level)|basement[^.]{0,30}unfinished|full unfinished/;
  const any = /\b(?:basement|terrace level|daylight basement|walk-?out basement)\b/;
  const slab = /\bslab\b|no basement/;

  if (partly.test(t)) return { state: 'partly finished', evidence: quote(partly) };
  if (finished.test(t)) return { state: 'finished', evidence: quote(finished) };
  if (unfinished.test(t)) return { state: 'unfinished', evidence: quote(unfinished) };
  if (slab.test(t)) return { state: 'none', evidence: quote(slab) };
  if (any.test(t)) return { state: 'unknown', evidence: quote(any) + ' (a basement is mentioned but not described as finished or not).' };
  return { state: 'unknown', evidence: 'The listing does not mention a basement either way.' };
}

/**
 * Whether this is a 55+ / active adult community.
 *
 * Redfin has no field for it. It is stated in the description, in words, and
 * only there — 7395 Winderlea Ln reads "this intimate 55+ community" and
 * nothing in the structured data says so. A house he cannot legally live in
 * was sitting at 74 and on a Sunday tour list.
 *
 * READ THE SUBJECT'S OWN DESCRIPTION, NOT THE PAGE. A Redfin listing page
 * carries the remarks of every comparable it shows, and Winderlea's page
 * contains a *different* house's text advertising "the gated, Active Adult
 * Community of Traditions at Herrington". Grepping the HTML would have marked
 * houses 55+ on the strength of their neighbours' listings. The caller passes
 * the "About this home" block, which is this house and nothing else.
 *
 * The phrases below are the ones that mean it and cannot mean anything else. A
 * bare "55" is not among them: it is a price, a highway, or a lot number far
 * more often than it is an age limit.
 */
/**
 * This house's own description, and nothing else on the page.
 *
 * Two traps, both of which cost real accuracy:
 *
 * ONE — the page is not only this house. A Redfin listing page carries the
 * marketing remarks of every comparable it shows. 7395 Winderlea Ln's page
 * contains 3035 Steinbeck St's text advertising "the gated, Active Adult
 * Community of Traditions at Herrington". Searching the HTML would mark a house
 * 55+ on the strength of a neighbour's listing.
 *
 * TWO — the "About this home" reader capped the description at 2,200
 * characters, and it is a lazy match against a terminator, so a description
 * LONGER than the cap did not return a truncated description. It returned
 * nothing at all. Winderlea's runs 2,251 characters. The house was read as
 * having no description whatsoever, which is why the cooktop, the system years
 * and the 55+ status were all silently blank on 37 of 143 cached pages — the
 * tool was quietly worst at exactly the listings that said the most.
 *
 * So the schema.org block goes first: it is keyed to the subject and states
 * where it ends. "About this home" stays as the fallback, with a cap high
 * enough to be about safety rather than about length.
 */
export function subjectDescription(html: string, text: string): string | undefined {
  for (const m of html.matchAll(
    /<script[^>]+application\/ld\+json[^>]*>(.*?)<\/script>/gis,
  )) {
    try {
      const blocks = [JSON.parse(m[1] ?? 'null')].flat();
      for (const b of blocks) {
        const type = [b?.['@type']].flat();
        if (!type.includes('RealEstateListing') && !type.includes('Product')) continue;
        if (typeof b?.description === 'string' && b.description.length > 80)
          return b.description.trim();
      }
    } catch { /* One malformed block must not cost us the others. */ }
  }
  return text.match(/About this home\s*(.{80,9000}?)(?:Show more|Listed by|Property details)/i)?.[1]?.trim();
}

export function readAgeRestriction(about: string): { restricted: boolean; evidence?: string } {
  const PHRASES = [
    /\b55\s*\+/i,
    /\b(?:55|62)\s*(?:\+|years?)?\s*(?:and|or)\s*(?:older|better|above|over|up)\b/i,
    /\bage[\s-]*restricted\b/i,
    /\bage[\s-]*qualified\b/i,
    /\bactive\s+adult\b/i,
    /\badult\s+community\b/i,
    /\bsenior\s+(?:living|community)\b/i,
    /\bmust\s+be\s+(?:55|62)\b/i,
  ];
  for (const re of PHRASES) {
    const m = re.exec(about);
    if (!m) continue;
    /* Quote it back with enough either side to judge, because this deletes a
       house and he should be able to see the sentence that did it. */
    const from = Math.max(0, m.index - 90);
    const snippet = about.slice(from, m.index + m[0].length + 90).trim();
    return { restricted: true, evidence: `${from > 0 ? '…' : ''}${snippet}…` };
  }
  return { restricted: false };
}

export function parseFacts(html: string): ScrapedFacts {
  const text = toText(html);
  const out: ScrapedFacts = {};


  out.price = num(text.match(/\$([\d,]{6,})\s*(?:Est\.|Redfin|Price|—)/)?.[1])
           ?? num(text.match(/FOR SALE\s*\$([\d,]{6,})/i)?.[1])
           ?? num(text.match(/"price"\s*:\s*"?\$?([\d,]{6,})/)?.[1]);

  out.beds = num(text.match(/([\d.]+)\s*(?:bd|beds?)\b/i)?.[1]);
  out.baths = num(text.match(/([\d.]+)\s*(?:ba|baths?)\b/i)?.[1]);
  out.sqft = num(text.match(/([\d,]{3,})\s*sq\.?\s*ft/i)?.[1]);
  out.yearBuilt = num(text.match(/(\d{4})\s*Year Built|Year Built\s*(\d{4})/i)?.slice(1).find(Boolean));
  out.daysOnMarket = num(text.match(/(\d+)\s*days? on Redfin/i)?.[1]);
  out.hoaMonthly = num(text.match(/\$([\d,]+)\s*\/\s*mo\.?\s*HOA|HOA Dues?\s*\$([\d,]+)/i)?.slice(1).find(Boolean));

  /* Lot size, with a sanity check.
   *
   * The page mentions acreage in prose as well as in the facts table — "set on
   * 65 acres of protected greenspace", a community amenity rather than the
   * parcel — and the first match won. A suburban lot is between about a
   * hundredth of an acre and five; anything outside that came from a sentence
   * about something else and is dropped rather than believed. */
  const plausible = (a?: number) => (a !== undefined && a >= 0.02 && a <= 5 ? a : undefined);

  /* Labelled fields first, and mind which side of the label the number is on.
   *
   * Redfin's public-records block reads "Legal Lot Number: 65 Acres: 0.21".
   * A pattern of "number, then the word acres" happily matched the LOT NUMBER
   * and reported a quarter-acre suburban plot as sixty-five acres. The value
   * that belongs to a label follows it. */
  /* The label sits on either side depending on which block you are in.
     Facts table:     "0.51 acres Lot Size"
     Public records:  "Lot size 0.51 Acres"
     Older pages:     "Acres: 0.51"
     All three are the real parcel; prose is not. */
  const labelled = plausible(
    num(text.match(/\bAcres?\s*:\s*([\d.]+)/i)?.[1])
    ?? num(text.match(/([\d.]+)\s*acres?\s*Lot\s*Size/i)?.[1])
    ?? num(text.match(/Lot\s*size\s*([\d.]+)\s*Acres?/i)?.[1]),
  );

  const landSqft = num(text.match(/Land\s*Sq\.?\s*Ft\s*:\s*([\d,]+)/i)?.[1])
    ?? num(text.match(/([\d,]{4,})\s*(?:sq\.?\s*ft\.?\s*lot|square foot lot)/i)?.[1]);
  const fromSqft = plausible(landSqft ? Math.round((landSqft / 43_560) * 100) / 100 : undefined);

  /* Prose last, and it is the least trustworthy source here.
     "situated on 1/2 acre" was read as TWO acres, because the pattern happily
     matched the denominator. Fractions are excluded outright — a listing that
     writes its lot as a fraction is not where the precise number lives, and the
     facts table above always has it. */
  const prose = [...text.matchAll(/(?<![:/\d]\s{0,3})\b([\d.]+)\s*[Aa]cres?\b/g)]
    .filter((m) => !/\d\s*\/\s*$/.test(text.slice(Math.max(0, m.index! - 4), m.index!)))
    .map((m) => plausible(num(m[1])))
    .find((a): a is number => a !== undefined);

  out.lotSizeAcres = labelled ?? fromSqft ?? prose;

  out.redfinEstimate = num(text.match(/Redfin Estimate[^$]{0,40}\$([\d,]{6,})/i)?.[1]);

  /* Price history: the highest figure that appears as a previous list price.
     This is the negotiating anchor, so a miss must stay undefined rather than
     become a plausible-looking wrong number. */
  const listed = [...text.matchAll(/(?:Listed|Price Changed|Original List Price)[^$]{0,60}\$([\d,]{6,})/gi)]
    .map((m) => num(m[1]))
    .filter((n): n is number => Boolean(n));
  const highest = listed.length ? Math.max(...listed) : undefined;
  if (highest && out.price && highest > out.price) out.originalPrice = highest;

  /* Assigned schools, which Redfin prints as "Name Public PreK-5 Assigned 0.2mi
     10/10". Averaged across the three, because a family with one child will use
     all of them in turn. */
  const schools = [...text.matchAll(/Assigned[^0-9]{0,40}[\d.]+\s*mi\s*(\d{1,2})\s*\/\s*10/gi)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 1 && n <= 10);
  if (schools.length) out.schoolRating = Math.round((schools.reduce((a, b) => a + b, 0) / schools.length) * 10) / 10;

  /* Redfin's lifestyle block prints walkability out of 10. The app scores on
     the 0-100 Walk Score scale, so multiply. */
  const walk10 = text.match(/([\d.]+)\s*\/\s*10\s*(?:Very Walkable|Walker's Paradise|Some walkability|Car required|Car-Dependent|Somewhat Walkable)/i)?.[1];
  if (walk10) out.walkScore = Math.min(100, Math.round(Number(walk10) * 10));

  out.propertyType = text.match(/(Single[- ]family|Condo|Townhouse|Multi[- ]family|Co-?op)\s*Property Type/i)?.[1];

  /* New construction listings say when they will be finished, and the answer
     ranges from "ready now" to "estimated completion next October". Those are
     completely different purchases given a 90-day move-out clock. */
  const under = /under construction|to be built|pre-?construction|now selling|estimated completion/i.test(text);
  const ready = /move-?in ready|quick move-?in|ready now|available now|completed/i.test(text);
  const when = text.match(/(?:estimated )?completion[^.]{0,30}?((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*\/?\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)?[a-z]*\.?\s*'?\d{2,4})/i)?.[1];

  if (when) out.completionEstimate = when.trim();
  out.readiness = ready && !under ? 'move-in ready'
    : /to be built|pre-?construction/i.test(text) ? 'to be built'
    : under ? 'months'
    : undefined;

  /* Redfin labels these explicitly, and a builder negotiates differently from
     a family, so it belongs on the card rather than buried in the prose. */
  /* The photo badges are the freshest thing on the page and cost nothing —
     the page is already here. They also carry facts the tables do not: a
     listing 26 hours old reads as 0 days on market either way. */
  out.yearBuilt = out.yearBuilt ?? num(text.match(/(\d{4})\s*Year Built|Year Built\s*(\d{4})/i)?.slice(1).find(Boolean));

  const sash = readSashes(html);
  out.sashes = sash.raw;
  out.hoursOnMarket = sash.hoursOnMarket;
  out.has3dTour = sash.has3dTour;
  out.isHot = sash.isHot;
  /* Only the subject's own badge counts.
   *
   * The phrase "NEW CONSTRUCTION" also appears on every nearby-similar-homes
   * card at the bottom of the page, and matching those flagged a 2001 house as
   * new construction — thirty of sixty-two, which is what made it obvious. The
   * badge in home-sash-container belongs to this house; nothing else on the
   * page does. Year built is the only other admissible evidence. */
  const builtThisYearOrLater =
    out.yearBuilt !== undefined && out.yearBuilt >= new Date().getFullYear();
  out.isNewConstruction = sash.isNewConstruction || builtThisYearOrLater;

  /* Status, from the listing's own field rather than from words on the page.
   *
   * Scanning the whole page for "PENDING" marked a hundred and twenty-six of a
   * hundred and thirty-one houses as pending. The word turns up in the market
   * statistics ("the average home goes pending in 47 days"), in a price history
   * from a sale two years ago, and in Redfin's trademark notice ("registered or
   * pending in the USPTO"). None of it was about this house.
   *
   * The page carries `listingStatus` as a field. Where it is missing, the
   * listing is no longer on the market at all — that absence is the signal —
   * and the badge in the sash container says which kind of gone. */
  const listingState = html.match(/"listingStatus"\s*:\s*"([a-z_ ]{1,24})"/i)?.[1]?.toLowerCase();

  if (listingState) {
    out.status =
      listingState === 'active' ? 'for sale'
      : listingState === 'contingent' || listingState === 'pending' ? 'pending'
      : listingState === 'pre_on_market' ? 'for sale'
      : 'unknown';
  } else {
    /* No listing status: it is off the market. Which kind, from the badge. */
    const badge = (sash.raw ?? []).join(' ').toUpperCase();
    out.status =
      /\bSOLD\b/.test(badge) ? 'sold'
      : /\bOFF MARKET\b/.test(badge) ? 'off market'
      : /\bSOLD ON\b/i.test(text) && !/\bFOR SALE\b/i.test(text) ? 'sold'
      : 'off market';
  }

  /* Public sewer is stated plainly; septic usually is too, in the utilities
     block. Ambiguity stays unknown rather than assuming the cheaper answer. */
  /* Every septic mention in the page, minus the ones that are talking about
     the county rather than the house. One listing described zoning — "districts
     are generally served by individual septic tanks" — and got flagged for a
     tank it may not have. A finding has to be about this house. */
  const septicMentions = [...text.matchAll(/\bseptic\b/gi)].filter((m) => {
    const around = text.slice(Math.max(0, (m.index ?? 0) - 120), (m.index ?? 0) + 120);
    return !/district|zoning|generally|typically|county requires|most homes/i.test(around);
  });
  const septic = septicMentions.length > 0;
  const publicSewer = /public sewer|city sewer|sewer:\s*public|municipal sewer/i.test(text);
  out.sewer = septic && !publicSewer ? 'septic' : publicSewer ? 'public' : 'unknown';
  if (out.sewer !== 'unknown') {
    const m = out.sewer === 'septic'
      ? septicMentions[0]
      : text.match(/public sewer|city sewer|municipal sewer/i);
    if (m) {
      const i = Math.max(0, (m.index ?? 0) - 45);
      out.sewerEvidence = '…' + text.slice(i, i + 130).trim() + '…';
    }
  }

  /* Pick the geo block belonging to THIS house.
     A Redfin page carries several — nearby homes, other plans in the same
     community — each paired with its own street address. Taking the first one
     lands you on a neighbour's roof. */
  /* The subject's own address, taken from the page's title rather than the URL,
     because parseFacts only ever sees the bytes. */
  const subject = html.match(/<meta property="og:title" content="([^"]{4,120})"/)?.[1];
  const wanted = subject ? normaliseStreet(subject) : '';
  if (wanted) {
    const blocks = [...html.matchAll(
      /"streetAddress"\s*:\s*"([^"]+)"[\s\S]{0,400}?"geo"\s*:\s*\{[^}]*?"latitude"\s*:\s*(-?\d+\.\d+)\s*,\s*"longitude"\s*:\s*(-?\d+\.\d+)/g,
    )];
    for (const [, addr, la, ln] of blocks) {
      if (normaliseStreet(addr!) !== wanted) continue;
      const lat = Number(la), lng = Number(ln);
      if (Number.isFinite(lat) && Number.isFinite(lng)) out.coords = { lat, lng };
      break;
    }
  }

  const b = detectBasement(text);
  out.basement = b.state;
  out.basementEvidence = b.evidence;

  const about = subjectDescription(html, text);
  if (about) out.description = about;

  const age = readAgeRestriction(about ?? '');
  out.ageRestricted = age.restricted;
  out.ageRestrictedEvidence = age.evidence;

  const { fuel, evidence } = detectCooktop(about ?? text);
  out.cooktopFuel = fuel;
  out.cooktopEvidence = evidence;

  const { years, claimed } = readSystems(about ?? '');
  if (Object.keys(years).length) out.systems = years;
  if (claimed.length) out.systemsClaimed = claimed;

  return out;
}

/**
 * A street address reduced to something two spellings of it agree on.
 *
 * "4835 Rosarian Dr" and "4835 Rosarian Drive" and "4835 Rosarian (lot 58) Dr"
 * are the same house; the page and the URL rarely spell it the same way.
 */
function normaliseStreet(s: string): string {
  const street = s.replace(/[-+]/g, ' ').split(',')[0] ?? '';
  return street
    .toLowerCase()
    .replace(/\((?:lot\s*)?\d+\)/g, ' ')
    .replace(/\blot\s*\d+\b/g, ' ')
    .replace(/\b(drive|dr|road|rd|way|wy|lane|ln|court|ct|street|st|circle|cir|terrace|ter|place|pl|avenue|ave|trace|trce|parkway|pkwy|boulevard|blvd|point|pt|run|walk|pass|bend|ridge|crossing|xing)\b/g, ' ')
    .replace(/\b3\d{4}\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

export async function fetchFacts(
  listingUrl: string, opts?: { fresh?: boolean },
): Promise<ScrapedFacts> {
  return parseFacts(await fetchListingPage(listingUrl, opts));
}

/**
 * When the expensive things were last replaced.
 *
 * `deferredCapital` has always known how to reward a house whose roof is four
 * years old rather than twenty-four — it takes an install year per system and
 * only charges for what is actually near end of life. It was never given any:
 * across 164 houses exactly one had a `systems` record, and that one was typed
 * in by hand. So every other house was scored on its birthday alone, and a 2003
 * house with a 2022 roof and new HVAC was marked down exactly as hard as the
 * one next door with neither.
 *
 * The information was there the whole time. Sellers advertise this work,
 * because it is worth money: "NEW ROOF 2021", "HVAC replaced 2019", "roof is 3
 * years old". `fetchFacts` was already pulling the description out of the page
 * and `enrichListing` was dropping it on the floor two lines later.
 *
 * Only explicit years are taken. "Newer roof" and "recently updated" are
 * sellers' adjectives with no date behind them, and guessing one would put a
 * number into the capital estimate that nobody checked — the rule about not
 * stating what was never established applies to money most of all.
 */
type Claim = NonNullable<ListingFacts['systemsClaimed']>[number];
const SYSTEM_WORDS: [keyof NonNullable<ListingFacts['systems']>, Claim, RegExp][] = [
  ['roofYear', 'roof', /roof/i],
  ['hvacYear', 'hvac', /\b(hvac|a\/?c\b|air conditioner|furnace|heat pump)/i],
  ['waterHeaterYear', 'waterHeater', /water heater/i],
  ['windowsYear', 'windows', /windows?/i],
];

export function readSystems(text: string): {
  years: NonNullable<ListingFacts['systems']>;
  claimed: Claim[];
} {
  const out: NonNullable<ListingFacts['systems']> = {};
  const claims = new Set<Claim>();
  if (!text) return { years: out, claimed: [] };
  const thisYear = new Date().getFullYear();

  /* Anchor on the system word, then look only just after it.
   *
   * The first attempt split the text into sentences and took the first year in
   * each, which is wrong in the exact sentence sellers actually write: "Roof
   * replaced in 2020, HVAC replaced 2019, water heater 2022" gave all three the
   * roof's year, and "new AC 2024, roof only 5 years old" dated the roof from
   * the air conditioner. Years belong to the system they sit beside, so the
   * window is measured from the word itself and stops at the next clause. */
  for (const [key, claimKey, word] of SYSTEM_WORDS) {
    const re = new RegExp(word.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      /* Up to the next comma, full stop or conjunction — one clause, no more. */
      const after = text.slice(m.index, m.index + 70).split(/[.;!\n]|,| and | with | plus /i)[0];
      const before = text.slice(Math.max(0, m.index - 42), m.index);

      const fresh = /\b(new|newer|replaced|updated|upgraded|installed|only)\b/i;
      /* A bare "Roof 2020" in a spec list is a claim too, so an adjacent year
         counts even with no adjective in front of it. */
      /* "roof is 3 years old" carries no adjective — the age IS the claim. */
      const claimed = fresh.test(before) || fresh.test(after)
        || /^\W{0,3}(19|20)\d\d/.test(after.slice(m[0].length))
        || /\d{1,2}\s*(?:-|\s)?\s*year[s]?\s*old/i.test(after);
      if (!claimed) continue;
      /* Something was said about this system. Even with no year attached that
         is worth recording — "newer roof" is a different house from silence. */
      claims.add(claimKey);

      const yr = after.match(/\b(19[89]\d|20[0-4]\d)\b/)?.[1];
      if (yr) {
        const y = Number(yr);
        if (y >= 1980 && y <= thisYear) { out[key] = Math.max(out[key] ?? 0, y); }
        continue;
      }
      const ago = after.match(/(\d{1,2})\s*(?:-|\s)?\s*year[s]?\s*old/i)?.[1];
      if (ago && Number(ago) <= 40) out[key] = Math.max(out[key] ?? 0, thisYear - Number(ago));
    }
  }
  /* A dated system is not also an undated claim. */
  for (const [key, claimKey] of SYSTEM_WORDS) if (out[key] !== undefined) claims.delete(claimKey);
  return { years: out, claimed: [...claims] };
}
