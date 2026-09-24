/**
 * What you are looking for.
 *
 * This file is the only thing that turns "what the floor plan shows" into
 * "how much do I want this house". Gemini never sees it. Change a number here
 * and every house you have already scanned re-ranks instantly, with no model
 * call and no new cost — which is the point of keeping perception and
 * judgement apart.
 */

export type DimensionKey =
  | 'direction'
  | 'kitchen'
  | 'mainFloorSuite'
  | 'yard'
  | 'commute'
  | 'walkability'
  | 'schools'
  | 'diversity'
  | 'appreciation'
  | 'maintenance'
  | 'value';

export interface PreferenceProfile {
  userId: string;
  weights: Record<DimensionKey, number>;   // 0-1, relative importance

  /**
   * The two things you will not trade away.
   *
   * These do not shade a score down. They rule the house out, and the UI says
   * so in plain words. Everything else is a matter of degree.
   */
  nonNegotiables: {
    /** No south-facing front door. The one Vastu rule you are sure of. */
    /* South, South-East and South-West. Named for the half of the compass it
       bars rather than the single direction it started as. */
    noSouthernEntrance: boolean;
    /** A fenced backyard, so your son can be outside without you watching. */
    fencedYardRequired: boolean;
  };

  /** Strong wants. Missing one costs the house a lot, but not everything. */
  preferences: {
    /**
     * A bedroom on the main floor is wanted, not required.
     *
     * He walked a house with no main-floor bedroom and said he could live with
     * it, because a main-floor office becomes a guest room when family visits.
     * Treating it as a hard requirement would have discarded that house on his
     * behalf, which is not the tool's decision to make.
     *
     * Weighted higher than that first read suggested, though. Family come every
     * two years and stay one to two months. An office with a sofa bed is fine
     * for a weekend and grim for eight weeks — and the room doubles as
     * somewhere for a small child to play the rest of the time. A finished basement
     * with a bedroom and bath answers it just as well, which is why the
     * basement is reported next to it.
     */
    mainFloorBedroomRequired: boolean;
    mainFloorFullBathRequired: boolean;
    /**
     * The most he would actually pay, after negotiating. Not the most he would
     * pay as a list price.
     */
    maxPrice: number;
    /**
     * How far below ask he expects to land, as a fraction.
     *
     * Ask price is an opening position, not a price. Filtering on it throws
     * away houses he would win at his own number — which is exactly the mistake
     * he made buying his condo, and the one he has said he will not repeat.
     */
    negotiationRoomPct: number;
    minYearBuilt: number;
    /** Below this, the yard reads as cramped no matter how walkable the street. */
    minLotAcres: number;
    /**
     * The ceiling, measured against the EVENING peak rather than a free-flow
     * average. A 35-minute drive that becomes 75 between four and six is a
     * 75-minute commute; quoting the 35 is how people buy the wrong house.
     */
    maxCommuteMinutes: number;
    /**
     * Which school of Vastu the reading follows.
     *
     * 'classical' is eight-direction practice — north-west is the good place
     * for a bathroom. 'mahavastu' is the sixteen-zone school his sister
     * follows, which rejects the north-west and holds that only ESE and SSW
     * need no remedy. The two genuinely contradict each other, neither is
     * wrong, and it is not a question of geography — so it is his to pick.
     *
     * Affects the Vastu reading only. The match score has never contained a
     * Vastu number and still does not.
     */
    vastuSchool: 'classical' | 'mahavastu';
    /** Where the drive actually goes. Without this the ceiling means nothing. */
    workAddress: string;
    /**
     * A gas range.
     *
     * Not a rule-out: an electric range on an otherwise right house is an
     * appliance and a gas line, not a reason to walk. But it is a real want,
     * and the difference between "gas already" and "gas would need running" is
     * a few hundred dollars against a few thousand.
     */
    gasCooktopWanted: boolean;
    /** How far anyone would walk to a park with a stroller, in metres. */
    maxParkWalkMetres: number;
  };

