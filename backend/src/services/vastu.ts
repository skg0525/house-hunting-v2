/**
 * The full Vastu reading, and how it is kept honest.
 *
 * Only one rule drives the score: the front door must not face south. That is
 * the one he is certain of, and a scoring system built on rules he is unsure
 * about would quietly rank houses on someone else's beliefs.
 *
 * Everything else in this file is INFORMATIONAL. It reports what classical
 * Vastu Shastra says about each room's placement, grouped by what the tradition
 * associates it with — wealth, health, family, and so on — so he can read it,
 * disagree with it, or ask family. None of it moves a number unless the buyer
 * turns it on.
 *
 * THE ORIENTATION PROBLEM, AND WHY THIS WORKS AT ALL
 *
 * Listing floor plans have no north arrow, so a room's quadrant cannot be read
 * off the page. But two things are known: which edge of the drawing the front
 * door sits on, and — measured from Street View or road geometry — which way
 * the house actually faces. The difference between those is the rotation of the
 * drawing, and once you have that, every room on the page can be turned into a
 * true compass position.
 *
 *   plan edge "Bottom" + house faces East  ->  the bottom of the page is East
 *   so a room in the top-left of the page is West-North -> North-West
 *
 * The reading is therefore only as good as the measured facing. When the facing
 * is unknown, this returns nothing rather than guessing.
 */
import { CardinalDirection, Orientation, Perception } from '../types/listing.js';

const COMPASS: CardinalDirection[] = [
  'North', 'North-East', 'East', 'South-East',
  'South', 'South-West', 'West', 'North-West',
];

const DEG: Record<string, number> = {
  North: 0, 'North-East': 45, East: 90, 'South-East': 135,
  South: 180, 'South-West': 225, West: 270, 'North-West': 315,
};

/** Where each edge of the page points, once the rotation is known. */
const EDGE_DEG: Record<string, number> = { Top: 0, Right: 90, Bottom: 180, Left: 270 };

/**
 * Rotate a position on the page into a true compass direction.
 *
 * `planEdge` is the edge the front door sits on; `facing` is the measured
 * direction the front door points. Their difference rotates the whole drawing.
 */
export function rotateToCompass(
  positionOnPlan: string,
  entranceEdgeOnPlan: string,
  facing: CardinalDirection,
): CardinalDirection | null {
  const edge = EDGE_DEG[entranceEdgeOnPlan];
  const face = DEG[facing];
  const pos = DEG[positionOnPlan];
  if (edge === undefined || face === undefined || pos === undefined) return null;

  // How far the page is turned relative to true north.
  const rotation = (face - edge + 360) % 360;
  return COMPASS[Math.round((((pos + rotation) % 360) / 45)) % 8] ?? null;
}

export type VastuTheme =
  | 'Wealth & prosperity' | 'Health' | 'Family harmony'
  | 'Career & growth' | 'Peace of mind';

export interface VastuReading {
  element: string;
  theme: VastuTheme;
  actual: CardinalDirection | 'Unknown';
  ideal: string;
  verdict: 'favourable' | 'acceptable' | 'unfavourable' | 'unknown';
  says: string;
  /** A fault the tradition says cannot be remedied — reported, never scored. */
  noRemedy?: boolean;
}

/**
 * Classical placements, as the tradition states them.
 *
 * Written as "the tradition says", not as fact, because that is what it is —
 * a body of belief with real cultural weight and no engineering behind it. He
 * asked to see it; he did not ask to be told it is true.
 */
export type VastuSchool = 'classical' | 'mahavastu';

export interface VastuRule {
  key: string; element: string; theme: VastuTheme;
  best: CardinalDirection[]; ok: CardinalDirection[]; worst: CardinalDirection[];
  says: string;
  /** Faults the tradition holds have no remedy at all. Reported, never scored. */
  noRemedy?: CardinalDirection[];
}

