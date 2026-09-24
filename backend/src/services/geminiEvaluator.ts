/**
 * The perception layer.
 *
 * Gemini 3.5 Flash is asked exactly one thing: read the floor plan and the
 * aerial photo and report what is physically there. It never sees the buyer's
 * weights and it never produces a score — that keeps it from rationalising a
 * number, and it means the same house yields the same perception no matter
 * whose profile is loaded (which is what makes the cache safe to share).
 */
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { UPLOADS_DIR } from '../paths.js';
import { Listing, Perception, PerceptionSchema, EvidenceBase, TraceStep } from '../types/listing.js';
import { record } from './usage.js';

/**
 * Primary vision model.
 *
 * gemini-3.5-flash-lite, not gemini-3.5-flash. Measured on this repo's own
 * verification set, two images per request:
 *
 *   gemini-3.5-flash-lite   p50  3.0s   88% exact, 0% wrong
 *   gemini-3.5-flash        p50 59.5s   — and that 59s was a 503, not an answer
 *
 * Under load the full flash model spends a minute failing. Lite answers in
 * three seconds and gets the same things right, including the half-bath trap
 * that the whole demo hinges on. Both are Gemini 3.5, so both satisfy the
 * "3.5 or newer" requirement.
 */
export const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite';

/**
 * Availability fallback, tried in order.
 *
 * gemini-3.5-flash is the primary and the one the results are cached against.
 * It does however return 503 "high demand" under load, and measured p50 on a
 * two-image request is ~17s. Rather than fail the scan, drop to the next model
 * in the chain — every entry is a Gemini 3 family model, and the trace records
 * which one actually answered so a degraded result is never silently passed off
 * as a primary one.
 */
export const MODEL_CHAIN = [
  MODEL,
  process.env.GEMINI_FALLBACK_MODEL ?? 'gemini-3.5-flash',
  'gemini-3-flash-preview',
];

/* Successful calls land in 1.5-11s. A 45s ceiling meant a hung model burned
   three quarters of a minute before the chain even tried the next one, which is
   how a single property reached two minutes. Fail fast, fall through sooner. */
const REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS ?? 25_000);
const MAX_ROUNDS = 2;

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) console.warn('[evaluator] GEMINI_API_KEY not set — perception will run degraded.');
const ai = new GoogleGenAI({ apiKey: apiKey ?? '' });

