import { z } from 'zod';

/**
 * A house you are considering.
 *
 * You paste a listing URL and, where the fetch cannot get them, fill in the few
 * facts by hand. Nothing here describes the *spatial* qualities of the house —
 * entrance direction, whether the downstairs bath has a tub, the state of the
 * yard. Those come from reading the floor plan and the aerial, because that is
 * the whole point.
 */

export type CardinalDirection =
  | 'North' | 'North-East' | 'East' | 'South-East'
  | 'South' | 'South-West' | 'West' | 'North-West' | 'Unknown';

export interface Listing {
  id: string;
  /** The page you pasted, whichever site it came from. */
  sourceUrl: string;
  /**
   * The Redfin equivalent, when you pasted something else.
   *
   * Zillow is easier to search by hand and returns 403 to everything
   * automated. Redfin is the reverse. So the link you keep is yours, and the
   * link the tool reads is this one.
   */
  readableUrl?: string;
  address: string;
  price: number;
  beds: number;
  baths: number;
  sqft: number;
  lotSizeAcres: number;
  yearBuilt: number;
  propertyType: string;
  hoaMonthly: number;

  /** Position, used for Street View orientation and the commute estimate. */
  coords?: { lat: number; lng: number };
  /**
   * How the coordinates were obtained. This is not bookkeeping — it decides
   * whether a house can be ruled out.
   *
   * Google ROOFTOP puts the point on the building. The free Census geocoder
   * interpolates along the street, so its point sits near the centreline —
   * which is where the Street View car is. Measuring a bearing from a point on
   * the road to a camera on the road is measuring noise, and calling that
   * high confidence would rule out houses on a coin flip.
   */
  geocodeQuality?: string;
  /** Where the coordinates came from, so a bad one can be spotted. */
  coordsSource?: string;
  /** Nearest GA-400 interchange, which is how he holds the map in his head. */
  exit?: { number: number; name: string; miles: number };

  images: {
    /** Required. Everything spatial is read from this. */
    floorPlan?: string;
    /** Upper storeys, when a listing has more than one plan. Kept to look at, not read. */
    floorPlanExtra?: string[];
    /**
     * Kept only so a saved listing does not lose data on read.
     *
     * These were fed to the model and produced nothing: every kitchen came back
     * generous, including one rejected in person. Estate agent photographs
     * exist to make rooms look larger and they succeed. No longer sent.
     */
    kitchenPhotos?: string[];
    /**
     * Why there is no floor plan, when there isn't one.
     *
     * "This listing has no plan" and "we were blocked before we could look" are
     * different facts and must not share a message — one means give up and drag
     * an image in, the other means try again in an hour.
     */
    planSearch?: { at: string; outcome: 'none-in-listing' | 'blocked' | 'error'; note: string };
    /** Close satellite view of the lot — detail enough to look for a fence line. */
    aerial?: string;
    /**
     * The same lot, zoomed out.
     *
     * One framing cannot answer both questions. Close enough to trace a fence
     * is too close to see the four-lane road the lot backs onto — which is how
     * a road warning appeared on one scan and vanished on the next after the
     * zoom was raised. Send both.
     */
    aerialWide?: string;
    /**
     * The listing's own front photo.
     *
     * The list used to show satellite tiles, which all look the same and
     * connect to nothing — after forty tours you remember the brick and the
     * porch, not the roof from above. The aerial stays on the detail page where
     * it is doing actual work.
     */
    exterior?: string;
    /** A couple more from the gallery, for the detail page. */
    gallery?: string[];
  };

  /** Filled in from the Census and school data once coords are known. */
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

  commuteMinutes?: number;
  /** Straight-line miles to a few fixed places, for a sense of how far out this is. */
  anchors?: { key: string; label: string; miles: number; note: string;
    /** Driving at 5pm on an ordinary Tuesday, and with the road clear. */
    peakMinutes?: number; freeMinutes?: number }[];

  /** Measured at three times of day, because one number hides the problem. */
  commute?: {
    legs: { label: string; minutes: number; freeFlowMinutes: number; delayMinutes: number }[];
    miles: number;
    worstMinutes: number;
    trafficModelled: boolean;
    /** The same evening drive on a bad day, from Google's pessimistic model. */
    badDayMinutes?: number;
    note: string;
  };
  /**
   * What the drive home actually took, by his own clock.
   *
   * Outranks anything Google returns. He has driven the road at five o'clock
   * and the traffic model demonstrably has not.
   */
  /** The facing, after he looked at the Street View shot and said otherwise. */
  observedFacing?: CardinalDirection;