  /**
   * What you said about individual houses.
   *
   * Weights say what you like in general. They cannot say "not this one" — a
   * weighted average over eight dimensions barely moves, and if the house
   * scores well on the dimension you raised, it moves UP. Rejecting a specific
   * house has to be recorded against that house.
   */
  propertyFeedback: Record<string, 'rejected' | 'tooFar' | 'maybe' | 'shortlisted' | 'selfTour' | 'agentTour' | 'toured'>;
  learnedNotes: string[];
  updatedAt: string;
  version: number;
}

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  value: 'Price for What You Get',
  direction: 'Facing Direction',
  kitchen: 'Kitchen & Living Space',
  mainFloorSuite: 'Main-Floor Bedroom + Bath',
  yard: 'Backyard Size & Usability',
  commute: 'Commute & Distance',
  walkability: 'Walkability',
  schools: 'Schools',
  diversity: 'Neighborhood Mix',
  appreciation: 'Likely to Hold Value',
  maintenance: 'Age & Upkeep',
};

/**
 * Yard size and walkability are scored apart on purpose.
 *
 * They pull in opposite directions — the walkable street has the small lot, the
 * big lot is a drive from everything. Rolling them into one "lifestyle" number
 * would hide that, and you would end up looking at a list of averages instead of
 * a list of trade-offs. Kept separate, the tension is visible on every card and
 * you get to decide which way you lean, house by house.
 */
export function defaultProfile(userId: string): PreferenceProfile {
  return {
    userId,
    /* His numbers, given directly on 2026-09-20 after reading the formula.
       He is a software engineer, he asked to see the weights, and he set them.
       Anything here that looks surprising is his judgement, not a derivation:
       maintenance at 0.7 because he would rather buy an older house well kept
       than a new one badly placed, and mainFloorSuite down to 0.8 because a
       finished basement answers the same need. */
    weights: {
      direction: 1.0,
      yard: 1.2,          // the backyard is the Midtown replacement
      value: 1.0,
      commute: 0.75,      // still matters, no longer a near-veto
      walkability: 0.95,
      diversity: 1.0,
      kitchen: 1.0,
      schools: 1.0,
      mainFloorSuite: 0.8,
      appreciation: 1.0,
      maintenance: 0.7,
    },
    nonNegotiables: {
      noSouthernEntrance: true,
      fencedYardRequired: true,
    },
    preferences: {
      mainFloorBedroomRequired: false,
      mainFloorFullBathRequired: false,
      maxPrice: 950000,
      negotiationRoomPct: 0.12,
      minYearBuilt: 1985,
      /* 0.22 acres, about 9,600 sq ft. Chosen from his own list: price per
         square foot is flat from 0.2 to 0.6 acres, so a bigger lot in that band
         costs nothing extra per square foot of house — but above 0.6 the price
         jumps and the house sits three to four miles further out, which is
         buying distance rather than land. */
      minLotAcres: 0.22,
      /* Forty, not thirty.
       *
       * Thirty was chosen because everything on the list came in between eleven
       * and fifty-six minutes on a bad evening, so a thirty-minute line
       * actually divided the houses where forty-five sat above nearly all of
       * them and divided nothing. That reasoning was sound and the number was
       * still wrong, because dividing the list is not the same as dividing it
       * where he would. Thirty became a near-veto: it shelved the whole
       * northern half, including houses he liked enough to drive to.
       *
       * Forty is the number he gave when asked what he would actually accept.
       * The curve now reads 20 → 100, 30 → 85, 40 → 70, 50 → 54, 60 → 38.
       * Sixty is his status quo and it scores badly, which is the point. */
      maxCommuteMinutes: 40,
      vastuSchool: 'classical',
      workAddress: process.env.WORK_ADDRESS ?? 'Alpharetta, GA',
      gasCooktopWanted: true,
      maxParkWalkMetres: 1200,
    },
    propertyFeedback: {},
    learnedNotes: [],
    updatedAt: new Date().toISOString(),
    version: 2,
  };
}