const SYSTEM_PROMPT = `
You are reading a real estate listing for a buyer. You will be shown a 2D floor
plan and, usually, a top-down aerial photo of the same property. Report only what
you can actually see in the images.

You are NOT being asked which way the house faces. That is measured separately
from mapping data. Do not infer compass directions, and do not use the street
address to reason about anything — an address tells you nothing about a room.

WHAT TO REPORT

1. entranceEdgeOnPlan — which edge of the DRAWING the main front door sits on:
   Bottom, Top, Left or Right. This is a position on the page, not a compass
   direction. Look for a labelled FOYER, ENTRY or PORCH and the door symbol on
   an exterior wall. Answer "Unknown" if no front door is drawn.

FIRST, FIND THE MAIN FLOOR.

A single image often contains SEVERAL storeys drawn side by side, each with its
own small caption — "1st floor", "2nd floor", "3rd floor", "Main Level",
"Basement". Questions 2, 3 and 3b are about the MAIN floor only, and getting the
wrong panel is the most damaging mistake you can make here.

Identify it before answering anything:
  - Prefer the panel captioned 1st floor, Main, Main Level or First Floor.
  - If nothing is captioned, the main floor is the panel containing the FOYER or
    ENTRY and the GARAGE. Kitchen and dining are on it too.
  - A panel whose rooms are mostly bedrooms and baths off a central hall, with
    no kitchen and no garage, is an UPPER floor. Never answer from it.

Then answer 2, 3 and 3b from THAT PANEL ALONE. A bedroom drawn on the second
floor is not a main-floor bedroom, and neither is one on a basement plan.

Sometimes NONE of the images is the main floor. 5050 Savannah Run publishes its
2nd and 3rd floor plans and not its 1st — so there is nothing to answer from.
Set mainFloorPlanSeen false when that happens and leave 2, 3 and 3b false; do
NOT fall back to the lowest floor you were given and describe it as the main
one. Set mainFloorPlanSeen true only when you are actually looking at the
storey with the front door.

A MAIN-FLOOR BEDROOM AND THE PRIMARY BEING ON THE MAIN FLOOR ARE DIFFERENT
FACTS AND HE WANTS OPPOSITE THINGS FROM THEM. A spare bedroom with a full bath
downstairs is wanted: visiting family stay for one to two months, and that gives
them their own space. The PRIMARY suite on the main floor is not wanted — his
household has ruled it out. One house does both right: Bedroom 5 at 14x14 with
its own bath on the main floor, owner's suite upstairs.

Set primaryBedroomOnMain true only when the main-floor panel carries a room
labelled Primary, Owner's, Master or Main Suite — judged by the LABEL, not by
which bedroom looks biggest. If the main floor has bedrooms but none of them is
labelled as the primary, it is false.

Say in mainFloorSuiteEvidence which panel you used and how you identified it —
quote its caption if it has one, or say plainly that no main floor was supplied.

2. mainFloorBedroom — true only if a room on THE MAIN FLOOR PANEL is labelled as a bedroom:
   BEDROOM, GUEST SUITE, PRIMARY / OWNER'S SUITE, or a FLEX room explicitly
   labelled as a bedroom. A study, office, den or loft is NOT a bedroom.

3. mainFloorFullBath — true only if a bathroom on THE SAME MAIN FLOOR PANEL contains a BATHTUB
   or a SHOWER. A room labelled HALF BATH or POWDER, or drawn with only a toilet
   and a sink, is NOT a full bath. Builders routinely put a main-floor bedroom
   next to a powder room and market it as a guest suite. Be strict about this.
   A bathroom whose printed dimensions are under about 4 ft in either direction
   cannot hold a tub or a shower — treat it as a half bath.

3b. mainFloorFlexRoom — true if THAT SAME PANEL has an OFFICE, STUDY, DEN,
   LIBRARY, SITTING ROOM or FLEX room: an enclosed room, not a hallway or a
   dining room, that a guest bed could go in.

4. THE KITCHEN AND THE ROOM PEOPLE SIT IN. This buyer cooks at home most
   nights and has already walked away from a house over this, so measure
   carefully rather than impressionistically.

   kitchenLengthFt / kitchenWidthFt — the printed dimensions of the room
     labelled KITCHEN, in feet, longer number first. Convert 27'5" to 27.4.
     Use 0 for both if no dimensions are printed. Do not estimate from the
     drawing scale.

   mainLivingLengthFt / mainLivingWidthFt — same, for the largest room people
     gather in: LIVING ROOM, GREAT ROOM, FAMILY ROOM or GATHERING ROOM. Not the
     dining room, not a sitting room, not a loft. 0 if not printed.

   kitchenOpenToLiving — true only if the kitchen and that gathering room share
     an opening wide enough to see and talk through: no wall between them, or a
     wide cased opening. A doorway is not open. Two rooms that merely touch on
     the plan are not open unless the wall between them is drawn as absent.

   STORAGE AND TRAFFIC, from the plan. These are the questions a drawing can
   actually answer, so answer them from the drawing.

     hasPantry            true if a space is labelled PANTRY, or a small
                          walk-in closet clearly opens off the kitchen. A
                          cabinet run is not a pantry.
     pantryIsLaundry      true if the only pantry-ish space is shared with the
                          washer and dryer, or is labelled both. Builders count
                          a laundry closet as pantry storage; it is not, because
                          you cannot put food where the lint goes.
     kitchenIsThoroughfare
                          true if the main route from the garage or the front
                          door to the rest of the house passes THROUGH the
                          kitchen work area. Look at where the doors are. A
                          kitchen people walk through while you cook is smaller
                          in use than its dimensions suggest.
     kitchenHasIsland     true for a drawn free-standing island or peninsula.

   layoutStyle — how the main floor is organised as a whole:
     "Open concept"       kitchen, dining and living read as one continuous space.
     "Partly open"        kitchen opens to one of them, the rest are separate rooms.
     "Compartmentalized"  most main-floor rooms are enclosed by full walls, each
                          reached through its own doorway. Common in older plans.

3c. houseVisibleInAerial — is there actually a building in the close-in aerial?
   False when you see bare earth, a graded pad, foundations, a partly framed
   structure, or woodland with no house in it. Satellite imagery is often a
   year or more behind construction, so a plot photographed before the house
   was built is common and must be reported as such — every yard answer below
   is meaningless without a house to have a yard.

4. yardFenced — is there a fence enclosing the rear yard? Use the CLOSE IN
   aerial, which has the resolution to trace a fence line.

   "Yes"     you can trace an actual fence line around the rear boundary.
   "No"      you can see the FULL rear boundary, it is unobstructed, and there
             is plainly nothing there — lawn running straight into the
             neighbour's lawn with no line between them.
   "Unclear" anything else.

   "No" is a strong claim and it is nearly always wrong here. This is Georgia:
   mature oaks and pines overhang property lines, and a fence three feet inside
   a tree canopy is invisible from directly above. If any part of the rear
   boundary is under tree cover, in shadow, or cut off by the edge of the frame,
   the honest answer is "Unclear" — you did not see the boundary, so you cannot
   say what is on it.

   Ask yourself: can I actually trace the whole back edge of this lot? If not,
   "Unclear". A wrong "No" throws away a house he would have liked; "Unclear"
   costs him thirty seconds on Street View.

4b. neighboursHaveFences — look at the OTHER houses in the wide aerial, not
   this one. Do their rear yards have fences?
     "Most do"  - fence lines visible around most nearby rear yards.
     "Some do"  - a few have them.
     "None do"  - you can see the neighbouring rear boundaries clearly and none
                  of them has a fence. Same standard as above: if the
                  neighbouring yards are under canopy, this is "Unclear", not
                  "None do".
     "Unclear"  - tree cover or resolution makes it impossible to say.
   This is asked because it indicates whether the neighbourhood's rules permit
   fencing at all, which an unfenced yard by itself cannot tell you.

5. yardUsableSize — how much flat, open ground is behind the house?
   "Generous" — clearly room for a child to run and play games.
   "Adequate"  — a usable patch, but modest.
   "Cramped"   — a strip of grass, a deck and little else.
   Judge the space that is actually usable, not the whole parcel. Steep ground,
   dense woods and driveway do not count as backyard.

6. yardGrade — "Flat" if the rear lot is level; "Steep Slope" if you see
   retaining walls, embankments, a walk-out basement below deck level or an
   obvious drop; "Gentle Slope" for mild grade.

7. yardPrivacy — how exposed is the rear yard to neighbouring windows and yards?

7b. backsOntoWater — is there a pond, lake, or drainage basin touching THIS
   lot's boundary, or immediately behind it? The question is about this
   property, not the neighbourhood: water visible somewhere else in the
   subdivision, across a street, or beyond other people's lots is FALSE, even
   when it is clearly in frame. Judge adjacency from the CLOSE-IN aerial, where
   this lot fills the picture; use the zoomed-out one only to work out what the
   water is. Retention ponds are round or kidney-shaped, sit at the low corner
   of a subdivision, and often have a mown grass collar and no trees at the
   edge. Report a natural lake or creek the same way. When you cannot tell
   whether it touches this lot, answer false and say so in waterEvidence —
   a wrong yes here costs the house six points.

8. backsOntoMajorRoad — true only if a multi-lane road with visible lane
   markings, a turn arrow or a crosswalk runs along or behind the lot. Use the
   ZOOMED OUT aerial for this; the close one is framed too tightly to show it.
   A quiet residential street or a cul-de-sac is not a major road.

9. planPositions — where each room sits ON THE PAGE.

   Treat the TOP of the drawing as north purely as a way of naming positions.
   This is a description of the page, not a claim about the compass — the real
   compass direction is measured separately and the page is rotated to match.

     top of page    -> "North"        top-right    -> "North-East"
     right of page  -> "East"         bottom-right -> "South-East"
     bottom of page -> "South"        bottom-left  -> "South-West"
     left of page   -> "West"         top-left     -> "North-West"

   Judge each room against the CENTRE of the building footprint, ignoring the
   garage. Upper-level plans are drawn in the SAME orientation as the main
   level, so use the same page directions for them. Answer "Unknown" only if a
   room appears on none of the plans you were given.

   childBedroom: give the position of the LARGEST secondary bedroom — the one
   that is not the primary or owner's suite. It is only a default; see below.

9b. secondaryBedrooms — the page position of EVERY bedroom that is not the
   primary suite, in the order they appear, across all floors. A house with
   four bedrooms upstairs and a guest suite down should return five entries
   minus the primary, so four.

   This matters because nobody has decided yet which room the child gets. That
   is chosen after buying, so the app tries all of them and keeps the best —
   which it cannot do unless you list them all. Do not guess at use: a room
   labelled Bedroom, Guest Suite, Flex or Bonus with a closet all count.

     kitchen         the room labelled KITCHEN
     primaryBedroom  PRIMARY / MASTER / OWNER'S SUITE
     childBedroom    any other bedroom; pick the one furthest from the primary
     livingRoom      LIVING / GREAT / FAMILY / GATHERING room
     masterBath      the primary bathroom
     poojaSpace      a small dedicated room with no other purpose, if any

EVIDENCE
For each group, cite in one plain sentence the specific thing in the image that
made you answer that way. For the kitchen, say which walls enclose it and what
it opens onto. If an image is missing or unreadable, say so in the
evidence and answer "Unknown". Never fill a gap with a plausible guess.
`.trim();

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    entranceEdgeOnPlan: { type: Type.STRING, enum: ['Bottom', 'Top', 'Left', 'Right', 'Unknown'] },
    entranceEvidence: { type: Type.STRING },
    mainFloorPlanSeen: { type: Type.BOOLEAN },
    mainFloorBedroom: { type: Type.BOOLEAN },
    primaryBedroomOnMain: { type: Type.BOOLEAN },
    mainFloorFullBath: { type: Type.BOOLEAN },
    mainFloorFlexRoom: { type: Type.BOOLEAN },
    mainFloorSuiteEvidence: { type: Type.STRING },
    kitchenLengthFt: { type: Type.NUMBER },
    kitchenWidthFt: { type: Type.NUMBER },
    kitchenOpenToLiving: { type: Type.BOOLEAN },
    mainLivingLengthFt: { type: Type.NUMBER },
    mainLivingWidthFt: { type: Type.NUMBER },
    layoutStyle: { type: Type.STRING, enum: ['Open concept', 'Partly open', 'Compartmentalized', 'Unknown'] },
    hasPantry: { type: Type.BOOLEAN },
    pantryIsLaundry: { type: Type.BOOLEAN },
    kitchenIsThoroughfare: { type: Type.BOOLEAN },
    kitchenHasIsland: { type: Type.BOOLEAN },
    kitchenEvidence: { type: Type.STRING },
    houseVisibleInAerial: { type: Type.BOOLEAN },
    yardFenced: { type: Type.STRING, enum: ['Yes', 'No', 'Unclear'] },
    neighboursHaveFences: { type: Type.STRING, enum: ['Most do', 'Some do', 'None do', 'Unclear'] },
    yardGrade: { type: Type.STRING, enum: ['Flat', 'Gentle Slope', 'Steep Slope', 'Unknown'] },
    yardUsableSize: { type: Type.STRING, enum: ['Generous', 'Adequate', 'Cramped', 'Unknown'] },
    yardPrivacy: { type: Type.STRING, enum: ['High', 'Medium', 'Low', 'Unknown'] },
    yardEvidence: { type: Type.STRING },
    backsOntoMajorRoad: { type: Type.BOOLEAN },
    backsOntoWater: { type: Type.BOOLEAN },
    waterEvidence: { type: Type.STRING },
    siteEvidence: { type: Type.STRING },
    secondaryBedrooms: {
      type: Type.ARRAY,
      items: { type: Type.STRING, enum: ['North','North-East','East','South-East','South','South-West','West','North-West','Unknown'] },
    },
    planPositions: {
      type: Type.OBJECT,
      properties: {
        kitchen: { type: Type.STRING, enum: ['North','North-East','East','South-East','South','South-West','West','North-West','Unknown'] },
        primaryBedroom: { type: Type.STRING, enum: ['North','North-East','East','South-East','South','South-West','West','North-West','Unknown'] },
        childBedroom: { type: Type.STRING, enum: ['North','North-East','East','South-East','South','South-West','West','North-West','Unknown'] },
        livingRoom: { type: Type.STRING, enum: ['North','North-East','East','South-East','South','South-West','West','North-West','Unknown'] },
        masterBath: { type: Type.STRING, enum: ['North','North-East','East','South-East','South','South-West','West','North-West','Unknown'] },
        poojaSpace: { type: Type.STRING, enum: ['North','North-East','East','South-East','South','South-West','West','North-West','Unknown'] },
      },
      required: ['kitchen', 'primaryBedroom', 'childBedroom', 'livingRoom', 'masterBath', 'poojaSpace'],
    },
  },
  required: [
    'entranceEdgeOnPlan', 'entranceEvidence',
    'mainFloorPlanSeen', 'mainFloorBedroom', 'primaryBedroomOnMain', 'mainFloorFullBath', 'mainFloorFlexRoom', 'mainFloorSuiteEvidence',
    'kitchenLengthFt', 'kitchenWidthFt', 'kitchenOpenToLiving',
    'mainLivingLengthFt', 'mainLivingWidthFt', 'layoutStyle',
    'hasPantry', 'pantryIsLaundry', 'kitchenIsThoroughfare', 'kitchenHasIsland', 'kitchenEvidence',
    'houseVisibleInAerial', 'yardFenced', 'neighboursHaveFences', 'yardGrade', 'yardUsableSize', 'yardPrivacy', 'yardEvidence',
    'backsOntoMajorRoad', 'backsOntoWater', 'waterEvidence', 'siteEvidence', 'planPositions',
  ],
};

