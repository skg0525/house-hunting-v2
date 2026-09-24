/**
 * Judgement.
 *
 * The split that makes this worth trusting:
 *   Gemini does PERCEPTION  — "what does this floor plan actually show?"
 *   This file does JUDGEMENT — "given that, how much do I want it?"
 *
 * Judgement is plain arithmetic. The same perception always produces the same
 * score, so a house you scanned three weeks ago is still comparable to one you
 * scanned this morning. And because no model call is involved, changing your
 * mind about how much the yard matters re-ranks all forty houses for free.
 */
import { Listing, Perception, Orientation, EvidenceBase, DimensionScore, CardinalDirection } from '../types/listing.js';
import { PreferenceProfile, DimensionKey, DIMENSION_LABELS } from '../types/preferences.js';
import { nearBarred, BARRED_DIRECTIONS } from './orientation.js';
import { deferredCapital } from './healthAndSystems.js';

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function verdictFor(score: number): DimensionScore['verdict'] {
  if (score >= 85) return 'ideal';
  if (score >= 65) return 'acceptable';
  if (score >= 40) return 'concern';
  return 'dealbreaker';
}

type Raw = { score: number; reason: string; available?: boolean };

/**
 * What he saw with his own eyes, folded into the reading.
 *
 * This used to happen inside the yard scorer, which meant the score honoured
 * his answer and nothing else did. He stood in the garden at 720 Yasha Ct, saw
 * a fence, ticked the box — the yard scored it as fenced, and the card went on
 * saying "no fence" for days, because the card reads the perception and the
 * perception was still the satellite's guess.
 *
 * Correcting it once, here, means every consumer sees the same answer:
 * the card, the concerns, the narrative and the score. Standing in a garden
 * beats a photograph taken through tree cover, and it should beat it
 * everywhere.
 */
export function withObserved(
  p: Perception, e: EvidenceBase, observed?: Listing['observed'],
): { perception: Perception; evidence: EvidenceBase } {
  if (!observed?.fenced && !observed?.yardSize && observed?.backsOntoWater === undefined
      && observed?.mainFloorBedroom === undefined && observed?.mainFloorFullBath === undefined
      && observed?.primaryOnMain === undefined)
    return { perception: p, evidence: e };
  return {
    perception: {
      ...p,
      yardFenced: observed.fenced ?? p.yardFenced,
      yardUsableSize: observed.yardSize ?? p.yardUsableSize,
      /* Standing water is the one aerial finding that caps a house outright, so
         it needs the same escape hatch the fence has. A pond a hundred and
         eighty metres away past other people's gardens was reported as touching
         the boundary — in a tile too tightly cropped to contain it. */
      backsOntoWater: observed.backsOntoWater ?? p.backsOntoWater,
      waterEvidence: observed.backsOntoWater === false
        ? 'You looked: the nearest water is not against this lot.'
        : observed.backsOntoWater === true
          ? 'You looked: there is open water against this lot.'
          : p.waterEvidence,
      /* What you read off the plan beats what the model read off the plan.
         Same rule as the fence, for the same reason: you were looking at it. */
      mainFloorBedroom: observed.mainFloorBedroom ?? p.mainFloorBedroom,
      mainFloorFullBath: observed.mainFloorFullBath ?? p.mainFloorFullBath,
      primaryBedroomOnMain: observed.primaryOnMain ?? p.primaryBedroomOnMain,
      mainFloorSuiteEvidence:
        observed.mainFloorBedroom === undefined && observed.mainFloorFullBath === undefined
          ? p.mainFloorSuiteEvidence
          : `You read the plan yourself${observed.at ? ` on ${new Date(observed.at).toLocaleDateString()}` : ''}: `
            + [observed.mainFloorBedroom !== undefined
                 ? (observed.mainFloorBedroom ? 'there is a main-floor bedroom' : 'there is no main-floor bedroom')
                 : null,
               observed.mainFloorFullBath !== undefined
                 ? (observed.mainFloorFullBath ? 'with a full bath' : 'and no full bath on that level')
                 : null].filter(Boolean).join(' ')
            + `. That replaces the plan read, which said: ${p.mainFloorSuiteEvidence ?? 'nothing'}`,
      yardEvidence: observed.fenced
        ? `You saw this yourself${observed.at ? ` on ${new Date(observed.at).toLocaleDateString()}` : ''}: ` +
          `${observed.fenced === 'Yes' ? 'it is fenced' : 'it is not fenced'}` +
          `${observed.yardSize ? `, yard ${observed.yardSize.toLowerCase()}` : ''}. ` +
          `That replaces the aerial, which said: ${p.yardEvidence}`
        : p.yardEvidence,
    },
    evidence: { ...e, aerialRead: true, planRead: e.planRead || observed.mainFloorBedroom !== undefined },
  };
}

/* ---------------------------- direction ---------------------------- */

/**
 * The whole southern half is out: South, South-East and South-West. Handled as
 * a rule, not a score — see `rulesBroken` below.
 *
 * This used to bar south alone, and scored South-East 48 and South-West 32 on
 * the reasoning that they lean south without being south. That was the tool
 * inventing a middle ground he never asked for: 3105 Arbor Vine Way came back
 * 69 and near the top of the list facing 236°, which he would not have bought
 * at any price. Ranking a house he has ruled out is worse than not having it.
 *
 * So the scale below is only about the half that is left: east is supposed to
 * be best, north is fine, west is livable.
 */
const ENTRANCE_SCORE: Record<CardinalDirection, number> = {
  'East': 100,
  'North-East': 92,
  'North': 85,
  'North-West': 70,
  'West': 62,
  'South-East': 0,
  'South-West': 0,
  'South': 0,
  /* Below the midpoint on purpose. An unread facing used to sit at 60, just
     above the middle, which quietly rewarded a house for being unreadable —
     and the houses with no Street View are exactly the ones most likely to be
     facing the wrong way. 50 is neutral. */
  'Unknown': 50,
};

const ENTRANCE_NOTE: Partial<Record<CardinalDirection, string>> = {
  'East': 'East-facing — the direction your parents call best.',
  'North-East': 'North-east — considered auspicious, close to east.',
  'North': 'North-facing — well regarded, no objection.',
  'North-West': 'North-west — acceptable, not favoured.',
  'West': 'West-facing — livable, afternoon sun on the front.',
  'South-East': 'South-east — inside the half you will not buy.',
  'South-West': 'South-west — inside the half you will not buy.',
  'South': 'South-facing front door.',
  'Unknown': 'Could not read the facing direction from the plan. Check Street View.',
};

function scoreDirection(o: Orientation): Raw {
  if (o.confidence === 'none' || o.entranceDirection === 'Unknown')
    return { score: 0, reason: o.method, available: false };

  const score = ENTRANCE_SCORE[o.entranceDirection] ?? 60;
  const note = ENTRANCE_NOTE[o.entranceDirection] ?? '';

  /* A low-confidence bearing still gets shown, but it is pulled toward neutral
     so it cannot carry the ranking on its own. The measurement you half-trust
     should nudge, not decide. */
  const blended = o.confidence === 'low' ? Math.round(score * 0.5 + 60 * 0.5)
                : o.confidence === 'medium' ? Math.round(score * 0.75 + 60 * 0.25)
                : score;

  return { score: blended, reason: `${note} ${o.method}`.trim() };
}

/* ---------------------- kitchen & living space ---------------------- */

/**
 * The thing that actually ends viewings.
 *
 * A house was walked, liked, and rejected on the spot because "the kitchen and
 * living area were cramped" — from a couple who cook at home most nights. The
 * floor plan says that kitchen is 27'5" x 13'5", which is 368 square feet and
 * sounds generous. Area was the wrong measure.
 *
 * What made it feel small was shape and separation: a long narrow strip, walled
 * off from a modest living room, with the breakfast nook, dining room and
 * sitting room each boxed away behind their own walls. A 2001 floor plan, built
 * before open concept. Every individual space is fine and none of them is the
 * room you actually want to be in.
 *
 * So this scores three things rather than one: is the kitchen big enough, is it
 * narrow enough to feel like a corridor, and does it open into the room where
 * everyone else is.
 */
