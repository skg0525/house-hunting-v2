/**
 * Which way does the house face?
 *
 * This is the question the whole tool exists to answer, and it is the one a
 * floor plan cannot answer. Listing plans have no north arrow. So instead of
 * reading a drawing, work it out from where the house is and where the road is:
 *
 *   A front door faces the street it fronts. Google's Street View car drives on
 *   that street. So the bearing from the house to the nearest Street View
 *   panorama is, to within a few degrees, the direction the front of the house
 *   faces.
 *
 * That is a measurement rather than an inference, which matters because a
 * south-facing front door is your one hard rule. A rule enforced on a guess is
 * worse than no rule at all.
 *
 * The failure modes are handled explicitly rather than hidden:
 *   - corner lots have two fronting streets, so the nearest pano may be the
 *     side street. Confidence drops to medium.
 *   - a geocode that lands on the street centreline rather than the roof gives
 *     a meaningless bearing. Confidence drops to low and nothing is ruled out.
 */
import { Type, ThinkingLevel } from '@google/genai';
import { CardinalDirection, Orientation } from '../types/listing.js';
import { callWithFallback } from './geminiEvaluator.js';

const KEY = process.env.GOOGLE_MAPS_API_KEY ?? '';

const UNKNOWN: Orientation = {
  entranceDirection: 'Unknown',
  bearingDeg: null,
  confidence: 'none',
  method: 'No Maps API key configured.',
};

/** Compass bearing from point A to point B, in degrees clockwise from north. */
export function bearing(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const rad = Math.PI / 180;
  const φ1 = from.lat * rad, φ2 = to.lat * rad;
  const Δλ = (to.lng - from.lng) * rad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/** Metres between two coordinates. Haversine, plenty accurate at this scale. */
export function metresBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = Math.PI / 180, R = 6_371_000;
  const dφ = (b.lat - a.lat) * rad;
  const dλ = (b.lng - a.lng) * rad;
  const h = Math.sin(dφ / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const COMPASS: CardinalDirection[] = [
  'North', 'North-East', 'East', 'South-East',
  'South', 'South-West', 'West', 'North-West',
];

/** 45-degree sectors centred on each of the eight points. */
export function toCardinal(deg: number): CardinalDirection {
  return COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8]!;
}

/**
 * How close to due south is too close?
 *
 * A 45-degree sector means anything from 157.5 to 202.5 reads as "South". A
 * house at 200 degrees is south-south-west; calling it south-facing and
 * throwing it out would be over-reading a measurement that is itself only good
 * to a few degrees. The sector is the rule, and `nearSouth` below flags the
 * edges so you can see when a house was close to the line.
 */
export function nearSouth(deg: number): boolean {
  const d = Math.abs(((deg - 180 + 540) % 360) - 180);
  return d <= 35 && d > 22.5;   // 145-157.5 and 202.5-215
}

/** The three sectors he will not buy: South, South-East, South-West. */
export const BARRED_DIRECTIONS = ['South', 'South-East', 'South-West'] as const;

/**
 * Just outside the barred half, and close enough to want a second opinion.
 *
 * The rule used to be south alone, so the edges that mattered were either side
 * of 180°. Barring South-East and South-West moves the boundary out to 112.5°
 * (East / South-East) and 247.5° (South-West / West), and those are now the
 * lines a few degrees of error can carry a house across. A house measured at
 * 115° is East on paper and South-East in practice.
 */
export function nearBarred(deg: number): boolean {
  const d = (x: number) => Math.abs(((deg - x + 540) % 360) - 180) - 180;
  const toEdge = Math.min(Math.abs(d(112.5)), Math.abs(d(247.5)));
  return toEdge <= 12;
}

interface GeocodeResult {
  coords: { lat: number; lng: number };
  locationType: string;
  formatted: string;
}

/**
 * Address to coordinates, free and without a key.
 *
 * The Census Bureau geocodes US addresses for anyone. It is slower and fussier
 * about formatting than Google, and it interpolates along the street rather
 * than finding the roof — so it is good enough to place a house on a map and
 * pull its tract, and NOT good enough to measure which way the house faces.
 * Callers get 'RANGE_INTERPOLATED' back, which downgrades the bearing
 * confidence to medium and keeps a merely-plausible reading from ruling a
 * house out.
 */
async function censusGeocode(address: string): Promise<GeocodeResult | null> {
  const url =
    'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress' +
    `?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
  try {
    const res = await fetch(url);
    const json: any = await res.json();
    const m = json?.result?.addressMatches?.[0];
    if (!m) return null;
    return {
      coords: { lat: m.coordinates.y, lng: m.coordinates.x },
      locationType: 'RANGE_INTERPOLATED',
      formatted: m.matchedAddress ?? address,
    };
  } catch {
    return null;
  }
}

export async function geocode(address: string): Promise<GeocodeResult | null> {
  if (KEY) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json` +
        `?address=${encodeURIComponent(address)}&key=${KEY}`;
      const res = await fetch(url);
      const json: any = await res.json();
      const top = json?.results?.[0];
      if (top) {
        return {
          coords: { lat: top.geometry.location.lat, lng: top.geometry.location.lng },
          locationType: top.geometry.location_type ?? 'UNKNOWN',
          formatted: top.formatted_address ?? address,
        };
      }
    } catch { /* fall through to the free one */ }
  }
  return censusGeocode(address);
}