/** Perception used when the model is unreachable, so the UI degrades instead of dying. */
export const UNKNOWN_PERCEPTION: Perception = {
  entranceEdgeOnPlan: 'Unknown', entranceEvidence: 'No usable floor plan.',
  mainFloorPlanSeen: false, mainFloorBedroom: false, primaryBedroomOnMain: false,
  mainFloorFullBath: false, mainFloorFlexRoom: false,
  mainFloorSuiteEvidence: 'No usable floor plan.',
  kitchenLengthFt: 0, kitchenWidthFt: 0, kitchenOpenToLiving: false,
  mainLivingLengthFt: 0, mainLivingWidthFt: 0, layoutStyle: 'Unknown',
  hasPantry: false, pantryIsLaundry: false, kitchenIsThoroughfare: false, kitchenHasIsland: false,
  kitchenEvidence: 'No usable floor plan.',
  houseVisibleInAerial: false,
  yardFenced: 'Unclear', neighboursHaveFences: 'Unclear', yardGrade: 'Unknown', yardUsableSize: 'Unknown',
  yardPrivacy: 'Unknown', yardEvidence: 'No usable aerial image.',
  backsOntoMajorRoad: false,
  backsOntoWater: false, waterEvidence: 'No usable aerial image.',
  siteEvidence: 'No usable aerial image.',
  planPositions: {
    kitchen: 'Unknown', primaryBedroom: 'Unknown', childBedroom: 'Unknown',
    livingRoom: 'Unknown', masterBath: 'Unknown', poojaSpace: 'Unknown',
  },
};