function scoreKitchen(
  p: Perception, e: EvidenceBase, l: Listing, wantsGas: boolean,
): Raw {
  const kArea = p.kitchenLengthFt * p.kitchenWidthFt;
  const kNarrow = Math.min(p.kitchenLengthFt, p.kitchenWidthFt);
  const lArea = p.mainLivingLengthFt * p.mainLivingWidthFt;

  if (!e.planRead)
    return { score: 0, available: false, reason: 'No floor plan yet, so the kitchen is unmeasured.' };
  if (kArea <= 0 && lArea <= 0 && p.layoutStyle === 'Unknown')
    return { score: 0, available: false, reason: `Nothing about the kitchen is readable on this plan. ${p.kitchenEvidence}` };

  const parts: string[] = [];

  // Size, judged generously — 180 sq ft is a real cook's kitchen.
  const sizeScore = kArea >= 240 ? 100 : kArea >= 180 ? 85 : kArea >= 140 ? 62 : kArea > 0 ? 35 : 55;
  if (kArea > 0) parts.push(`${Math.round(kArea)} sq ft`);

  /* Width is the part area hides. Under about 11 feet a kitchen is a corridor
     with counters, whatever its length, because two people cannot pass behind
     each other while one is at the range. */
  const widthScore = kNarrow >= 14 ? 100 : kNarrow >= 12 ? 78 : kNarrow >= 10 ? 50 : kNarrow > 0 ? 25 : 55;
  if (kNarrow > 0) parts.push(`${kNarrow.toFixed(0)} ft at its narrowest`);

  const layoutScore =
    p.layoutStyle === 'Open concept' ? 100 :
    p.layoutStyle === 'Partly open' ? 68 :
    p.layoutStyle === 'Compartmentalized' ? 28 : 55;
  if (p.layoutStyle !== 'Unknown') parts.push(p.layoutStyle.toLowerCase());

  const livingScore = lArea >= 340 ? 100 : lArea >= 260 ? 78 : lArea >= 200 ? 55 : lArea > 0 ? 32 : 55;
  if (lArea > 0) parts.push(`living room ${Math.round(lArea)} sq ft`);

  /**
   * Storage and traffic, which are what actually went wrong on the house that
   * was rejected in person.
   *
   * The complaint there was not only floor area. There was no real pantry — the
   * only storage doubled as the laundry closet — and the route from the garage
   * ran through the kitchen. For a household that cooks Indian food most
   * nights, dry storage is not a nice-to-have, and a kitchen people walk
   * through while you cook is smaller in use than its dimensions say.
   *
   * Both of these are drawn on the plan, unlike the photographic judgement they
   * replaced, which called every kitchen in every listing generous.
   */
  let storageScore = 100;
  if (!p.hasPantry) {
    storageScore = 35;
    parts.push('no pantry');
  } else if (p.pantryIsLaundry) {
    storageScore = 45;
    parts.push('the only pantry is the laundry closet');
  } else {
    parts.push('separate pantry');
  }

  let score = clamp(
    sizeScore * 0.22 + widthScore * 0.18 + layoutScore * 0.25
    + livingScore * 0.15 + storageScore * 0.2,
  );

  if (p.kitchenIsThoroughfare) {
    score = Math.min(score, 58);
    parts.push('and the way to the garage runs through it');
  }
  if (p.kitchenHasIsland) {
    score = clamp(score + 4);
    parts.push('island');
  }

  /* Gas is a want, not a rule. Scored inside the kitchen because that is where
     it is felt, and weighted lightly because it is the cheapest thing on this
     whole list to change. */
  if (wantsGas) {
    if (l.cooktopFuel === 'gas' || l.cooktopFuel === 'induction') {
      score = clamp(score + 6);
      parts.push(`${l.cooktopFuel} range`);
    } else if (l.cooktopFuel === 'electric') {
      score = clamp(score - 10);
      parts.push('electric range — this will want changing');
    }
  }

  return { score, reason: `${parts.join(', ')}. ${p.kitchenEvidence}` };
}

/* ------------------------- main-floor suite ------------------------- */

/**
 * Nothing to say without a plan.
 *
 * `mainFloorBedroom: false` is the default of a perception that was never
 * filled in, so on its own it cannot be told apart from a real "no". Reporting
 * the default as a finding is how this said a house with a main-floor guest
 * suite had no main-floor bedroom.
 */
function scoreMainFloor(p: Perception, e: EvidenceBase): Raw {
  if (!e.planRead)
    return { score: 0, reason: 'No floor plan yet — drop one in and this becomes a real answer.', available: false };
  /* Plans present, but not the one that matters.
   *
   * 5050 Savannah Run publishes its 2nd floor (204 m²) and its 3rd (77 m²) and
   * not its 1st (176 m²). Told that the first image was the "main level", the
   * reader found the 3rd-floor bedroom and wet bar and scored the house 100 for
   * a main-floor suite. Numbering the images fixed the label, and the answer
   * fell to 50 — which is no more trustworthy, because it is still an answer
   * about a drawing nobody has.
   *
   * Two plans do not make a main floor. Unknown reads as unknown. */
  if (p.mainFloorPlanSeen === false)
    return {
      score: 0, available: false,
      reason: 'The listing publishes upper floors but not the main one, so there is nothing to read. '
        + 'Upload the first-floor plan, or look when you are there.',
    };
  /* A guest bedroom downstairs and the PRIMARY downstairs are opposite wants.
   *
   * This dimension scored both the same, because it only ever asked "is there a
   * bedroom on the main floor". The first is wanted — visiting family stay for
   * one to two months and it gives them their own space. The second is ruled
   * out outright.
   *
   * Six for six on the houses they have judged: Ashborough, Hawkins, Reserve and
   * Crown Vetch all put the primary upstairs and all four were liked. Bentley
   * Commons and Heritage Drive both put it on the main floor and both were
   * rejected — on the secondary bedrooms, which is a separate fault, but the
   * pattern is clean enough to stop scoring the two arrangements identically.
   *
   * Reported, not a rule-out: it is a household preference, strongly held, but
   * never called non-negotiable. */
  if (p.primaryBedroomOnMain)
    return {
      score: 40,
      reason: 'The primary suite is on the main floor, which this household does not want. '
        + (p.mainFloorBedroom && p.mainFloorFullBath
            ? 'There is a full bath down there, but a downstairs primary is not a guest suite. '
            : '')
        + p.mainFloorSuiteEvidence,
    };

  if (p.mainFloorBedroom && p.mainFloorFullBath)
    return { score: 100, reason: `Guest bedroom and full bath on the main floor, primary upstairs — the arrangement you both wanted. ${p.mainFloorSuiteEvidence}` };
  if (p.mainFloorBedroom)
    return { score: 55, reason: `Main-floor bedroom, but only a half bath on that level. ${p.mainFloorSuiteEvidence}` };
  /* An office or study on the main floor is a guest room when family visits.
     He said as much walking a house that had one, so it is worth real partial
     credit rather than the zero a strict reading would give. */
  if (p.mainFloorFlexRoom)
    return { score: 50, reason: `No main-floor bedroom, but there is an office or flex room that could take a guest bed. ${p.mainFloorSuiteEvidence}` };
  return { score: 15, reason: `No bedroom and no flex room on the main floor. ${p.mainFloorSuiteEvidence}` };
}

/* ------------------------------ yard ------------------------------ */

/**
 * Scored on its own, deliberately kept apart from walkability.
 *
 * You said you want to be able to run from the front door but you do not want
 * to end up with a strip of grass behind the house. Those two wishes fight. If
 * they shared a number the fight would be invisible and you would be picking
 * houses off an average. Here you see both, and you decide.
 */
