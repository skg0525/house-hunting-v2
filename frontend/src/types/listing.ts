/** Mirrors backend/src/types. Kept hand-written so the shapes stay readable. */

export type CardinalDirection =
  | 'North' | 'North-East' | 'East' | 'South-East'
  | 'South' | 'South-West' | 'West' | 'North-West' | 'Unknown';

export type DimensionKey =
  | 'direction' | 'kitchen' | 'mainFloorSuite' | 'yard' | 'commute' | 'walkability'
  | 'schools' | 'diversity' | 'appreciation' | 'maintenance' | 'value';

export type Verdict = 'ideal' | 'acceptable' | 'concern' | 'dealbreaker' | 'unknown';

export interface Listing {
  id: string;
  sourceUrl: string;
  address: string;
  price: number;
  beds: number;
  baths: number;
  sqft: number;
  lotSizeAcres: number;
  yearBuilt: number;
  propertyType: string;
  hoaMonthly: number;
  coords?: { lat: number; lng: number };
  images: {
    floorPlan?: string;
    floorPlanExtra?: string[];
    kitchenPhotos?: string[];
    planSearch?: { at: string; outcome: 'none-in-listing' | 'blocked' | 'error'; note: string };
    aerial?: string;
    aerialWide?: string;
    exterior?: string;
    gallery?: string[];
  };
  isNewConstruction?: boolean;
  basement?: 'finished' | 'partly finished' | 'unfinished' | 'none' | 'unknown';
  basementEvidence?: string;
  sashes?: string[];
  hoursOnMarket?: number;
  has3dTour?: boolean;
  isHot?: boolean;
  neighborhood?: {
    walkScore?: number;
    diversityIndex?: number;
    southAsianPct?: number;
    whitePct?: number;
    blackPct?: number;
    hispanicPct?: number;
    asianPct?: number;
    otherPct?: number;
    schoolRating?: number;
    censusTract?: string;
    familiesWithKidsPct?: number;
    youngChildren?: number;
    ownerOccupiedPct?: number;
  };
  nearby?: {
    places: { name: string; category: string; type: string; metres: number; walkMinutes: number }[];
    nearestParkMetres?: number;
    note: string;
  };
  anchors?: { key: string; label: string; miles: number; note: string;
    /** Driving at 5pm on an ordinary Tuesday, and with the road clear. */
    peakMinutes?: number; freeMinutes?: number }[];

  /**
   * The facing, after he looked at the Street View shot and said otherwise.
   *
   * The bearing is measured, not guessed, but it depends on the camera being
   * on the right street and pointed at the right house — and on a cul-de-sac or
   * a corner plot it can be neither. His eyes on the photograph settle it.
   */
  observedFacing?: CardinalDirection;
  /** His own 1-5 rating of the front elevation. */
  facadeScore?: number;

  /** Who sent it — a realtor's name, or absent if he found it himself. */
  referredBy?: string;

  /** A 55+ / active adult community, read from the listing description. */
  ageRestricted?: boolean;
  ageRestrictedEvidence?: string;

  /** A drive he timed himself, which beats any model. */
  observedPeakMinutes?: number;
  commute?: {
    legs: { label: string; minutes: number; freeFlowMinutes: number; delayMinutes: number }[];
    miles: number; worstMinutes: number; trafficModelled: boolean; note: string;
    /** The same evening drive on a bad day, from Google's pessimistic model. */
    badDayMinutes?: number;
  };
  commuteMinutes?: number;
  daysOnMarket?: number;
  fencePermitted?: 'yes' | 'no' | 'unknown';
  observed?: {
    backsOntoWater?: boolean;
    fenced?: 'Yes' | 'No';
    yardSize?: 'Generous' | 'Adequate' | 'Cramped';
    usableBedrooms?: number;
    mainFloorBedroom?: boolean;
    mainFloorFullBath?: boolean;
    note?: string;
    at?: string;
  };
  openHouses?: { start: string; end: string; suspect?: boolean }[];
  openHousesCheckedAt?: string;
  originalPrice?: number;
  redfinEstimate?: number;
  /**
   * Systems the seller says are new, without giving a year.
   *
   * Sixteen of the twenty listings that mention a roof or an HVAC say "newer
   * roof" or "new water heater" and no date. That is not nothing — it is a
   * claim, made in writing, by someone with an incentive to be believed — but
   * it is not a year either, and inventing one would put a made-up number into
   * the capital estimate. So it sits between "dated recently" and "never
   * mentioned", and is charged accordingly.
   */
  systemsClaimed?: ('roof' | 'hvac' | 'waterHeater' | 'windows')[];