  /**
   * Who put this house in front of him.
   *
   * A realtor's list and a list he built himself are different things and get
   * read differently: hers are houses someone else thinks he should see, and
   * the buyer wants to look at exactly those, and to answer the agent about
   * exactly those. Free text rather than an enum — the next name is not known
   * yet, and a schema change should not be the cost of a second realtor.
   */
  referredBy?: string;

  /**
   * How the front of the house looks to him, 1-5, scored by eye.
   *
   * Not a model's opinion. He rated eighteen front elevations in one sitting
   * and the result separates cleanly on whether you see the front door or the
   * garage doors — and NOT on colour, which is what he thought he cared about.
   *
   * Reported, not scored into the ranking. It predicts whether he gets out of
   * the car, not what he buys: their joint favourite rates 3.
   */
  facadeScore?: number;

  /** Secondary bedroom sizes read off the plan — see services/bedrooms.ts. */
  bedroomSizes?: {
    rooms: { label: string; lengthFt: number; widthFt: number; isPrimary: boolean; onMainFloor: boolean }[];
    realCount: number;
    smallestWallFt: number | null;
    note: string;
  };

  /**
   * A 55+ / active adult community. Stated only in the description — Redfin
   * has no field for it. A hard pass when the buyers are not 55+ with a child.
   */
  ageRestricted?: boolean;
  ageRestrictedEvidence?: string;
  observedPeakMinutes?: number;
  /**
   * Days on Redfin. This is negotiating information, not trivia: a house that
   * has sat is a house whose seller has started doing arithmetic.
   */
  daysOnMarket?: number;

  /**
   * Can a fence be built here, if there isn't one?
   *
   * "No fence" and "no fence allowed" are completely different answers. Plenty
   * of houses have an open yard and an HOA that permits fencing — that is a
   * weekend and a few thousand dollars, not a dealbreaker. An HOA that forbids
   * it is permanent. Ruling both out identically threw away good houses.
   *
   * Not readable from any image; it lives in the HOA covenants. Set it by hand
   * once you have checked.
   */
  fencePermitted?: 'yes' | 'no' | 'unknown';

  /**
   * What you saw with your own eyes, overriding what the aerial concluded.
   *
   * Georgia canopy hides fence lines, so roughly fifty of sixty-one read
   * "cannot tell" — and on a house he had actually walked, the fence was
   * obvious from the listing photos. A satellite guess must not outrank
   * someone who stood in the garden.
   *
   * Kept separate from `perception` so a re-read never overwrites it, and so
   * the two can be shown side by side: what the tool thought, and what you
   * found. Where they disagree, you win.
   */
  observed?: {
    /** Whether open water actually touches this lot, once you have looked. */
    backsOntoWater?: boolean;
    fenced?: 'Yes' | 'No';
    yardSize?: 'Generous' | 'Adequate' | 'Cramped';
    /** Real bedrooms, when the listing's count is generous with the truth. */
    usableBedrooms?: number;
    /**
     * What the main floor actually has, once you have read the plan yourself.
     *
     * The plan read is the least reliable thing this app does — the answer
     * moves between runs on the same image, and on 1523 Westend Way it reads a
     * clearly labelled "Bedroom 12'11\" x 10'7\"" as absent because the plan is
     * drawn over a photograph with hotspot dots, one of which sits on the word.
     * No prompt fixes that. One look does, and it should be the last word.
     */
    mainFloorBedroom?: boolean;
    mainFloorFullBath?: boolean;
    /** Whether the one downstairs is the PRIMARY, which the household ruled out. */
    primaryOnMain?: boolean;
    note?: string;
    at?: string;
  };

  /**
   * Ages of the things that cost five figures to replace.
   *
   * A 1998 house with a 2021 roof and a 2020 HVAC is a much better buy than a
   * 2005 house with all its original systems, and the year built alone cannot
   * tell those apart. Listing remarks usually mention these when they are new,
   * because it is a selling point.
   */
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

  systems?: {
    roofYear?: number;
    hvacYear?: number;
    waterHeaterYear?: number;
    windowsYear?: number;
  };