function scoreYard(
  p: Perception, e: EvidenceBase, lotAcres: number, minLot: number,
): Raw {
  /* Lot acreage alone is not a backyard. Half of a parcel can be driveway,
     woods, or a slope no child plays on, which is the entire reason this reads
     the aerial instead of trusting the number on the listing. */
  /* An aerial with no house in it cannot answer anything about a yard. This
     is not a low score, it is an absence of evidence. */
  if (e.aerialRead && !p.houseVisibleInAerial)
    return {
      score: 0,
      available: false,
      reason:
        `The satellite image predates the house — it shows bare ground, not a garden. ` +
        (lotAcres > 0 ? `The lot is ${lotAcres} acres; what gets done with it is still to come. ` : '') +
        `Nothing about the yard can be read until it exists, or until you go and look.`,
    };

  if (!e.aerialRead)
    return {
      score: 0,
      available: false,
      reason: lotAcres > 0
        ? `No aerial read yet. The listing says ${lotAcres} acres, but that is a parcel size, not a backyard.`
        : 'No aerial read yet.',
    };

  const size =
    p.yardUsableSize === 'Generous' ? 100 :
    p.yardUsableSize === 'Adequate' ? 70 :
    p.yardUsableSize === 'Cramped'  ? 20 : 55;

  const grade =
    p.yardGrade === 'Flat'          ? 100 :
    p.yardGrade === 'Gentle Slope'  ? 72 :
    p.yardGrade === 'Steep Slope'   ? 15 : 55;

  const privacy =
    p.yardPrivacy === 'High'   ? 100 :
    p.yardPrivacy === 'Medium' ? 68 :
    p.yardPrivacy === 'Low'    ? 30 : 55;

  // Usable size leads. A big steep lot is not a place a six-year-old plays.
  let s = size * 0.45 + grade * 0.3 + privacy * 0.15;

  /* Recorded acreage is a weak cross-check on what the aerial suggested — and
     only when it was actually recorded. A blank field must not read as a tiny
     lot. */
  /* Above the floor earns a bonus; below it costs something.
   *
   * This used to be bonus-only, so setting a 0.22 acre minimum changed nothing
   * for the sixteen houses under it — they simply missed out on six points and
   * carried on outranking bigger lots. A floor that only rewards the houses
   * clearing it is not a floor.
   *
   * It is a deduction rather than a rule-out on purpose. Only two things are
   * absolute — the south-facing door and a fenced yard — and a 0.16 acre lot on
   * a street he loves is still a house worth seeing, just one starting from
   * further back. */
  if (lotAcres > 0) {
    s += lotAcres >= minLot * 2 ? 10
       : lotAcres >= minLot ? 6
       : -Math.min(20, Math.round(((minLot - lotAcres) / minLot) * 34));
  } else {
    /* No recorded acreage — which is most new construction, where the plat is
       not filed yet. Silently skipping the term meant an unknown lot scored
       better than a known 0.16 acre one, and four 2026 builds rode that into
       the top twenty. An unknown is not a pass; it costs what the average
       shortfall costs until somebody types the number in. */
    s -= 6;
  }

  if (p.backsOntoMajorRoad) s -= 22;

  const notes = [
    `${p.yardUsableSize.toLowerCase()} usable space`,
    `${p.yardGrade.toLowerCase()}`,
    `${p.yardPrivacy.toLowerCase()} privacy`,
    lotAcres > 0
      ? `${lotAcres} acre lot${lotAcres < minLot ? ` — under the ${minLot} you set` : ''}`
      : 'lot size not entered',
  ];
  if (p.yardFenced === 'Yes') notes.push('fenced');
  if (p.yardFenced === 'No') notes.push('NOT fenced');
  if (p.yardFenced === 'Unclear') notes.push('fence unclear from the aerial');
  if (p.backsOntoMajorRoad) notes.push('backs onto a major road');

  return { score: clamp(s), reason: `${notes.join(', ')}. ${p.yardEvidence}` };
}

/* --------------------------- walkability --------------------------- */

/**
 * Scored on what is actually within a walk, with Walk Score as a cross-check.
 *
 * It used to be the other way round, and two lots in the same Cumming
 * subdivision — at the same coordinates, a few doors apart — came out at 60 and
 * 1. Both numbers were faithfully scraped: Redfin says 6.0/10 for one and
 * 0.1/10 for the other. The difference is not the location, it is that one lot
 * has a street address and the other is still called "lot 58". Walk Score
 * indexes addresses; an unaddressed lot scores near zero by default.
 *
 * That makes Walk Score a measure of how finished a house is as much as where
 * it stands, and half this list is unfinished. Meanwhile the app does its own
 * Places lookup from the coordinates, which found a burger place 57 metres
 * away, a Chinese restaurant at 62, a pizza place at 89 and a chemist at 166.
 *
 * So the count of real amenities within a ten-minute walk leads, because it is
 * measured from the ground rather than looked up by name — and because it gives
 * two houses on the same street the same answer, which any honest walkability
 * measure has to. Walk Score is reported alongside, and where it disagrees
 * sharply the disagreement is stated rather than averaged away.
 */
function scoreWalkability(l: Listing, maxParkWalk: number): Raw {
  const w = l.neighborhood?.walkScore;
  const park = l.nearby?.nearestParkMetres;
  const places = l.nearby?.places ?? [];

  if (w === undefined && park === undefined && !places.length)
    return { score: 0, reason: 'Walkability not looked up yet.', available: false };

  const parts: string[] = [];

  /* Everyday places inside a ten-minute walk. Twelve is as good as it gets
     here — past that the difference stops being one he would feel. */
  const near = places.filter((p) => p.metres <= 800);
  const amenityScore = places.length
    ? clamp(38 + Math.min(near.length, 12) * 5)
    : 55;

  if (near.length) {
    parts.push(
      `${near.length} everyday place${near.length === 1 ? '' : 's'} within a ten-minute walk, ` +
      `starting with ${near[0]!.name} at ${near[0]!.metres} m`,
    );
  } else if (places.length) {
    parts.push('nothing within a ten-minute walk');
  }

  /* Walk Score reported, never averaged in. Where it contradicts what is
     physically there, say so — an unaddressed lot is the usual reason. */
  if (w !== undefined) {
    const disagrees = (w <= 25 && near.length >= 4) || (w >= 60 && near.length === 0);
    parts.push(
      disagrees
        ? `Walk Score says ${w}, which does not match — a lot without a street address ` +
          `scores near zero whatever is around it, so this is scored on what is there`
        : `Walk Score ${w} agrees`,
    );
  }

  /* The specific question underneath the general one: can the stroller get to
     a park. That is a place at a distance, so it is scored as one. */
  let parkScore = 55;
  if (park !== undefined) {
    const nearest = places.find((p) => p.category === 'Parks & playgrounds');
    parkScore = park <= maxParkWalk * 0.5 ? 100
              : park <= maxParkWalk ? 82
              : park <= maxParkWalk * 2 ? 50
              : 20;
    parts.push(
      nearest
        ? `${nearest.name} is ${(park / 1000).toFixed(1)} km away, about ${nearest.walkMinutes} min with a stroller`
        : `nearest park ${(park / 1000).toFixed(1)} km`,
    );
  }

  return { score: clamp(amenityScore * 0.5 + parkScore * 0.5), reason: parts.join('; ') + '.' };
}

/* ----------------------------- schools ----------------------------- */
function scoreSchools(l: Listing): Raw {
  const r = l.neighborhood?.schoolRating;
  if (r === undefined)
    return { score: 0, reason: 'School data not looked up yet.', available: false };
  return { score: clamp(r * 10), reason: `Assigned schools rate ${r}/10.` };
}

/* ---------------------------- diversity ---------------------------- */