export const RULES: VastuRule[] = [
  {
    key: 'entrance', element: 'Main entrance', theme: 'Wealth & prosperity',
    best: ['East', 'North', 'North-East'], ok: ['West', 'North-West'],
    worst: ['South', 'South-West'],
    noRemedy: ['South-West'],
    says: 'The entrance is where the tradition says prosperity enters. East and north are ' +
          'considered the best; a south-facing door is the placement most often warned about, ' +
          'and is your one hard rule. A south-west entrance is held to be one of only two ' +
          'faults with no remedy — the other is a north-east toilet — so it is flagged ' +
          'separately from the merely unfavourable.',
  },
  {
    key: 'kitchen', element: 'Kitchen', theme: 'Health',
    best: ['South-East'], ok: ['North-West'], worst: ['North-East', 'South-West'],
    says: 'The south-east is the fire corner, so it is the classical place for a kitchen. ' +
          'North-west is the usual second choice. The north-east is specifically discouraged.',
  },
  {
    key: 'primaryBedroom', element: 'Primary bedroom', theme: 'Family harmony',
    best: ['South-West'], ok: ['South', 'West'], worst: ['North-East'],
    says: 'The south-west is associated with stability and is the classical place for the ' +
          'heads of the household. The north-east is discouraged for a primary bedroom.',
  },
  {
    key: 'childBedroom', element: "Child's bedroom", theme: 'Career & growth',
    best: ['West', 'North-West'], ok: ['East', 'North'], worst: ['South-West'],
    says: 'West and north-west are the traditional placements for children, associated with ' +
          'growth and study.',
  },
  {
    key: 'livingRoom', element: 'Living room', theme: 'Family harmony',
    best: ['North', 'North-East', 'East'], ok: ['North-West', 'West'], worst: ['South-West'],
    says: 'The north and east are where the tradition places shared family space, for light ' +
          'and for gathering.',
  },
  {
    key: 'poojaSpace', element: 'Prayer space', theme: 'Peace of mind',
    best: ['North-East'], ok: ['North', 'East'], worst: ['South', 'South-West'],
    says: 'The north-east is the most auspicious corner in the tradition and the classical ' +
          'place for a prayer room or shrine.',
  },
  {
    key: 'masterBath', element: 'Bathrooms', theme: 'Health',
    best: ['North-West', 'West'], ok: ['South'], worst: ['North-East', 'South-East'],
    noRemedy: ['North-East'],
    says: 'Classical eight-direction Vastu puts bathrooms in the north-west, with the ' +
          'south-east as the usual second choice, and keeps them away from the north-east, ' +
          'which the tradition reserves. A north-east toilet is one of the two faults held ' +
          'to have no remedy.',
  },
];

/**
 * A single Vastu number, reported and never scored into the ranking.
 *
 * He asked for it, and it is a fair thing to want: seven separate verdicts is
 * hard to compare across houses. But it stays out of the match score, because
 * the only directional rule he is sure of is the south-facing one, and turning
 * beliefs he is unsure about into a number that moves the ranking would decide
 * them on his behalf.
 *
 * Weighted toward the entrance, which is the placement the tradition itself
 * treats as most important, and computed only over placements actually known —
 * an unreadable room should not drag the number down.
 *
 * But it must not lift the number either, and for a while it did. Sorting by
 * Vastu put 720 Yasha Ct at the top of the list on the strength of one reading:
 * an east-facing door, six placements unknown, a perfect 100. A house with all
 * seven read and two of them awkward came below it. Averaging over what you
 * happen to know is right for the individual number and wrong for any ordering
 * built on it — the same mistake the match score already carries a coverage cap
 * to avoid, made again in a different file.
 *
 * So the same remedy: a ceiling that rises with how much of the house has
 * actually been read. Only the front door known is a quarter of the weight, and
 * a quarter of the weight cannot claim a hundred out of a hundred.
 */
/**
 * The sixteen-zone school, for the one placement where the two disagree.
 *
 * His sister's material is MahaVastu — sixteen zones rather than eight — and on
 * bathrooms the two schools genuinely contradict each other. Classical Vastu
 * calls north-west the ideal spot for a toilet and west a reasonable one.
 * MahaVastu calls north-west "hinders progress" and west "unfulfilled desires,
 * fewer savings", and holds that only two of its sixteen zones need no remedy
 * at all: east-south-east and south-south-west.
 *
 * Checked before changing anything, because he asked. Neither is wrong and it
 * is not a question of country: classical eight-direction practice really does
 * name the north-west, and MahaVastu really does reject it. Nor does living in
 * Georgia change it — the solar reasoning behind the directions assumes the sun
 * tracking through the southern sky, which is as true at 34°N in Atlanta as at
 * 28°N in Delhi. It is the southern hemisphere where practitioners split, and
 * they split among themselves there too.
 *
 * So this is a choice of school, not a correction, and he makes it.
 *
 * One honest limit, and the reason `best` is empty here rather than holding the
 * two good zones: ESE and SSW are sixteen-point bearings, and a floor plan read
 * to eight points cannot resolve them — ESE straddles our East/South-East line
 * and SSW straddles South/South-West. Claiming a bathroom sits in a good zone
 * at this resolution would be inventing precision we do not have. Under this
 * school every readable position is therefore "acceptable, and wants a remedy",
 * except the north-east, which stays beyond remedy.
 */
const MAHAVASTU: Partial<Record<string, Pick<VastuRule, 'best' | 'ok' | 'worst' | 'says' | 'noRemedy'>>> = {
  masterBath: {
    best: [],
    ok: ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'],
    worst: ['North-East'],
    noRemedy: ['North-East'],
    says: 'The sixteen-zone school holds that no toilet position is simply good — each carries ' +
          'its own effect and its own remedy tape. Only east-south-east and south-south-west ' +
          'need nothing, and neither can be told apart from its neighbours on a plan read to ' +
          'eight directions, so no position here is marked favourable. The north-east remains ' +
          'the one with no remedy: the seat has to leave that zone.',
  },
};