  /**
   * Upcoming open houses, as ISO datetimes.
   *
   * Refreshed on demand rather than stored forever — an open house is a date
   * that goes stale, and a stale one is worse than none because you plan around
   * it. Anything in the past is dropped on read.
   */
  openHouses?: { start: string; end: string }[];
  openHousesCheckedAt?: string;

  /** What Redfin thinks it is worth, if shown. Used only as a negotiating anchor. */
  redfinEstimate?: number;
  /**
   * Zillow's Zestimate, typed in by hand.
   *
   * The one thing Zillow offers that Redfin does not: a genuinely independent
   * second valuation. Two estimates that agree is a much stronger thing to say
   * in an offer than one, and where they disagree by a lot, that gap is itself
   * worth knowing before bidding.
   */
  zestimate?: number;
  /** The first asking price, when it has been cut since. */
  originalPrice?: number;
  /**
   * The whole published price story, not just the current number.
   *
   * A house first listed at $1.3M and sold at $965k was never a $1.3M house.
   * That record is public on every listing and is the strongest thing you can
   * put in front of a seller.
   */
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
   * Whether it is still buyable.
   *
   * Sold and off-market houses are archived rather than deleted — the price
   * they actually sold for is a comparable, and knowing a favourite is gone is
   * itself worth knowing.
   */
  status?: 'for sale' | 'pending' | 'sold' | 'off market' | 'unknown';
  archivedAt?: string;

  /** Flagged by the listing site. It changes how you negotiate, so it belongs on the card. */
  isNewConstruction?: boolean;
  /** Badges from the listing photo: new construction, price drop, hot home, 3D tour. */
  sashes?: string[];
  /**
   * Hours since listing, when the badge gives it.
   *
   * More precise than days-on-market where it matters most: a house listed 26
   * hours ago and one listed this morning both read 0 days, and neither will
   * entertain an offer the way a house at 80 days will.
   */
  hoursOnMarket?: number;
  has3dTour?: boolean;
  isHot?: boolean;

  /**
   * What the range burns.
   *
   * The cook in this household is on gas and will not go back. Almost never a
   * filter on a listing site, usually in the prose.
   */
  cooktopFuel?: 'gas' | 'electric' | 'induction' | 'unknown';
  cooktopEvidence?: string;
  basement?: 'finished' | 'partly finished' | 'unfinished' | 'none' | 'unknown';
  basementEvidence?: string;
  sewer?: 'public' | 'septic' | 'unknown';
  sewerEvidence?: string;

  /** What is within a stroller walk. Populated by the Places lookup. */
  nearby?: {
    places: { name: string; category: string; type: string; metres: number; walkMinutes: number }[];
    nearestParkMetres?: number;
    note: string;
  };

  /**
   * When could we actually move in?
   *
   * This became a hard constraint the moment the condo's rental window
   * appeared: notice could come any time in the next one to three months, and
   * from that day there are 90 days to be out. Miss it and the choice is sell
   * the condo or wait three more years. So a house that completes next autumn
   * is not a house, it is a rental in between — worth it only if the house is
   * exceptional and the area is visibly appreciating.
   */
  readiness?: 'move-in ready' | 'weeks' | 'months' | 'to be built' | 'unknown';
  /** Estimated completion, when the listing gives one. */
  completionEstimate?: string;

  /** Anything you noticed on the listing that the images will not show. */
  notes?: string;

  /**
   * Your own notes. Never written by anything but you.
   *
   * Deliberately separate from every scraped field and from `notes`, which the
   * importer populates. Nothing in the enrichment path may touch this: not a
   * re-scrape, not a cache clear, not a re-scan. What you wrote after standing
   * in a kitchen is the most valuable text in the file and the only part that
   * cannot be fetched again.
   */
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
  addedAt: string;
}

/* ------------------------------------------------------------------ *
 * What Gemini reports after looking at the drawings.
 *
 * Note what is NOT in here: the compass direction the house faces.
 *
 * Real listing floor plans have no north arrow. The tidy plans in architecture
 * portfolios do; the ones on Redfin and Zillow are marketing renders, and they
 * are drawn whichever way fits the page. Asking a model which way the front
 * door faces from a drawing with no north on it is asking it to guess, and it
 * will, confidently. Since "not south-facing" is the one rule you are certain
 * of, a confident guess is the worst thing this tool could produce.
 *
 * So the compass comes from geometry instead (see orientation.ts), and Gemini
 * is only asked about things a drawing can actually settle: which edge of the
 * page the door is on, what is on the main floor, what the yard looks like.
 * ------------------------------------------------------------------ */