/**
 * Fetch an image for the vision request.
 *
 * Sources are mixed by design: an aerial pulled live from Static Maps, a floor
 * plan you dragged in from the listing page and saved locally. Both end up as
 * base64 inline data, and either can be absent without killing the scan.
 */
export async function loadImage(src?: string): Promise<{ data: string; mimeType: string } | null> {
  if (!src) return null;
  try {
    if (/^https?:\/\//.test(src)) {
      const res = await withTimeout(fetch(src), 12_000);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      const mimeType = res.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
      if (!mimeType.startsWith('image/')) return null;
      return { data: buf.toString('base64'), mimeType };
    }
    const buf = await readFile(join(UPLOADS_DIR, src));
    return {
      data: buf.toString('base64'),
      mimeType: src.endsWith('.png') ? 'image/png' : 'image/jpeg',
    };
  } catch {
    return null;
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Gemini call exceeded ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); },
           (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Run one generateContent call through the availability chain.
 *
 * Every model call in the app goes through here. The image and text models both
 * return 503 "high demand" under load often enough that a single-shot call is
 * not safe for anything a user is watching.
 */
export async function callWithFallback(
  buildRequest: (model: string) => Parameters<typeof ai.models.generateContent>[0],
  opts: { rounds?: number; timeoutMs?: number; purpose?: string; images?: number } = {},
): Promise<{ text: string; model: string; ms: number }> {
  const rounds = opts.rounds ?? MAX_ROUNDS;
  const timeout = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let lastError: Error | null = null;

  for (let round = 1; round <= rounds; round++) {
    for (const model of MODEL_CHAIN) {
      const started = Date.now();
      try {
        const res = await withTimeout(ai.models.generateContent(buildRequest(model)), timeout);
        const text = res.text;
        if (!text) throw new Error('empty response body');
        const u = (res as any).usageMetadata ?? {};
        await record({
          at: new Date().toISOString(),
          purpose: opts.purpose ?? 'text',
          model,
          ms: Date.now() - started,
          images: opts.images ?? 0,
          promptTokens: u.promptTokenCount,
          outputTokens: u.candidatesTokenCount,
          ok: true,
        });
        return { text, model, ms: Date.now() - started };
      } catch (err) {
        lastError = err as Error;
        await record({
          at: new Date().toISOString(),
          purpose: opts.purpose ?? 'text',
          model, ms: Date.now() - started, images: opts.images ?? 0, ok: false,
        });
      }
    }
    if (round < rounds) await new Promise((r) => setTimeout(r, 1200 * round));
  }
  throw lastError ?? new Error('all models failed');
}

export interface PerceiveOutcome {
  perception: Perception;
  /** Which images the model actually got. Never inferred from the answer. */
  evidence: EvidenceBase;
  trace: TraceStep[];
  degraded: boolean;
  /** Which model in the chain actually answered. */
  model?: string;
}

async function perceiveOnce(listing: Listing): Promise<PerceiveOutcome> {
  const trace: TraceStep[] = [];
  const t0 = Date.now();

  /* Every storey, not just the first. The primary bedroom is upstairs in most
     of these houses, so reading only the main floor left half the Vastu
     positions permanently Unknown. */
  /* Every storey, up to a sensible ceiling.
     Two was arbitrary and wrong for the seventeen listings that publish three
     or more — a basement plan is exactly where the guest suite lives, and it
     was being dropped. Four extra covers a basement, two upper floors and a
     bonus room; beyond that a listing is publishing marketing variants. */
  const extraPlans = (listing.images.floorPlanExtra ?? []).slice(0, 4);
  const loaded4 = await Promise.all([
    loadImage(listing.images.floorPlan),
    loadImage(listing.images.aerial),
    loadImage(listing.images.aerialWide),
    ...extraPlans.map(loadImage),
  ]);
  const [floorPlan, aerial, aerialWide] = loaded4;
  const upstairs = loaded4.slice(3);

  const loaded = [floorPlan && 'floor plan', aerial && 'aerial'].filter(Boolean) as string[];
  trace.push({
    step: 'Load imagery',
    detail: loaded.length
      ? `Attached ${loaded.join(' + ')} to the vision request.`
      : 'No floor plan or aerial available for this listing.',
    ms: Date.now() - t0,
    status: loaded.length === 2 ? 'ok' : loaded.length ? 'degraded' : 'error',
  });

  const evidence: EvidenceBase = { planRead: Boolean(floorPlan), aerialRead: Boolean(aerial) };

  if (!floorPlan && !aerial) {
    return { perception: { ...UNKNOWN_PERCEPTION }, evidence, trace, degraded: true };
  }

  /* The address is included only so the model can say which property it read.
     The prompt forbids reasoning from it, because an address cannot tell you
     whether the downstairs bathroom has a shower. */
  const parts: any[] = [{ text: `Property: ${listing.address}` }];
  if (listing.notes) parts.push({ text: `Buyer's notes from the listing: ${listing.notes}` });
  /* Numbered, not named.
   *
   * These used to be labelled "FLOOR PLAN, MAIN LEVEL" and "UPPER LEVEL 1, 2,
   * 3" — an assertion about images nobody had checked. `images.floorPlan` is
   * simply whichever plan the gallery listed first, and on 1523 Westend Way
   * that is Redfin's *Floor 2*. So the bedroom floor was announced as the main
   * level, the basement became "upper level 1", and the genuine main floor —
   * uploaded by hand, the only one showing the Foyer, Garage, Kitchen and a
   * 12'11" x 10'7" bedroom with a full bath — was introduced as "upper level
   * 2". Every label was wrong, and the house was scored 15 out of 100 for
   * having no main-floor bedroom when the plan plainly shows one.
   *
   * The model half-caught it: its own evidence line reads "the main floor panel
   * is 'Upper Level 2' ... containing Foyer, Garage, Kitchen, Dining Room, and
   * Family Room" — and it still answered false, because the label outranked
   * what it could see.
   *
   * The prompt already explains how to find the main floor from content: the
   * caption, or failing that the panel with the foyer and the garage. A
   * confident wrong label only fights that. Number them and let it look. */
  const plans = [floorPlan, ...upstairs].filter(Boolean);
  if (plans.length === 1) {
    parts.push({ text: 'IMAGE — FLOOR PLAN:' }, { inlineData: plans[0] });
  } else {
    plans.forEach((img, i) => {
      parts.push(
        { text: `IMAGE — FLOOR PLAN ${i + 1} of ${plans.length} (the storey is NOT implied by this order — identify it from the drawing):` },
        { inlineData: img },
      );
    });
  }
  if (aerial) parts.push({ text: 'IMAGE — AERIAL, CLOSE IN (use this for the fence and the yard):' }, { inlineData: aerial });
  if (aerialWide) parts.push({ text: 'IMAGE — AERIAL, ZOOMED OUT (use this for what surrounds the lot):' }, { inlineData: aerialWide });

  let lastError: Error | null = null;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    for (const model of MODEL_CHAIN) {
      const started = Date.now();
      try {
        const res = await withTimeout(
          ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts }],
            config: {
              systemInstruction: SYSTEM_PROMPT,
              responseMimeType: 'application/json',
              responseSchema: RESPONSE_SCHEMA,
              // Reading a labelled plan is a lookup task, not a reasoning
              // marathon. Low thinking roughly halves p50 with no measured
              // accuracy loss.
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              temperature: 0,
              // Thinking tokens draw from this budget too — 2048 truncated the
              // response and produced empty bodies.
              maxOutputTokens: 4096,
            },
          }),
          REQUEST_TIMEOUT_MS,
        );

        const text = res.text;
        if (!text) throw new Error('empty response body');
        const u = (res as any).usageMetadata ?? {};
        await record({
          at: new Date().toISOString(),
          purpose: 'read plans and aerials',
          model,
          ms: Date.now() - started,
          images: parts.filter((p: any) => p.inlineData).length,
          promptTokens: u.promptTokenCount,
          outputTokens: u.candidatesTokenCount,
          ok: true,
        });
        const perception = PerceptionSchema.parse(JSON.parse(text));

        trace.push({
          step: 'Gemini vision pass',
          detail:
            `${model} read ${loaded.length} image(s) in ${Date.now() - started}ms — ` +
            `main-floor suite=${perception.mainFloorBedroom && perception.mainFloorFullBath}, ` +
            `fenced=${perception.yardFenced}, kitchen=${perception.kitchenLengthFt}x${perception.kitchenWidthFt}ft, ` +
            `layout=${perception.layoutStyle}, pantry=${perception.hasPantry}.`,
          ms: Date.now() - started,
          status: model === MODEL ? 'ok' : 'degraded',
        });
        return { perception, evidence, trace, degraded: false, model };
      } catch (err) {
        lastError = err as Error;
        trace.push({
          step: `${model} attempt (round ${round})`,
          detail: lastError.message.slice(0, 180),
          ms: Date.now() - started,
          status: 'error',
        });
      }
    }
    if (round < MAX_ROUNDS) await new Promise((r) => setTimeout(r, 1500 * round));
  }

  trace.push({
    step: 'Vision degraded',
    detail:
      `Every model in the chain failed (${lastError?.message?.slice(0, 120)}). ` +
      `Scoring on listing facts only — the spatial dimensions will read "Unknown".`,
    ms: 0,
    status: 'degraded',
  });
  /* The call failed, so nothing was read no matter how many images we had. */
  return {
    perception: { ...UNKNOWN_PERCEPTION },
    evidence: { planRead: false, aerialRead: false },
    trace,
    degraded: true,
  };
}