/**
 * Two separate signals, exactly as you described it.
 *
 * The first is whether the tract is genuinely mixed — a Simpson index, the odds
 * that two people picked at random are of different backgrounds. The second is
 * whether there is a real South Asian presence without the place being only
 * that. You said you don't want a racist neighborhood and you don't want a
 * hundred-percent Indian one either. That is two conditions, so it is two
 * numbers rather than one blended average that could satisfy neither.
 */
function scoreDiversity(l: Listing): Raw {
  const n = l.neighborhood;
  if (n?.diversityIndex === undefined)
    return { score: 0, reason: 'Census data not looked up yet.', available: false };

  const mixed = clamp(n.diversityIndex * 125);            // ~0.8 index reads as ideal
  const sa = n.southAsianPct ?? 0;
  // Peaks around 18%: present in real numbers, nowhere near dominant.
  const presence = clamp(100 - Math.abs(sa - 18) * 3.0);

  return {
    score: clamp(mixed * 0.6 + presence * 0.4),
    /* Spell the index out rather than printing it bare. "0.53" was being read
       as a percentage of white residents, which is not what it is — it is the
       chance two people picked at random on that street are of different
       backgrounds. Higher is more mixed. The actual white share is a separate
       number and is printed next to it so neither can stand in for the other. */
    /* Who actually lives there, in percentages anybody can read.
     *
     * It used to lead with the Simpson index — "diversity index 0.53" — which
     * he read as "53% white" and which is not what it means. The index is still
     * useful as a single number to sort on, but it belongs after the facts it
     * summarises, not instead of them. */
    reason: [
      n.whitePct !== undefined ? `${n.whitePct.toFixed(0)}% white` : null,
      n.blackPct !== undefined ? `${n.blackPct.toFixed(0)}% Black` : null,
      n.asianPct !== undefined ? `${n.asianPct.toFixed(0)}% Asian` : null,
      n.hispanicPct !== undefined ? `${n.hispanicPct.toFixed(0)}% Hispanic` : null,
      n.otherPct !== undefined && n.otherPct >= 1 ? `${n.otherPct.toFixed(0)}% other` : null,
    ].filter(Boolean).join(', ')
      + `. Of that, ${sa.toFixed(1)}% are South Asian. `
      + (n.diversityIndex >= 0.7 ? 'Genuinely mixed'
         : n.diversityIndex >= 0.5 ? 'Somewhat mixed'
         : 'Fairly homogeneous')
      + ` — two neighbours picked at random differ ${Math.round(n.diversityIndex * 100)}% of the time.`,
  };
}

/* --------------------------- appreciation --------------------------- */

/**
 * Not a forecast. A checklist of the things that showed up in the research as
 * actually correlating with Atlanta price growth, scored honestly.
 *
 * The uncomfortable finding: walkable close-in beat big-lot far-out. That runs
 * against the "more land is worth more later" instinct, and it happens to agree
 * with what you already like. Worth seeing the number rather than being told.
 */
function scoreAppreciation(l: Listing): Raw {
  const w = l.neighborhood?.walkScore;
  if (w === undefined)
    return { score: 0, reason: 'Needs neighborhood data before this means anything.', available: false };

  const age = new Date().getFullYear() - l.yearBuilt;
  const parts: string[] = [];

  // Walkability was the clearest measurable premium in the Atlanta data.
  let s = clamp(w) * 0.45;
  parts.push(w >= 60 ? 'walkable location carries a measurable price premium' : 'car-dependent location, no walkability premium');

  // Lot matters, but as scarcity in a desirable spot, not as raw acreage.
  const lotSignal = l.lotSizeAcres >= 0.25 && w >= 55 ? 100 : l.lotSizeAcres >= 0.25 ? 62 : 55;
  s += lotSignal * 0.2;
  if (lotSignal === 100) parts.push('decent lot in a location where land is scarce');

  // Brand-new construction carries a builder premium that does not survive resale.
  const ageSignal = age <= 2 ? 45 : age <= 10 ? 80 : age <= 30 ? 88 : 65;
  s += ageSignal * 0.2;
  if (age <= 2) parts.push('new build — expect to lose the builder premium on resale');

  // Schools underwrite resale demand even after your own kid is done.
  const school = l.neighborhood?.schoolRating;
  s += (school !== undefined ? clamp(school * 10) : 60) * 0.15;
  if (school !== undefined && school >= 8) parts.push('strong schools support resale demand');

  return { score: clamp(s), reason: parts.join('; ') + '.' };
}

/* ----------------------------- commute ----------------------------- */

/**
 * Scored on the worst leg, not the average.
 *
 * Averaging a 13-minute midday run with a 75-minute evening crawl produces a
 * number that describes no journey anyone makes. The evening peak is the one
 * that decides whether you are home before a toddler's bedtime, so that is the one
 * that counts.
 */
function scoreCommute(l: Listing, ceilingMins: number): Raw {
  const c = l.commute;
  if (!c && l.observedPeakMinutes === undefined)
    return { score: 0, available: false, reason: 'Commute not measured yet.' };

  /* His stopwatch beats the model, every time. */
  const observed = l.observedPeakMinutes;
  const worst = observed ?? c!.worstMinutes;

  /* A curve, not four bands against a ceiling.
   *
   * The ceiling is 45 minutes, set while he was still thinking about the
   * seventy-five minute crawl from the condo. From these houses the evening
   * drive runs eleven to thirty-seven minutes, so every one of them cleared the
   * first or second band and the dimension separated almost nothing — the same
   * flatness as before, from a different cause.
   *
   * Fourteen minutes and thirty-seven minutes are not the same life. Twenty-three
   * minutes each way, twice a day, is about a hundred and ninety hours a year:
   * more than four working weeks in a car. That deserves to be visible.
   *
   * The bad day is what gets scored where Google gave one, because the question
   * is not what the drive usually is — it is how often he misses bedtime. */
  const scored = observed ?? c?.badDayMinutes ?? worst;

  /* The curve hangs off the limit he set rather than off fixed minute marks,
     so changing that one number re-ranks everything the way he would expect.
     At the limit exactly the score is 70 — acceptable, not good. Half the limit
     is as good as it gets, and past it the fall is steep, because a drive over
     the line is a different kind of problem from a merely long one. */
  const r = scored / ceilingMins;
  const score = clamp(
    r <= 0.5 ? 100
    : r <= 1.0 ? 100 - (r - 0.5) * 60      // half the limit -> 100, at it -> 70
    : r <= 1.5 ? 70 - (r - 1.0) * 64       // 1.5x the limit -> 38
    : r <= 2.0 ? 38 - (r - 1.5) * 40       // twice the limit -> 18
    : Math.max(6, 18 - (r - 2.0) * 20),
  );

  /* Still shown against his ceiling, because that is the number he set and a
     drive past it is a different kind of problem from a merely long one. */
  const overCeiling = scored > ceilingMins;

  if (observed !== undefined)
    return {
      score,
      reason: `${observed} min home at peak — your own timing, which beats any estimate. ` +
              (c ? `${c.miles} miles each way.` : '') +
              (overCeiling ? ` Past the ${ceilingMins} minutes you set as the limit.` : ''),
    };

  const evening = c!.legs.find((x) => x.label.startsWith('Evening'));

  /* Score the evening drive, because that is the leg that decides whether he is
     home for a toddler's bedtime.
   *
   * This briefly scored distance instead, on the evidence that all eighty-seven
   * houses came back with no modelled traffic. The evidence was real and the
   * conclusion was wrong: the departure time was landing on Labor Day. With an
   * ordinary Tuesday the same corridor returns 57 minutes against 32 free-flow,
   * so the model works and the time is the better measure.
   *
   * The correction was then half-made. `trafficModelled` goes false when the
   * three legs come back within a few minutes of each other, and the fallback
   * treated that as "we are blind, use distance". But there are two different
   * situations behind one flag: Google giving us nothing, and Google telling us
   * plainly that a 4.8-mile hop inside Alpharetta has no rush hour. In the
   * second we are not blind at all — we have the measured drive, and it is
   * good news.
   *
   * Reading it as blindness punished exactly the houses he is converging on.
   * Twenty-six houses were on the distance branch and every one of them was
   * close in: 1190 Krobot Way, 14 minutes at 5pm and 20 on a bad day, the best
   * commute on the list, scored 70 out of 100 for it. On the curve it is 90.
   * 1340 Waverly Glen at 11 minutes was doing the same.
   *
   * So: if there are legs, there is a measured drive, and the drive is what
   * gets scored. Distance survives only for a house with no commute data at
   * all. A short hop with no delay now reads as what it is. */
  if (c!.legs.length > 0) {
    return {
      score,
      reason:
        `Work to home, leaving 5pm: ${worst} min on a normal evening` +
        (c!.badDayMinutes ? `, ${c!.badDayMinutes} min on a bad one` : '') + '. ' +
        `Off-peak the same drive is ${evening?.freeFlowMinutes ?? '?'} min. ` +
        `${c!.miles} miles each way — ${Math.round(c!.miles * 2 * 235)} miles a year of commuting. ` +
        (overCeiling ? `Past the ${ceilingMins} minutes you set. ` : '') +
        (c!.trafficModelled
          ? `Scored on the bad evening, because that is the one that decides whether you are home for bedtime.`
          : `Google shows no meaningful rush-hour delay on this one — on a hop this short that is credible, `
            + `not a failed lookup, so it is scored on the measured drive like everything else.`),
    };
  }

  /* No legs at all — the routing call failed. Distance is all there is.
   *
   * These bands were calibrated when `anchorMiles` returned straight-line
   * distance; it now returns road miles, which run roughly a third longer on
   * these winding subdivisions, so they are widened to match. A house does not
   * get further from the office because we started measuring it properly. */
  const work = anchorMiles(l, 'work') ?? c!.miles;
  const city = anchorMiles(l, 'home');

  const workScore =
    work <= 4 ? 100 : work <= 6.5 ? 92 : work <= 9 ? 80 :
    work <= 12 ? 66 : work <= 14.5 ? 52 : work <= 17 ? 38 : 24;
  const cityScore =
    city === undefined ? 55 :
    city <= 22 ? 100 : city <= 25 ? 84 : city <= 28 ? 66 : city <= 31 ? 48 : 32;

  return {
    score: Math.round(workScore * 0.7 + cityScore * 0.3),
    reason:
      `${work.toFixed(1)} miles to the office` +
      (city !== undefined ? `, ${city.toFixed(1)} to Midtown` : '') + '. ' +
      `Google predicted no real delay at any hour, which on a hop this short is ` +
      `plausible rather than broken — so this is scored on distance.`,
  };
}