/** Nearest Street View panorama to a point, if one exists within `radius` metres. */
async function nearestPano(
  coords: { lat: number; lng: number },
  radius = 50,
): Promise<{ lat: number; lng: number } | null> {
  if (!KEY) return null;
  const url = `https://maps.googleapis.com/maps/api/streetview/metadata` +
    `?location=${coords.lat},${coords.lng}&radius=${radius}&source=outdoor&key=${KEY}`;
  const res = await fetch(url);
  const json: any = await res.json();
  if (json?.status !== 'OK' || !json.location) return null;
  return { lat: json.location.lat, lng: json.location.lng };
}

/* ------------------------------------------------------------------ *
 * Fallback: read the road off a map instead of a photograph
 * ------------------------------------------------------------------ */

/**
 * For houses the Street View car has never driven past.
 *
 * New construction is the case that breaks the primary method, and it breaks it
 * twice over: no panorama on a street that did not exist last year, and a
 * satellite tile still showing the woods that were cleared to build it. The
 * house we most wanted to check was invisible to both.
 *
 * Google's *road* data is vector, and it is updated far sooner than either. So
 * render a plain roadmap tile centred on the house and ask which side of it the
 * nearest road sits on. Static Maps tiles are north-up by construction, so that
 * answer is already a compass direction — the same trick as the Street View
 * bearing, using the road itself rather than a camera parked on it.
 *
 * Coarser than a bearing: it gives a side, not an angle. Hence medium
 * confidence at best, and low whenever the model says the call was close.
 */
const ROAD_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    roadSide: {
      type: Type.STRING,
      enum: ['North', 'North-East', 'East', 'South-East',
             'South', 'South-West', 'West', 'North-West', 'Unclear'],
    },
    /* The same relationship stated the other way round, purely so the two can
       be checked against each other. */
    markerSide: {
      type: Type.STRING,
      enum: ['North', 'North-East', 'East', 'South-East',
             'South', 'South-West', 'West', 'North-West', 'Unclear'],
    },
    clarity: { type: Type.STRING, enum: ['Clear', 'Close call', 'Unclear'] },
    reasoning: { type: Type.STRING },
  },
  required: ['roadSide', 'markerSide', 'clarity', 'reasoning'],
};

/**
 * Where the nearest road actually is, as geometry rather than as a reading.
 *
 * This is the same idea as the Street View method — the front door faces the
 * street, so the bearing from the house to the street is the facing — except it
 * asks the road network directly instead of asking a model to look at a picture
 * of it. No interpretation, so no inversion: `nearestRoads` returns a point on
 * the tarmac and the bearing to it is arithmetic.
 *
 * It exists because the picture-reading fallback was caught answering backwards
 * on 4540 Manning Dr, and a source that can be confidently 180 degrees wrong is
 * not a source. Forty-five houses on this list have no Street View at all —
 * every new-construction street — so the fallback matters as much as the
 * primary.
 *
 * Needs the Roads API on the key's restriction list, which is separate from
 * having it enabled on the project. Without it this returns null and the older
 * map-reading fallback still runs.
 */