  systems?: { roofYear?: number; hvacYear?: number; waterHeaterYear?: number; windowsYear?: number };
  geocodeQuality?: string;
  coordsSource?: string;
  /** Nearest GA-400 interchange — how he holds the map in his head. */
  exit?: { number: number; name: string; miles: number };
  notes?: string;
  myNotes?: string;
  /**
   * When you actually stood in it.
   *
   * Deliberately NOT a verdict. Shortlisting says "this is a contender";
   * touring says "I have been inside", and the two are independent — he has
   * toured houses he then rejected, and shortlisted houses he has never seen.
   * Folding the two together would have lost that, so this is a plain tag: it
   * marks the card and filters nothing.
   */
  touredAt?: string;

  /* The public price record. Mirrors the backend shape because the comparison
     table reads cutCount directly, rather than a pre-formatted string. */
  priceHistory?: {
    events: { date: string; event: string; price?: number }[];
    firstListPrice?: number;
    soldPrice?: number;
    cutFromFirstPct?: number;
    cutCount: number;
    daysSinceFirstListed?: number;
    summary: string;
  };

  /**
   * Who is building it, and what they call the community.
   *
   * New construction is not really a house on a street — it is a product line
   * in a subdivision, and the same builder sells the same four floor plans
   * across six communities at different prices. He has been tracking this in
   * his head ("Bridlefield by Toll Brothers, Westover by Toll Brothers,
   * Cornel Ln is DR Horton") and asked for somewhere to put it.
   *
   * Free text rather than an enum: new builders appear, and a wrong enum is
   * worse than a typo.
   */
  /**
   * Who owns the houses on this street, pasted from the county tax roll.
   *
   * He found the gap himself: the census says the tract around 5280 Blue
   * Mountain Ln is 21.5% South Asian, and every owner on the street is. A tract
   * is four thousand people over a wide area; a cul-de-sac is twenty families.
   * Block groups narrowed it and still could not close it — only the parcel
   * records name who actually lives on the road.
   *
   * HE does the lookup on qPublic and pastes the table in; this stores what he
   * pasted. Automating the scrape was declined: harvesting the names of private
   * individuals at a hundred addresses and labelling each by likely ethnicity
   * is a profiling pipeline whatever the motive, and surname inference is
   * unreliable enough that it would also be wrong. A person reading one street
   * he is about to buy on is a different act from a machine doing it to
   * thousands.
   */
  streetOwners?: { address: string; owner: string }[];
  streetOwnersAt?: string;

  builder?: string;
  community?: string;
  myNotesUpdatedAt?: string;
  status?: 'for sale' | 'pending' | 'sold' | 'off market' | 'unknown';
  addedAt: string;
}

export interface Perception {
  entranceEdgeOnPlan: 'Bottom' | 'Top' | 'Left' | 'Right' | 'Unknown';
  entranceEvidence: string;
  mainFloorBedroom: boolean;
  mainFloorFullBath: boolean;
  mainFloorFlexRoom: boolean;
  mainFloorSuiteEvidence: string;
  kitchenLengthFt: number;
  kitchenWidthFt: number;
  kitchenOpenToLiving: boolean;
  mainLivingLengthFt: number;
  mainLivingWidthFt: number;
  layoutStyle: 'Open concept' | 'Partly open' | 'Compartmentalized' | 'Unknown';
  kitchenEvidence: string;
  /** False when the satellite tile predates the house — bare ground. */
  houseVisibleInAerial?: boolean;
  yardFenced: 'Yes' | 'No' | 'Unclear';
  neighboursHaveFences: 'Most do' | 'Some do' | 'None do' | 'Unclear';
  yardGrade: 'Flat' | 'Gentle Slope' | 'Steep Slope' | 'Unknown';
  yardUsableSize: 'Generous' | 'Adequate' | 'Cramped' | 'Unknown';
  yardPrivacy: 'High' | 'Medium' | 'Low' | 'Unknown';
  yardEvidence: string;
  backsOntoMajorRoad: boolean;
  siteEvidence: string;
}