/* -------------------- reading the same plan more than once -------------------- */

/**
 * Read the plan three times and take the majority on the answers that flip.
 *
 * 1190 Krobot Way, asked four times with `temperature: 0` and an unchanged
 * image, answered "bedroom and full bath on the main floor" twice and "no
 * bedroom at all" twice — a seven point swing in the overall score, decided by
 * nothing. Looking at the plan myself settles it: the 1st floor panel is
 * labelled BEDROOM 9'10" x 17'3" with a BATH 5'9" x 7'11" beside it. The
 * bedroom is there. Half the reads were simply wrong.
 *
 * Telling the prompt how to find the main-floor panel in a composite drawing
 * helped a lot — every read now names the right panel — but did not make it
 * deterministic: what remains is whether that 5'9" x 7'11" bath holds a
 * shower, and at this image resolution the fixtures genuinely are not legible.
 *
 * So the honest fix is not a better single guess. It is to stop treating one
 * sample as a measurement: read three times, take the majority on each of the
 * three main-floor booleans, and when the readers do not agree say so in the
 * evidence rather than presenting a coin flip as a fact. That is the same rule
 * the rest of this app follows — unknown has to read as unknown.
 *
 * Only these three fields are voted. Everything else — dimensions printed on
 * the page, the fence in the aerial — was stable across every trial, and
 * tripling the cost of the whole read to re-settle what does not move would be
 * paying for nothing. The reads run concurrently, so this costs latency once,
 * not three times.
 */