async function roadBearing(
  coords: { lat: number; lng: number },
): Promise<{ bearing: number; metres: number } | null> {
  if (!KEY) return null;

  /* Ask about a small cluster, not a single point.
   *
   * `nearestRoads` is probabilistic at the margins — the same coordinate
   * returned a road on one call and nothing on the next. Probing the house
   * plus four points about fifteen metres out on each axis gives the service
   * several chances to snap, and the nearest result to the house is the one we
   * want. Still a single request. */
  const d = 0.00014;                       // roughly 15 m
  const probes = [
    coords,
    { lat: coords.lat + d, lng: coords.lng },
    { lat: coords.lat - d, lng: coords.lng },
    { lat: coords.lat, lng: coords.lng + d },
    { lat: coords.lat, lng: coords.lng - d },
  ];

  try {
    const points = probes.map((p) => `${p.lat},${p.lng}`).join('|');
    const res = await fetch(
      `https://roads.googleapis.com/v1/nearestRoads?points=${points}&key=${KEY}`,
    );
    const json: any = await res.json();
    const snapped: { lat: number; lng: number }[] =
      (json?.snappedPoints ?? []).map((s: any) => ({
        lat: s.location.latitude as number, lng: s.location.longitude as number,
      }));
    if (!snapped.length) return null;

    /* The closest bit of tarmac to the house is the street it fronts. Points
       on top of the house are the driveway; anything past 120 m is a different
       road and says nothing about which way the front door points. */
    const candidates = snapped
      .map((to) => ({ to, metres: metresBetween(coords, to) }))
      .filter((c) => c.metres >= 4 && c.metres <= 120)
      .sort((a, b) => a.metres - b.metres);

    const best = candidates[0];
    if (!best) return null;

    return { bearing: bearing(coords, best.to), metres: Math.round(best.metres) };
  } catch {
    return null;
  }
}

const ROAD_PROMPT = `
You are looking at a north-up road map. North is the top of the image, south the
bottom, east the right, west the left.

A single red marker shows one house. Find the nearest paved road to that marker.

Answer TWO questions about the same pair, and be careful: they are opposites,
and confusing them is the one mistake that matters here.

  roadSide   - standing AT THE MARKER, which way do you walk to reach the road?
               Road drawn to the right of the marker -> "East".
  markerSide - standing ON THAT ROAD, which way is the marker?
               Same picture -> "West".

If your two answers are not opposite directions, you have made an error: say
"Unclear" for both rather than guessing which one you meant.

Measure from the marker to the CLOSEST point of the nearest road. If one road
runs along the left edge and another passes just below the marker, the one just
below is nearer, so roadSide is "South" and markerSide is "North".

clarity:
  "Clear"      - one road is plainly nearest and plainly on one side.
  "Close call" - two roads are at similar distance, or the nearest road runs
                 diagonally past the marker, so the side is arguable.
  "Unclear"    - no road is visible near the marker, or you cannot tell.

Say in one sentence which road you measured to and roughly how far it looked.
Do not guess. "Unclear" is a useful answer; a confident wrong one is not.

Why it matters: the road is the street the house fronts, so roadSide is the way
the front door points. Reporting it backwards points the house at its own back
garden, and every room in the Vastu reading rotates a hundred and eighty degrees
with it.
`.trim();