/** Straight-line miles to one of the fixed points, when it was measured. */
function anchorMiles(l: Listing, key: string): number | undefined {
  return l.anchors?.find((a) => a.key === key)?.miles;
}

/* --------------------------- maintenance --------------------------- */
function scoreMaintenance(l: Listing): Raw {
  /* A blank year is not year zero. Left unguarded this produced "Built 0 (2026
     years old). Roof, HVAC and plumbing are likely at or past end of life." for
     a house whose year simply had not been typed in yet. */
  if (!l.yearBuilt || l.yearBuilt < 1800)
    return { score: 0, available: false, reason: 'Year built not entered yet.' };

  const age = new Date().getFullYear() - l.yearBuilt;
  // Roof, HVAC and water heater all cluster around the 20-30 year mark.
  let s = age <= 8 ? 100 : age <= 15 ? 88 : age <= 25 ? 70 : age <= 40 ? 42 : 22;

  /* The bill, not just the birthday.
   *
   * Age was a proxy for the systems being tired; the actual cost of replacing
   * them was computed for the panel underneath and never allowed near the
   * score. A house wanting a roof and two air handlers is thirty thousand
   * dollars dearer than the one beside it, which is larger than most of the
   * price gaps on this list. Where a seller has given install years, this also
   * rewards the house that has already had the work done — which age alone
   * treats as identical to the one that has not. */
  const cap = deferredCapital(l);
  const capHit = Math.min(28, Math.round(cap.total / 1_400));
  s -= capHit;

  const reason =
    `Built ${l.yearBuilt} (${age} years old). ` + (
      cap.total >= 6_000
        ? `About $${(Math.round(cap.total / 1000) * 1000).toLocaleString()} of work due soon — ` +
          `${cap.items.join(', ')}. Treat it as part of the price and say so when you offer.`
        : age > 25 ? 'Budget for at least one major system replacement.'
                   : 'Major systems still well inside their service life.'
    );

  return { score: clamp(s), reason };
}

/* ------------------------ price for what you get ------------------------ */

/**
 * The financial read that was missing entirely.
 *
 * Nothing in the ranking noticed what the money bought. 550 Arbor N Way asks
 * $380 a square foot for 2,000 feet built in 1996; 1040 Krobot Way asks $122
 * for 6,100 built in 2012. Those scored within three points of each other,
 * which is not a defensible position for anyone about to write the largest
 * cheque of their life.
 *
 * Three things, and all three are about this house against the ones it is
 * actually competing with rather than against a national average:
 *
 *   Price per square foot, versus the median of the list. This is crude — it
 *   says nothing about the lot, the finish, or whether the feet are in a
 *   basement — which is exactly why it is one input of three.
 *
 *   Price against the site's own valuation. When a seller asks materially more
 *   than the portal's estimate, that gap is the first argument in the
 *   negotiation and is usually paid for by the buyer who does not notice it.
 *
 *   Cost of carry. HOA dues are money that buys no equity: $260 a month is
 *   $3,120 a year, and at current rates that services roughly $45,000 of
 *   mortgage. A house with high dues has to be better than one without to be
 *   worth the same score.
 */
/**
 * Does the stated floor area fit the stated bedrooms?
 *
 * 725 Caney Fork Rd is listed at 1,241 sq ft with five bedrooms and five and a
 * half baths, asking $1,181,650. That is 248 sq ft per bedroom before a single
 * hallway, kitchen or stair — the house cannot exist. Refetching the page
 * returns the same figure, so it is wrong at the source rather than in the
 * parse, and nothing here can repair it.
 *
 * What it must not do is vote. One impossible house at $952/sq ft sat in the
 * corpus median that every other house was then judged against. The number is
 * refused rather than guessed at: unknown reads as unknown.
 */
function plausibleArea(l: Listing): boolean {
  /* The floor area is the lot area.
   *
   * 1040 Krobot Way: sqft 6,098, lot 0.14 acres — which is 6,098 square feet,
   * the same number to the rounding. The listing's floor-area field carries the
   * LOT size, so the house was scored at $123/sq ft and came out as the single
   * best value in a hundred and forty-seven houses. It was not; the number was
   * the wrong field.
   *
   * The bedroom test below could never catch this one — 6,098 over five beds
   * looks generous, not impossible. What gives it away is the coincidence: two
   * fields that measure different things agreeing exactly. He caught it by
   * knowing the street, which is not a check this app can run. This is.
   *
   * A house whose heated area genuinely equals its lot area would be a
   * full-coverage tower on a suburban lot, so the false-positive risk is nil. */
  const lotSqft = (l.lotSizeAcres || 0) * 43_560;
  if (l.sqft && lotSqft && Math.abs(l.sqft - lotSqft) <= Math.max(2, lotSqft * 0.001))
    return false;

  if (!l.sqft || !l.beds) return true;      // nothing to contradict
  return l.sqft / l.beds >= 300;
}