const VOTED_FIELDS = ['mainFloorBedroom', 'mainFloorFullBath', 'mainFloorFlexRoom'] as const;
const READS = 3;

/**
 * Which gallery photo is the front of the house.
 *
 * `images.exterior` was the first gallery URL, on the assumption that a listing
 * leads with the facade. It does not. 1510 Heritage Dr leads with the kitchen,
 * and other pages lead with a community entrance sign or a staircase — so the
 * lead photo on his list has sometimes been a signboard, and a facade-rating
 * sheet built from that field was unusable.
 *
 * One cheap call per house, over the first few photos, asking only for an
 * index. Returns null rather than guessing when none of them shows the front:
 * a wrong facade is worse than no facade, because he judges houses on it.
 */
export async function pickFrontElevation(urls: string[]): Promise<number | null> {
  /* Both ends of the gallery, not the first few.
   *
   * These galleries run to forty photos. A first-six window answered "none of
   * them" for 1510 Heritage Dr, 5045 Reserve Dr and 5765 Willow Oak Pass, and
   * widening to twelve changed nothing — because a listing that opens with the
   * kitchen puts its elevation at the END, after the interiors and before or
   * among the aerials. Heritage runs 37 photos, Reserve 39, Willow Oak 41.
   *
   * So sample the front and the back of the sequence and let the model choose
   * between them. Sixteen images in one call, rather than forty. */
  /* Cheapest window first, then the rest. 1510 Heritage Dr's elevation is photo
     33 of 37; 5045 Reserve Dr's is in neither end. Rather than keep widening a
     guess, try head+tail in one call and fall back to sweeping the middle — so
     the common case stays one call and the awkward case still gets answered. */
  const head = urls.slice(0, 8);
  const tail = urls.slice(-8).filter((u) => !head.includes(u));
  const middle = urls.filter((u) => !head.includes(u) && !tail.includes(u));
  const windows = [[...head, ...tail]];
  for (let k = 0; k < middle.length; k += 14) windows.push(middle.slice(k, k + 14));

  for (const win of windows) {
    const found = await scanForFront(win, urls);
    if (found !== null) return found;
  }
  return null;
}