/** Which images the reading was actually based on. */
export interface EvidenceBase {
  planRead: boolean;
  aerialRead: boolean;
}

export interface Orientation {
  entranceDirection: CardinalDirection;
  bearingDeg: number | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  method: string;
  streetViewUrl?: string;
}

export interface DimensionScore {
  key: DimensionKey;
  label: string;
  score: number;
  weight: number;
  verdict: Verdict;
  reason: string;
  available: boolean;
}

export interface TraceStep {
  step: string;
  detail: string;
  ms: number;
  status: 'ok' | 'cached' | 'degraded' | 'error';
}

export interface Assessment {
  listingId: string;
  matchScore: number;
  /** The score before rule-outs and your own verdict pinned it. */
  baseScore: number;
  math?: {
    weightedTotal: number; knownWeight: number; allWeight: number; average: number;
    coverageCap?: number; cappedBy?: { limit: number; reason: string };
  };
  ruledOut: string | null;
  dimensions: DimensionScore[];
  perception: Perception;
  evidence: EvidenceBase;
  orientation: Orientation;
  pros: string[];
  cons: string[];
  summary: string;
  verdict?: 'rejected' | 'tooFar' | 'maybe' | 'shortlisted' | 'selfTour' | 'agentTour' | 'toured';
  /* Reported next to the score, never folded into it. Typed loosely on purpose:
     these are display-only payloads and the backend owns their shape. */
  vastu?: unknown;
  highlights?: unknown;
  market?: unknown;
  health?: unknown;
  systems?: unknown;
  negotiation?: unknown;
  trace: TraceStep[];
  cached: boolean;
  totalMs: number;
}

export interface PreferenceProfile {
  userId: string;
  weights: Record<DimensionKey, number>;
  nonNegotiables: {
    noSouthernEntrance: boolean;
    fencedYardRequired: boolean;
  };
  preferences: {
    mainFloorBedroomRequired: boolean;
    mainFloorFullBathRequired: boolean;
    maxPrice: number;
    negotiationRoomPct: number;
    minYearBuilt: number;
    minLotAcres: number;
    maxCommuteMinutes: number;
    vastuSchool?: 'classical' | 'mahavastu';
    workAddress: string;
    gasCooktopWanted: boolean;
    maxParkWalkMetres: number;
  };
  propertyFeedback: Record<string, 'rejected' | 'tooFar' | 'maybe' | 'shortlisted' | 'selfTour' | 'agentTour' | 'toured'>;
  learnedNotes: string[];
  updatedAt: string;
  version: number;
}

export interface HealthPayload {
  ok: boolean;
  listingRequests?: {
    hour: number; day: number; usedThisHour: number; usedToday: number;
    limits: { perHour: number; perDay: number };
  };
  model: string;
  sources: { census: boolean; walkScore: boolean; maps: boolean; gemini: boolean };
  cachedReadings: number;
  listings: number;
}

/** One link you pasted, plus whatever the URL alone gave up. */
export interface PastedResult {
  url: string;
  site: 'redfin' | 'zillow' | 'other';
  status: 'new' | 'duplicate';
  addressGuess?: string;
  address?: string;
  coords?: { lat: number; lng: number };
  geocodeQuality?: string;
  coordsSource?: string;
  /** Nearest GA-400 interchange — how he holds the map in his head. */
  exit?: { number: number; name: string; miles: number };
}