async function roadSideFromMap(
  coords: { lat: number; lng: number },
): Promise<{ direction: CardinalDirection; clarity: string; note: string } | null> {
  const url =
    'https://maps.googleapis.com/maps/api/staticmap' +
    `?center=${coords.lat},${coords.lng}&zoom=18&size=640x640&maptype=roadmap` +
    `&markers=size:tiny%7Ccolor:red%7C${coords.lat},${coords.lng}&key=${KEY}`;

  try {
    const res = await fetch(url);
    if (!res.headers.get('content-type')?.startsWith('image/')) return null;
    const data = Buffer.from(await res.arrayBuffer()).toString('base64');

    const { text } = await callWithFallback((model) => ({
      model,
      contents: [{ role: 'user', parts: [{ inlineData: { data, mimeType: 'image/png' } }] }],
      config: {
        systemInstruction: ROAD_PROMPT,
        responseMimeType: 'application/json',
        responseSchema: ROAD_SCHEMA,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        temperature: 0,
        maxOutputTokens: 2048,
      },
    }), { purpose: 'read facing from road map', images: 1 });

    const parsed = JSON.parse(text);
    if (!parsed.roadSide || parsed.roadSide === 'Unclear') return null;

    /* The two answers must be opposites. Asking one "which side" question let
       the model invert it silently — 4540 Manning Dr came back "West" with
       reasoning that said the road was to the east, and the house was scored
       facing its own back garden. Asking twice makes the mistake visible. */
    const OPPOSITE: Record<string, string> = {
      North: 'South', South: 'North', East: 'West', West: 'East',
      'North-East': 'South-West', 'South-West': 'North-East',
      'North-West': 'South-East', 'South-East': 'North-West',
    };
    if (parsed.markerSide && OPPOSITE[parsed.roadSide] !== parsed.markerSide) return null;
    return {
      direction: parsed.roadSide as CardinalDirection,
      clarity: parsed.clarity,
      note: parsed.reasoning,
    };
  } catch {
    return null;
  }
}

export async function resolveOrientation(
  address: string,
  known?: { lat: number; lng: number },
  knownQuality?: string,
): Promise<Orientation> {
  /* Street View is the measurement. There is no free substitute for it, so
     without a Maps key the honest answer is "I don't know", not a guess. */
  if (!KEY) {
    return {
      ...UNKNOWN,
      method: 'No Google Maps key set, so the facing direction was never measured. ' +
              'Nothing can be ruled out on the south-facing rule until it is.',
    };
  }

  let coords = known;
  /* Never assume a stored coordinate is good. An unlabelled one is treated as
     interpolated, because the free fallback geocoder is the likely source and
     its points sit on the road. */
  let locationType = known ? (knownQuality ?? 'RANGE_INTERPOLATED') : '';

  if (!coords) {
    const g = await geocode(address);
    if (!g) {
      return { ...UNKNOWN, method: 'Could not geocode this address.' };
    }
    coords = g.coords;
    locationType = g.locationType;
  }

  const pano = await nearestPano(coords);

  /* No panorama usually means new construction. Fall back to the road map. */
  if (!pano) {
    /* Geometry first. Only if the road network cannot answer does a model get
       asked to look at a picture of the same thing. */
    const geo = await roadBearing(coords);
    if (geo) {
      return {
        entranceDirection: toCardinal(geo.bearing),
        bearingDeg: geo.bearing,
        /* The distance to the road IS the confidence.
         *
         * Thirty-five metres was already the line past which this reading was
         * not allowed to delete a house. It was only ever applied to the
         * rule-out, which left the tool saying two incompatible things about
         * one number: too unreliable to remove 7395 Winderlea Ln, and reliable
         * enough to award 7095 Grassmoor Grange Way full marks for facing east
         * off a road 40 m away.
         *
         * A reading is either trustworthy or it is not. Putting the threshold
         * on the confidence rather than on the rule makes it one answer:
         * `scoreDirection` blends a low-confidence bearing halfway to neutral,
         * and the rule-out already declines to fire on one. */
        confidence: geo.metres > 35 ? 'low' : 'medium',
        source: 'roadNetwork',
        sourceMetres: geo.metres,
        method:
          `No Street View on this street, so the facing was taken from the road network: ` +
          `the nearest road is ${geo.metres} m away on a bearing of ${geo.bearing.toFixed(0)}°, ` +
          `and the front of a house faces its street. Measured, not read off a picture — ` +
          `but confirm on the plat if it matters, because a corner plot has two streets.`,
      };
    }

    const road = await roadSideFromMap(coords);
    if (!road) {
      return {
        entranceDirection: 'Unknown',
        bearingDeg: null,
        confidence: 'none',
        source: 'none',
        method: 'No Street View coverage and no road readable from the map — check the facing yourself.',
      };
    }
    return {
      entranceDirection: road.direction,
      bearingDeg: null,
      confidence: road.clarity === 'Clear' ? 'medium' : 'low',
      source: 'roadMapModel',
      method:
        `No Street View on this street, so the facing was read from Google's road map instead: ` +
        `the nearest road lies to the ${road.direction.toLowerCase()} of the house, ` +
        `which is the side the front door is on. ${road.note} ` +
        `(${road.clarity === 'Clear' ? 'A clear read, but a side rather than an exact angle' : 'The model called this a close one'} — worth confirming on the plat.)`,
    };
  }

  const deg = bearing(coords, pano);
  const distance = metresBetween(coords, pano);

  /* A geocode snapped to the street centreline sits ON the road, so the bearing
     to the pano is noise. ROOFTOP results are the ones worth trusting. */
  let confidence: Orientation['confidence'] =
    locationType === 'ROOFTOP' ? 'high' :
    locationType === 'RANGE_INTERPOLATED' ? 'medium' : 'low';

  // Too close and the bearing is unstable; too far and the pano is probably a
  // different street entirely.
  if (distance < 8) confidence = 'low';
  else if (distance > 45 && confidence === 'high') confidence = 'medium';

  const direction = toCardinal(deg);
  const streetViewUrl =
    `https://maps.googleapis.com/maps/api/streetview?size=640x400` +
    `&location=${coords.lat},${coords.lng}&heading=${((deg + 180) % 360).toFixed(0)}` +
    `&pitch=0&fov=80&key=${KEY}`;

  const notes = [
    `Front faces ${deg.toFixed(0)}° (${direction}), measured from the house to the ` +
    `nearest Street View camera ${distance.toFixed(0)} m away`,
  ];
  if (confidence !== 'high') notes.push(`confidence ${confidence} — ${
    confidence === 'low'
      ? 'the address did not resolve to a rooftop, so treat this as a hint'
      : 'could be a corner lot or an interpolated address'
  }`);
  if (nearSouth(deg)) notes.push('leaning southerly, though not within the south sector');

  return {
    entranceDirection: direction, bearingDeg: deg, confidence,
    method: notes.join('; ') + '.', streetViewUrl,
    source: 'streetview', sourceMetres: Math.round(distance),
  };
}