export const PerceptionSchema = z.object({
  /**
   * Which edge of the drawing the front door sits on — a page position, not a
   * compass reading. Combined with the real street bearing, this is what lets
   * the rest of the plan be rotated into true directions.
   */
  entranceEdgeOnPlan: z.enum(['Bottom', 'Top', 'Left', 'Right', 'Unknown']),
  entranceEvidence: z.string(),

  /* Whether the storey with the front door was among the images at all.
     Optional so that a reading stored before this field existed still parses. */
  mainFloorPlanSeen: z.boolean().optional(),
  mainFloorBedroom: z.boolean(),
  /* Whether the PRIMARY suite is the one on the main floor, which is the
     opposite of what the field above is asking. Optional so that every reading
     cached before this existed still parses — and absent reads as unknown,
     not as false, which is the honest answer for a plan nobody re-read. */
  primaryBedroomOnMain: z.boolean().optional(),
  mainFloorFullBath: z.boolean(),
  /** An office, study, den or flex room on the main floor that a guest could sleep in. */
  mainFloorFlexRoom: z.boolean(),
  mainFloorSuiteEvidence: z.string(),

  /* Kitchen and gathering space.
     Dimensions in feet, 0 when the plan does not print them. Area alone turned
     out to be the wrong measure — a 368 sq ft kitchen was rejected in person as
     cramped because it is a long narrow strip walled off from everything else.
     So the layout question is asked separately from the size question. */
  kitchenLengthFt: z.number(),
  kitchenWidthFt: z.number(),
  kitchenOpenToLiving: z.boolean(),
  mainLivingLengthFt: z.number(),
  mainLivingWidthFt: z.number(),
  layoutStyle: z.enum(['Open concept', 'Partly open', 'Compartmentalized', 'Unknown']),

  /* Storage and traffic, both read off the plan.
     These replaced a photograph-based judgement that turned out to carry no
     information — every listing kitchen photographs as generous. These do not:
     a pantry is either drawn or it is not, and a kitchen you walk through to
     reach the garage is visibly a corridor on the page. */
  hasPantry: z.boolean(),
  pantryIsLaundry: z.boolean(),
  kitchenIsThoroughfare: z.boolean(),
  kitchenHasIsland: z.boolean(),
  kitchenEvidence: z.string(),

  /* The backyard questions, in the order they matter to you.
     `yardFenced` is three-state on purpose. An aerial photo taken in leaf-on
     season often cannot show a fence line, and ruling out a house because the
     satellite pass was cloudy would be the worst possible failure. 'Unclear'
     means go look, not no. */
  /**
   * Is there a house in the aerial at all?
   *
   * Satellite imagery lags construction by a year or more. One listing's aerial
   * was bare red dirt — the plot before anything was built on it — and the
   * model dutifully reported "no visible fencing", which capped a house
   * scoring 72 down to 45. There is no fence because there is no house.
   *
   * When this is false, every yard finding below is void rather than negative.
   */
  houseVisibleInAerial: z.boolean(),
  yardFenced: z.enum(['Yes', 'No', 'Unclear']),
  /**
   * Do the houses around it have fences?
   *
   * You cannot read an HOA covenant from a satellite photo. But if six
   * neighbours have fenced yards, that HOA plainly permits fencing, and an
   * unfenced lot in that street is a weekend of work rather than a permanent
   * no. If nobody on the street has one, that is a real signal too.
   */
  neighboursHaveFences: z.enum(['Most do', 'Some do', 'None do', 'Unclear']),
  yardGrade: z.enum(['Flat', 'Gentle Slope', 'Steep Slope', 'Unknown']),
  yardUsableSize: z.enum(['Generous', 'Adequate', 'Cramped', 'Unknown']),
  yardPrivacy: z.enum(['High', 'Medium', 'Low', 'Unknown']),
  yardEvidence: z.string(),

  backsOntoMajorRoad: z.boolean(),

  /**
   * Standing water against the lot.
   *
   * A retention pond behind the garden is two problems at once: a drowning
   * hazard for a small child, and stagnant water that breeds mosquitoes all
   * summer. Builders put them at the low corner of a subdivision and the houses
   * around them are cheaper for a reason.
   *
   * It is plainly visible from above, which is the point — this is the one
   * thing on the whole list that a satellite photo answers better than a
   * viewing, because from the ground you often cannot see over the fence.
   */
  backsOntoWater: z.boolean(),
  waterEvidence: z.string(),

  siteEvidence: z.string(),

  /* Where rooms sit ON THE PAGE, as compass words applied to the drawing with
     its top treated as north. These are NOT real compass directions — the page
     is rotated by an unknown amount. vastu.ts turns them into true directions
     using the measured facing. Reporting them as page positions keeps the model
     out of the guessing business. */
  /**
   * Where every bedroom that is not the primary suite sits on the page.
   *
   * Which room the child gets is chosen after buying, not by the builder, so a
   * single "childBedroom" was an arbitrary pick dressed up as a finding — the
   * model had no rule for choosing and the prompt gave it none. All of them are
   * listed and the best-placed one counts, the same way the builder plan book
   * already worked.
   */
  secondaryBedrooms: z.array(z.string()).optional(),
  planPositions: z.object({
    kitchen: z.string(),
    primaryBedroom: z.string(),
    childBedroom: z.string(),
    livingRoom: z.string(),
    masterBath: z.string(),
    poojaSpace: z.string(),
  }),
});
export type Perception = z.infer<typeof PerceptionSchema>;