function scoreValue(
  l: Listing,
  medianPsf: number | undefined,
  neighbourhoodPsf?: number,
  medianLandPsf?: number,
): Raw {
  if (!plausibleArea(l))
    return {
      score: 0, available: false,
      reason: `The listing gives ${l.sqft.toLocaleString()} sq ft for ${l.beds} bedrooms, which cannot be right. `
        + 'Price per foot is left unknown rather than computed from it.',
    };

  const bench = neighbourhoodPsf ?? medianPsf;
  if (!l.price || !l.sqft || !bench)
    return { score: 0, available: false, reason: 'Needs a price and a floor area before this means anything.' };

  const psf = l.price / l.sqft;
  const parts: string[] = [];

  /* Measured against the houses actually around it where we have them, and
     against the middle of the list only when we do not.
     
     These are not the same yardstick and the gap is not small: 1340 Waverly
     Glen is 12% under the corpus median and 2% under its own neighbourhood —
     the difference between "a bargain" and "the going rate". The comparable
     set was already being computed, shown in a panel, and ignored by the score.
     
     A tenth cheaper per foot is a genuinely better buy; a fifth dearer needs a
     reason you can name. */
  const rel = psf / bench;
  const psfScore =
    rel <= 0.8 ? 100 : rel <= 0.9 ? 88 : rel <= 1.0 ? 74 :
    rel <= 1.1 ? 60 : rel <= 1.25 ? 44 : 26;
  parts.push(
    `$${Math.round(psf)}/sq ft against a $${Math.round(bench)} `
    + (neighbourhoodPsf ? 'median for comparable houses within two miles' : 'median across your list')
    + ' — ' +
    (rel <= 0.9 ? 'cheaper per foot than most'
     : rel <= 1.1 ? 'about the going rate'
     : 'dearer per foot than most'),
  );

  /* The same money measured against the ground it buys.
   *
   * Price per foot of BUILDING answers "am I overpaying for this house". Price
   * per foot of LOT answers "what am I getting for the money" — and on this
   * list the two disagree hard enough to reverse a ranking. 1435 Woodall Trace
   * is the cheapest house per built foot on the whole list at $164, and 26%
   * DEARER than the middle per foot of land: it is a very large house on an
   * ordinary lot. 6410 Hawkins Mnr Dr is mid-table on the building at $231 and
   * 34% under on the land. 6645 Cortland Walk is $402 a foot of ground, five
   * times the median.
   *
   * Both belong in the score because he is buying both, and because a fenced
   * back garden he can actually use is third on his list. The yard dimension
   * asks whether the ground is any good; this asks what it cost. */
  let landScore = 60;
  const lotSqft = (l.lotSizeAcres || 0) * 43_560;
  if (lotSqft > 0 && medianLandPsf) {
    const landPsf = l.price / lotSqft;
    const lrel = landPsf / medianLandPsf;
    landScore =
      lrel <= 0.6 ? 100 : lrel <= 0.8 ? 88 : lrel <= 1.0 ? 74 :
      lrel <= 1.25 ? 58 : lrel <= 1.6 ? 40 : 22;
    parts.push(
      `$${Math.round(landPsf)}/sq ft of land against a $${Math.round(medianLandPsf)} median — ` +
      (lrel <= 0.8 ? `${l.lotSizeAcres} acres is a lot of ground for the money`
       : lrel <= 1.25 ? 'about the going rate for the ground'
       : `${l.lotSizeAcres} acres is dear for what the lot is`),
    );
  }

  /* The asking price against the portal's own valuation of it. */
  let estScore = 60;
  if (l.redfinEstimate && l.redfinEstimate > 0) {
    const over = (l.price - l.redfinEstimate) / l.redfinEstimate;
    estScore = over <= -0.05 ? 100 : over <= -0.01 ? 88 : over <= 0.02 ? 72 :
               over <= 0.06 ? 52 : 30;
    parts.push(
      over > 0.02 ? `asking ${(over * 100).toFixed(0)}% above the site's own estimate — that gap is your opening argument`
      : over < -0.01 ? `asking ${(-over * 100).toFixed(0)}% below the site's own estimate`
      : 'asking about what the site values it at',
    );
  }

  /* Dues buy no equity. */
  const hoa = l.hoaMonthly || 0;
  const hoaScore = hoa === 0 ? 100 : hoa <= 75 ? 88 : hoa <= 125 ? 74 : hoa <= 200 ? 58 : hoa <= 300 ? 40 : 24;
  if (hoa > 125)
    parts.push(`$${hoa}/mo dues — $${(hoa * 12).toLocaleString()} a year that buys no equity`);

  return {
    /* The old 0.5 on price-per-foot, split between the building and the ground
       it stands on. The estimate gap and the dues keep the weights they had. */
    score: clamp(psfScore * 0.3 + landScore * 0.2 + estScore * 0.3 + hoaScore * 0.2),
    reason: parts.join('; ') + '.',
  };
}

/* -------------------------- orchestration -------------------------- */

/**
 * The arithmetic, shown rather than asserted.
 *
 * A house scored 58 and the reason was four screens away in a concerns list.
 * "Why is this 58?" should be answerable from the score itself — otherwise the
 * number is something to be taken on trust, and a number taken on trust is one
 * you stop arguing with.
 */
export interface ScoreMath {
  /** Sum of score x weight, over dimensions that had data. */
  weightedTotal: number;
  /** Sum of those weights — the divisor. */
  knownWeight: number;
  /** Sum of every weight, including dimensions with no data. */
  allWeight: number;
  /** The weighted average before any cap. */
  average: number;
  /** The ceiling imposed by how little is known, if it bit. */
  coverageCap?: number;
  /** The cap that actually decided the number, and why. */
  cappedBy?: { limit: number; reason: string };
}

export interface ScoreOutcome {
  matchScore: number;
  math: ScoreMath;
  /**
   * The weighted score before any cap, rule-out, or verdict is applied.
   *
   * Without this the caps are invisible and confusing: every house here was
   * pinned at 15 or 20 by a rule-out or a rejection, so moving a preference
   * slider changed nothing on screen and the whole panel looked broken. Showing
   * both numbers says what is actually true — the ranking did move, and
   * something you decided is overriding it.
   */
  baseScore: number;
  /** Set when a non-negotiable is broken. The house is out, whatever it scored. */
  ruledOut: string | null;
  dimensions: DimensionScore[];
  concerns: string[];
  verdict?: 'rejected' | 'tooFar' | 'maybe' | 'shortlisted' | 'selfTour' | 'agentTour' | 'toured';
}