/**
 * Which of two coordinates to believe, and when to believe neither.
 *
 * Three sources, none of them reliable alone:
 *
 *   A ROOFTOP geocode is Google saying "I know this exact building". Trust it.
 *
 *   An APPROXIMATE one is Google saying "I found the town". Asked for
 *   "4835 Rosarian Dr, Cumming" it answers "Cumming, GA, USA" and hands back
 *   the centroid — five and a half miles from the house, and the app then
 *   measured the facing, pulled the satellite tile, computed the commute and
 *   read the census tract for a spot in the middle of town. Never trust it.
 *
 *   The listing page carries the site's own coordinates for the property, which
 *   is usually better because it is their listing. But not always: for a lot
 *   that does not exist yet they fall back to the same town centroid, and the
 *   giveaway is that several unrelated addresses then share one point.
 *
 * So a point that more than one house claims is not a location, it is a
 * failure, and the honest answer is no coordinates at all.
 */
export function pickCoords(
  geocoded: { coords?: { lat: number; lng: number }; quality?: string } | null,
  fromPage: { lat: number; lng: number } | undefined,
  /** Points already known to be shared by several houses — a centroid. */
  suspect: (c: { lat: number; lng: number }) => boolean,
): { coords?: { lat: number; lng: number }; source: string } {
  const good = (q?: string) => q === 'ROOFTOP';
  const usable = (q?: string) => q === 'ROOFTOP' || q === 'RANGE_INTERPOLATED';

  if (good(geocoded?.quality) && geocoded?.coords)
    return { coords: geocoded.coords, source: 'rooftop geocode' };

  if (fromPage && !suspect(fromPage))
    return { coords: fromPage, source: "the listing's own coordinates" };

  if (usable(geocoded?.quality) && geocoded?.coords)
    return { coords: geocoded.coords, source: 'interpolated geocode' };

  /* Everything left is a town centroid wearing a coordinate's clothes. */
  return { source: 'could not be placed' };
}