/**
 * Which images the reading was actually based on.
 *
 * Without this, an unread house is indistinguishable from a house that was read
 * and found wanting: the default perception says `mainFloorBedroom: false`, and
 * "false" and "never looked" are the same value. That is how this tool told me
 * a house with a guest suite on the main floor had no main-floor bedroom. A
 * confident wrong answer is worse than a blank.
 */
export interface EvidenceBase {
  planRead: boolean;
  aerialRead: boolean;
}

/**
 * Where the house actually points, worked out from maps rather than read off a
 * drawing. `confidence` is load-bearing: a low-confidence bearing must never
 * rule a house out, only send you to look at Street View yourself.
 */
export interface Orientation {
  entranceDirection: CardinalDirection;
  bearingDeg: number | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  method: string;
  streetViewUrl?: string;

  /**
   * Which of the three readings produced this, and how far away the thing it
   * was measured from is.
   *
   * These used to be recoverable only by matching words in `method`, and the
   * scoring engine did exactly that — it looked for 'road map' to decide
   * whether a reading was too weak to delete a house. The road-network reader
   * writes 'road network'. The guard never once fired, and every house it was
   * written to protect was ruled out anyway, including 7395 Winderlea Ln, which
   * he went and checked in person.
   *
   * A decision that matters this much does not get made by substring search.
   */
  source?: 'streetview' | 'roadNetwork' | 'roadMapModel' | 'none';
  /** Metres to the camera or the road the bearing was taken from. */
  sourceMetres?: number;
}

/* ------------------------------------------------------------------ */

export interface DimensionScore {
  key: string;
  label: string;
  score: number;
  weight: number;
  verdict: 'ideal' | 'acceptable' | 'concern' | 'dealbreaker' | 'unknown';
  reason: string;
  /**
   * False when the underlying data has not been looked up yet.
   *
   * An unavailable dimension is left OUT of the weighted average rather than
   * scored as a neutral 50. Pulling every un-looked-up house toward the middle
   * makes good houses look average and bad houses look fine, which is exactly
   * the kind of quiet dishonesty that makes a ranking useless.
   */
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
  /** How the number was arrived at, so it can be argued with. */
  math?: {
    weightedTotal: number; knownWeight: number; allWeight: number; average: number;
    coverageCap?: number; cappedBy?: { limit: number; reason: string };
  };
  /** Set when a hard rule is broken. The house is out, whatever it scores. */
  ruledOut: string | null;
  dimensions: DimensionScore[];
  perception: Perception;
  evidence: EvidenceBase;
  orientation: Orientation;
  pros: string[];
  cons: string[];
  summary: string;
  verdict?: 'rejected' | 'tooFar' | 'maybe' | 'shortlisted' | 'selfTour' | 'agentTour' | 'toured';
  /* Reported alongside the score, never folded into it. */
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