export function rulesFor(school: VastuSchool): VastuRule[] {
  if (school !== 'mahavastu') return RULES;
  return RULES.map((r) => (MAHAVASTU[r.key] ? { ...r, ...MAHAVASTU[r.key] } : r));
}

const THEME_WEIGHT: Record<string, number> = {
  'Main entrance': 2.0,
  'Kitchen': 1.2,
  'Primary bedroom': 1.2,
  "Child's bedroom": 1.0,
  'Living room': 0.9,
  'Prayer space': 0.6,
  'Bathrooms': 0.6,
};

export function vastuScore(readings: VastuReading[]): {
  score: number; known: number; of: number; coverage: number; cappedBy?: number;
} {
  const points: Record<VastuReading['verdict'], number> = {
    favourable: 100, acceptable: 62, unfavourable: 18, unknown: 0,
  };

  let total = 0;
  let weight = 0;
  let known = 0;
  let allWeight = 0;

  for (const r of readings) {
    const w = THEME_WEIGHT[r.element] ?? 1;
    allWeight += w;
    if (r.verdict === 'unknown') continue;
    total += points[r.verdict] * w;
    weight += w;
    known += 1;
  }

  const average = weight ? Math.round(total / weight) : 0;
  const coverage = allWeight ? weight / allWeight : 0;

  /* Same shape as the match score's cap, deliberately, so the two numbers
     behave alike: a house read in full can reach 100, one where only the door
     was legible tops out around 58. */
  const cap = coverage < 0.999 ? Math.round(42 + 58 * coverage) : undefined;
  const score = cap !== undefined ? Math.min(average, cap) : average;

  return {
    score,
    known,
    of: readings.length,
    coverage,
    cappedBy: cap !== undefined && cap < average ? cap : undefined,
  };
}

export function readVastu(
  perception: Perception,
  orientation: Orientation,
  roomPositions: Record<string, string>,
  school: VastuSchool = 'classical',
): {
  readings: VastuReading[]; rotationKnown: boolean; note: string;
  score: number; known: number; of: number; school: VastuSchool;
} {
  const rules = rulesFor(school);
  const facing = orientation.entranceDirection;
  const rotationKnown =
    facing !== 'Unknown' &&
    orientation.confidence !== 'none' &&
    perception.entranceEdgeOnPlan !== 'Unknown';

  const note = rotationKnown
    ? `The plan was turned to match the measured facing: the ${perception.entranceEdgeOnPlan.toLowerCase()} ` +
      `of the drawing is ${facing}. Every position below follows from that, so it is only as ` +
      `reliable as the facing measurement (${orientation.confidence} confidence).`
    : 'Room directions need both a measured facing and a front door visible on the plan. ' +
      'One of those is missing, so only the entrance is reported.';

  /* Every bedroom that is not the primary suite, as compass directions.
     Which one the child gets is his choice, made after buying, so the best
     placed of them is the honest answer rather than whichever the model
     happened to name first. */
  const childOptions = (perception.secondaryBedrooms ?? [])
    .map((pos) => rotateToCompass(pos, perception.entranceEdgeOnPlan, facing))
    .filter(Boolean) as CardinalDirection[];

  const readings: VastuReading[] = rules.map((r) => {
    let actual: CardinalDirection | 'Unknown' = 'Unknown';

    if (r.key === 'entrance') {
      actual = facing;
    } else if (r.key === 'childBedroom' && rotationKnown && childOptions.length) {
      /* Best of the ones actually available. */
      const rank = (d: CardinalDirection) =>
        r.best.includes(d) ? 0 : r.worst.includes(d) ? 2 : 1;
      actual = [...childOptions].sort((a, b) => rank(a) - rank(b))[0]!;
    } else if (rotationKnown && roomPositions[r.key]) {
      actual = rotateToCompass(roomPositions[r.key]!, perception.entranceEdgeOnPlan, facing) ?? 'Unknown';
    }

    const verdict: VastuReading['verdict'] =
      actual === 'Unknown' ? 'unknown'
      : r.best.includes(actual) ? 'favourable'
      : r.worst.includes(actual) ? 'unfavourable'
      : 'acceptable';

    return {
      element: r.element,
      theme: r.theme,
      actual,
      ideal: r.best.join(' or '),
      verdict,
      says: r.says,
      noRemedy: actual !== 'Unknown' && (r.noRemedy ?? []).includes(actual),
    };
  });

  const { score, known, of, cappedBy } = vastuScore(readings);
  /* Say why the number is held down, in the note that is already displayed —
     otherwise a house reading 58 with every visible placement favourable looks
     like a bug rather than a house nobody has read yet. */
  const withCap = cappedBy !== undefined
    ? `${note} Held to ${cappedBy} until more of the plan is read — only ${known} of ${of} ` +
      `placements are known, and a house nobody has read should not out-rank one that has.`
    : note;
  return { readings, rotationKnown, note: withCap, score, known, of, school };
}