export function scoreProperty(
  listing: Listing,
  perception: Perception,
  evidence: EvidenceBase,
  orientation: Orientation,
  profile: PreferenceProfile,
  /**
   * What the rest of the list looks like, so "expensive" can mean expensive
   * against the houses he is actually choosing between rather than against a
   * national figure. Absent on a single-house rescore, which simply leaves the
   * value dimension unknown rather than guessing.
   */
  market?: { medianPsf?: number; neighbourhoodPsf?: number; medianLandPsf?: number },
): ScoreOutcome {
  const { nonNegotiables: nn, preferences: pref } = profile;

  const raw: Record<DimensionKey, Raw> = {
    direction: scoreDirection(orientation),
    kitchen: scoreKitchen(perception, evidence, listing, pref.gasCooktopWanted),
    mainFloorSuite: scoreMainFloor(perception, evidence),
    yard: scoreYard(perception, evidence, listing.lotSizeAcres, pref.minLotAcres),
    walkability: scoreWalkability(listing, pref.maxParkWalkMetres),
    schools: scoreSchools(listing),
    diversity: scoreDiversity(listing),
    appreciation: scoreAppreciation(listing),
    commute: scoreCommute(listing, pref.maxCommuteMinutes),
    maintenance: scoreMaintenance(listing),
    value: scoreValue(listing, market?.medianPsf, market?.neighbourhoodPsf, market?.medianLandPsf),
  };

  const dimensions: DimensionScore[] = (Object.keys(raw) as DimensionKey[]).map((key) => {
    const available = raw[key].available !== false;
    return {
      key,
      label: DIMENSION_LABELS[key],
      score: raw[key].score,
      weight: profile.weights[key] ?? 0.5,
      verdict: available ? verdictFor(raw[key].score) : 'unknown',
      reason: raw[key].reason,
      available,
    };
  });

  // Only dimensions we actually have data for get a vote.
  const scored = dimensions.filter((d) => d.available);
  const knownWeight = scored.reduce((s, d) => s + d.weight, 0);
  const allWeight = dimensions.reduce((s, d) => s + d.weight, 0) || 1;
  let matchScore = clamp(scored.reduce((s, d) => s + d.score * d.weight, 0) / (knownWeight || 1));

  /* A half-researched house must not outrank a fully-researched one.
     Averaging only the dimensions we happen to know is right per dimension and
     wrong for the ranking: a house with nothing looked up yet scores on the four
     things it aces and lands above a house we know everything about. That puts
     the least-understood houses at the top of the list, which is precisely
     backwards. So the ceiling rises with how much is actually known — an
     unresearched house stays visible and obviously worth enriching, without
     being allowed to claim a spot it has not earned. */
  const coverage = knownWeight / allWeight;
  /* Tightened from 58 + 42 x coverage, which barely bit: a house we knew
     two-thirds about could still reach 86, and one did — 506 Boardwalk Wy sat
     sixth on the list with no floor plan, no lot size and no park data. The
     ceiling now starts lower, so a house has to be researched to rank, and
     the fastest way to lift it is to drop the floor plan in. */
  const coverageCap = coverage < 0.999 ? Math.round(42 + 58 * coverage) : undefined;
  const averageBeforeCaps = matchScore;
  if (coverageCap !== undefined) matchScore = Math.min(matchScore, coverageCap);

  /* Snapshot taken here: after the honest arithmetic, before anything that
     pins the number. */
  const baseScore = matchScore;

  /* Everything below can lower the score or remove the house entirely, so both
     helpers are declared up front — the fence logic needs `cap` and used to sit
     above it. */
  const concerns: string[] = [];

  /* Remember which cap actually decided the number. Several may fire; only the
     lowest one is the reason the score is what it is. */
  let cappedBy: ScoreMath['cappedBy'];
  const cap = (limit: number, msg: string) => {
    concerns.push(msg);
    if (limit < matchScore) cappedBy = { limit, reason: msg };
    matchScore = Math.min(matchScore, limit);
  };

  let ruledOut: string | null = null;
  const ruleOut = (msg: string) => { if (!ruledOut) ruledOut = msg; };

  /* ---- The ones you will not trade away ---- */

  /* 55+ first, because it is the only one that is not a preference.
   *
   * A south-facing door is a rule he chose and could in principle unchoose. An
   * age-restricted community is the law: these buyers are not 55+, and there is
   * a three-year-old, so a child cannot live there. No amount of yard or schools or commute makes
   * the house buyable, and it should be said before anything else is measured.
   *
   * Redfin has no field for it. It is in the description, in prose, and the
   * tool read right past it — 7395 Winderlea Ln scored 74 and made a Sunday
   * tour list. He caught it by reading the listing himself. */
  if (listing.ageRestricted) {
    ruleOut(
      'This is a 55+ / active adult community. Not a preference — you are not 55 ' +
      'and a young child cannot live here, so the house is out whatever else ' +
      'it has.' + (listing.ageRestrictedEvidence ? ` The listing says: "${listing.ageRestrictedEvidence}"` : ''),
    );
  }

  /* ---- The two you will not trade away ---- */

  /* Only a measurement worth trusting gets to rule a house out. A shaky bearing
     sends you to Street View instead — being told to spend thirty seconds
     looking is a small cost, and silently discarding a house you would have
     loved is not. */
  /* A road-map read never rules a house out any more.
   *
   * That fallback asks a model which side of the marker the nearest road is on,
   * and it has been caught answering the opposite — 4540 Manning Dr came back
   * "West" with its own reasoning saying the road was east. Asking the question
   * twice catches an inconsistent inversion but not a consistent one, and a
   * source that can be confidently backwards must not be allowed to delete a
   * house. Forty-five of these have no Street View, and five of them were out
   * on this evidence alone.
   *
   * It still reports, loudly, with the thirty seconds of work that settles it. */
  /* How far the tool is allowed to go on each kind of reading.
   *
   * A model asked to look at a picture of a road map has been caught answering
   * the exact opposite of its own reasoning, so it never deletes a house. Road
   * network geometry is better — it is arithmetic on real road lines — but its
   * quality is entirely the distance to that road. Twenty metres is the street
   * the house fronts; sixty is very possibly a different street altogether,
   * which is how 7395 Winderlea Ln came back south off a road 63 m away.
   *
   * 35 m is the line. Under it the geometry decides; over it, it reports.
   *
   * This used to be a substring search for 'road map' against prose that said
   * 'road network', so it never matched and every fallback reading ruled out
   * regardless. See `Orientation.source`. */
  const m = orientation.method ?? '';
  /* Readings cached before `source` existed only have the prose. Recovering it
     from there is a migration, not a design — every new reading carries the
     field, and re-reading 180 houses to backfill it costs real money. */
  const src = orientation.source
    ?? (m.includes('road map') ? 'roadMapModel'
      : m.includes('road network') ? 'roadNetwork'
      : m.includes('no road readable') ? 'none'
      : 'streetview');
  const metres = orientation.sourceMetres
    ?? Number(/nearest road is (\d+) m away/.exec(m)?.[1] ?? NaN);
  const tooFarToTrust = src === 'roadNetwork' && (Number.isNaN(metres) || metres > 35);
  const mayNotRuleOut = src === 'roadMapModel' || src === 'none' || tooFarToTrust;

  const barred = (BARRED_DIRECTIONS as readonly string[])
    .includes(orientation.entranceDirection);
  const deg = orientation.bearingDeg !== null
    ? ` (${orientation.bearingDeg.toFixed(0)}°)` : '';
  const named = orientation.entranceDirection.toLowerCase();

  if (nn.noSouthernEntrance && barred) {
    if (mayNotRuleOut)
      concerns.push(
        `This reads as ${named}-facing${deg}, but ` +
        (tooFarToTrust
          ? `off a road ${metres} m away, which at that distance may not be ` +
            'this house\'s street at all'
          : 'from the road map rather than from Street View, and that reading has been wrong ' +
            'by a full 180° before') +
        '. Not ruled out on it. Open the satellite view: the side the driveway meets the ' +
        'road is the front.',
      );
    else if (orientation.confidence === 'high' || orientation.confidence === 'medium')
      ruleOut(
        `Front door faces ${named}${deg}. South, south-east and south-west are all ` +
        'hard lines, so the house is out.',
      );
    else
      concerns.push(
        `This may be ${named}-facing, but the bearing is not reliable enough to ` +
        'rule it out. Open Street View before you spend a Saturday on it.',
      );
  } else if (nn.noSouthernEntrance && orientation.bearingDeg !== null
             && nearBarred(orientation.bearingDeg)) {
    concerns.push(
      `Facing ${orientation.bearingDeg.toFixed(0)}° — outside the southern half, but close ` +
      'enough to the boundary that a few degrees of error would put it inside. Worth a look.',
    );
  }

  /* THE FENCE IS REPORTED, NOT SCORED.
   *
   * It used to cap: 45 when no neighbouring fences were visible, 62 when the
   * aerial could not tell, 78 when he had looked and seen none. Those caps ran
   * the whole ranking. Half the list is new construction, new construction is
   * handed over unfenced, and a satellite cannot distinguish "unfenced" from
   * "unfenceable" — so the tool was pinning good houses at 45 on the strength
   * of a photograph, and turning the weight sliders barely moved anything
   * because a cap does not care what the weights say.
   *
   * The asymmetry that settles it: a fence is four to nine thousand dollars and
   * a Monday phone call. A south-facing door cannot be bought at any price.
   * Treating the two the same was the mistake — one is a purchase, the other is
   * the house.
   *
   * So the yard is judged on what a yard is judged on: usable size, how flat it
   * is, privacy, and the lot. The fence becomes a fact on the card and a filter
   * in the list, where he can ask for the fenced ones when he wants them.
   *
   * Two exceptions survive, and only two, because neither is a purchase:
   * a condo has no private yard to fence at any price, and an HOA that forbids
   * fences is permanent. The second is only ever known because he typed it in —
   * which is the point. No image rules a house out any more.
   */
  const seenFenced = listing.observed?.fenced;
  const noPrivateYard = /condo|apartment|co-?op/i.test(listing.propertyType);

  if (nn.fencedYardRequired && noPrivateYard) {
    ruleOut(
      `This is a ${listing.propertyType.toLowerCase()} — there is no private yard to fence, ` +
      `which is the one thing you said you would not give up.`,
    );
  } else if (nn.fencedYardRequired && listing.fencePermitted === 'no') {
    ruleOut('You recorded that the HOA does not allow a fence here. That cannot be bought.');
  } else {
    /* Everything else is a note, and the cost is named so it can be negotiated
       rather than absorbed. */
    const fenced = seenFenced ?? (evidence.aerialRead ? perception.yardFenced : undefined);

    if (fenced === 'No' && listing.fencePermitted === 'yes')
      concerns.push(
        'No fence today, but you have recorded that the HOA allows one. ' +
        'Roughly $4,000-9,000 on a lot this size — ask the seller to cover it.',
      );
    else if (fenced === 'No' && evidence.aerialRead && !perception.houseVisibleInAerial)
      concerns.push(
        'No fence, but the satellite image predates the house — it shows bare ground. ' +
        'New builds are handed over unfenced as a rule. Budget $4,000-9,000 and check ' +
        'the covenants allow it.',
      );
    else if (fenced === 'No')
      concerns.push(
        'No fence. Usually $4,000-9,000 to put one in and a normal thing to ask the ' +
        'seller for — but confirm the covenants permit it before you offer, because ' +
        'an HOA that forbids fences is the one version of this you cannot fix.',
      );
    else if (fenced === 'Unclear')
      concerns.push(
        'Could not tell from the aerial whether the yard is fenced — tree cover hides ' +
        'fence lines. One look answers it.',
      );
  }

  /* ---- Everything else is a matter of degree ---- */

  /* Everything below reads an image. If the image was never read, there is
     nothing to say — and saying it anyway is the failure mode this whole file
     is built to avoid. */
  if (!evidence.planRead)
    concerns.push('No floor plan read yet, so the main-floor bedroom and bath are still unknown.');

  if (!evidence.aerialRead)
    concerns.push('No aerial read yet, so the fence and the usable yard are still unknown.');

  if (evidence.aerialRead && !seenFenced && nn.fencedYardRequired && perception.yardFenced === 'Unclear')
    concerns.push('Could not tell from the aerial whether the yard is fenced — worth one look before you drive out.');

  /* No cap here on purpose. The Main-Floor Bedroom + Bath dimension already
     scores this — a missing bedroom takes it to 15, a flex room to 50 — and
     capping the total as well punished the same fact twice. Crown Vetch scored
     80 on its dimensions and was then pinned to 55 for a shortcoming already
     priced in. It is a want, not a rule, and one penalty is enough. */
  if (evidence.planRead && !perception.mainFloorBedroom && !perception.mainFloorFlexRoom)
    concerns.push('No bedroom and no flex room on the main floor — nowhere to put guests downstairs.');

  if (evidence.aerialRead) {
    if (perception.yardUsableSize === 'Cramped')
      cap(58, 'The usable backyard is cramped — the thing you said you did not want to end up with.');

    if (perception.yardGrade === 'Steep Slope')
      cap(60, 'Steep rear grade. Less usable yard than the acreage suggests, plus drainage risk.');

    if (perception.backsOntoMajorRoad)
      concerns.push('Backs onto or fronts a major road — noise, and not somewhere a child plays unsupervised.');

    /* Standing water against the garden is the one hazard a satellite answers
       better than a viewing — from the ground you often cannot see over the
       fence. Two problems at once for a family with a young child: drowning
       risk, and mosquitoes all summer from water that never moves. */
    if (perception.backsOntoWater)
      cap(64,
        `Open water against the lot. ${perception.waterEvidence} ` +
        `Retention ponds sit at the low corner of a subdivision — a drowning risk with a ` +
        `six-year-old, and stagnant water breeds mosquitoes from May to September. Worth ` +
        `seeing how close it actually comes to the garden before anything else.`,
      );
  }

  /* Ask price is an opening position, not a price.
     Capping on ask throws away houses he would win at his own number. What
     matters is whether his ceiling is reachable from the ask with the kind of
     negotiation he actually does, so that is what gets checked — and the gap is
     reported as a target to hit rather than a reason to stop reading. */
  if (listing.price > pref.maxPrice) {
    const reachable = listing.price * (1 - pref.negotiationRoomPct);
    const offPct = ((listing.price - pref.maxPrice) / listing.price) * 100;
    const gap = `Asking $${listing.price.toLocaleString()}, which is ${offPct.toFixed(0)}% over your $${pref.maxPrice.toLocaleString()} ceiling — you would need them down to your number.`;

    if (reachable <= pref.maxPrice) {
      // Inside his usual negotiating range. Worth pursuing, priced accordingly.
      concerns.push(gap + ` That is within the ${(pref.negotiationRoomPct * 100).toFixed(0)}% you normally get.`);
      matchScore = Math.max(0, matchScore - 4);
    } else {
      cap(74, gap + ` That is more than the ${(pref.negotiationRoomPct * 100).toFixed(0)}% you normally get, so it would take an unusual seller.`);
    }

    if (listing.daysOnMarket !== undefined && listing.daysOnMarket >= 45)
      concerns.push(`${listing.daysOnMarket} days on the market. That is leverage — a seller doing arithmetic on carrying costs.`);
  }

  if (listing.yearBuilt >= 1800 && listing.yearBuilt < pref.minYearBuilt)
    concerns.push(`Built ${listing.yearBuilt}, older than your ${pref.minYearBuilt} cutoff.`);

  if (listing.commute && listing.commute.worstMinutes > pref.maxCommuteMinutes * 1.4)
    cap(62,
      `${listing.commute.worstMinutes} minutes home in the evening peak, against a ` +
      `${pref.maxCommuteMinutes} minute ceiling. That is the drive you would make twice a ` +
      `day, and it is the thing you already dislike about where you live.`,
    );

  /* Your verdict sorts the list. It no longer rewrites the score.
   *
   * Rejecting a house used to pin it to 20, which made it impossible to answer
   * the obvious question — "what would this have scored if I hadn't passed on
   * it?" — and made un-rejecting look broken, because the number that came back
   * was a capped one for unrelated reasons. The house still drops to the bottom
   * and into the "Out" bucket; the score just stays true. */
  const verdict = profile.propertyFeedback?.[listing.id];
  if (verdict === 'rejected') concerns.unshift('You marked this one as not for you.');
  /* Parked, not rejected. The house may be fine; the drive is not. Say which,
     so that widening the search later is a decision about commute rather than
     a re-read of eighty houses. */
  if (verdict === 'tooFar') concerns.unshift('You parked this one on the drive alone — 26 minutes or more at 5pm.');

  if (ruledOut) matchScore = Math.min(matchScore, 15);

  const math: ScoreMath = {
    weightedTotal: Math.round(scored.reduce((s, d) => s + d.score * d.weight, 0) * 10) / 10,
    knownWeight: Math.round(knownWeight * 100) / 100,
    allWeight: Math.round(allWeight * 100) / 100,
    average: averageBeforeCaps,
    coverageCap: coverageCap !== undefined && coverageCap < averageBeforeCaps ? coverageCap : undefined,
    cappedBy,
  };

  return { matchScore, baseScore, math, ruledOut, dimensions, concerns, verdict };
}