/** One call over one window of photos. Returns an index into `all`, or null. */
async function scanForFront(win: string[], all: string[]): Promise<number | null> {
  const shots = (await Promise.all(win.map((u) => loadImage(u))))
    .map((img, k) => ({ img, i: all.indexOf(win[k]!) }))
    .filter((x): x is { img: { data: string; mimeType: string }; i: number } => x.img !== null);
  if (!shots.length) return null;
  const urls = all;

  const parts: unknown[] = [{
    text:
      'Each image below is a photo from one house listing, numbered.\n\n' +
      'Return the number of the photo that best shows THE OUTSIDE OF THIS HOUSE FROM THE ' +
      'FRONT — the elevation containing the front door. A three-quarter angle is fine. ' +
      'Twilight or dusk is fine. Some driveway or lawn in the frame is fine.\n\n' +
      'Rule out only: interior rooms, the back garden or patio, overhead aerials, ' +
      'community entrance signs, floor plans, and photos of a neighbouring house.\n\n' +
      'Prefer a wider shot over a tight crop of just the door. If several qualify, pick the ' +
      'one where most of the front of the house is visible.\n\n' +
      'Return 0 only if NONE of these photos shows the outside front of the house. ' +
      'Answer with the number alone.',
  }];
  for (const { img, i } of shots) {
    parts.push({ text: `PHOTO ${i + 1}:` }, { inlineData: img });
  }

  const { text } = await callWithFallback(
    (model) => ({
      model,
      contents: [{ role: 'user', parts: parts as never }],
      config: { temperature: 0, maxOutputTokens: 8 },
    }),
    { purpose: 'pick the front elevation', images: shots.length, rounds: 2 },
  );
  const n = Number((text.match(/\d+/) ?? ['0'])[0]);
  if (!Number.isFinite(n) || n < 1 || n > urls.length) return null;
  return n - 1;
}

export async function perceiveProperty(listing: Listing): Promise<PerceiveOutcome> {
  /* Nothing to disagree about without a plan — one read, as before. */
  if (!listing.images.floorPlan) return perceiveOnce(listing);

  const runs = (await Promise.all(
    Array.from({ length: READS }, () => perceiveOnce(listing).catch(() => null)),
  )).filter((r): r is PerceiveOutcome => r !== null && !r.degraded);

  if (!runs.length) return perceiveOnce(listing);

  /* The first good read carries everything that did not need a vote. */
  const out: PerceiveOutcome = runs[0];
  const split: string[] = [];

  for (const field of VOTED_FIELDS) {
    const votes = runs.map((r) => r.perception[field] === true);
    const yes = votes.filter(Boolean).length;
    (out.perception as Record<string, unknown>)[field] = yes * 2 > votes.length;
    if (yes !== 0 && yes !== votes.length) split.push(`${field} ${yes}/${votes.length}`);
  }

  if (split.length) {
    out.perception.mainFloorSuiteEvidence =
      `Read ${runs.length} times and the readings disagreed (${split.join(', ')}); `
      + `the majority is reported. Worth checking the plan yourself. `
      + (out.perception.mainFloorSuiteEvidence ?? '');
  }

  out.trace.push({
    step: `Read the plan ${runs.length} times`,
    detail: split.length
      ? `The readings disagreed on ${split.join(', ')}. Majority taken, and the house says so.`
      : `All ${runs.length} readings agreed on the main floor.`,
    ms: 0,
    status: split.length ? 'degraded' : 'ok',
  });
  return out;
}
