/**
 * How far out am I actually moving?
 *
 * A commute time answers one question. It does not answer the one he asked —
 * people say that once you leave the city you stop coming back, and he wants to
 * know how far from Midtown each house really is before that becomes true of
 * him.
 *
 * So every house is measured against a handful of fixed places: where he lives
 * now, where he works, and two landmarks he named himself. Avalon is in the
 * list precisely because he said he never goes there — it is a ruler, not a
 * destination. A house forty minutes from Avalon is deep in the suburbs whether
 * or not he ever visits.
 *
 * Straight-line distance was the whole thing at first, and it was not enough.
 * "30.2 miles to Midtown" is a fact about a map; "42 minutes on a clear road,
 * 68 at five o'clock" is a fact about a Saturday. Both are shown — the miles
 * because they do not change, the minutes because they are what he will feel.
 *
 * The drive is one request per anchor, not two: the Routes API returns the
 * traffic-aware duration and the free-flow `staticDuration` in the same reply,
 * so peak and off-peak arrive together.
 */
import { geocode, metresBetween } from './orientation.js';
import { nextTypicalWeekdayAt } from './commute.js';

const KEY = process.env.GOOGLE_MAPS_API_KEY ?? '';

async function driveTo(
  from: { lat: number; lng: number }, to: { lat: number; lng: number },
): Promise<{ peakMinutes: number; freeMinutes: number; driveMiles: number } | undefined> {
  if (!KEY) return undefined;
  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': KEY,
        'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
        departureTime: nextTypicalWeekdayAt(17),
        trafficModel: 'BEST_GUESS',
      }),
    });
    const json: any = await res.json();
    const r = json?.routes?.[0];
    if (!r) return undefined;
    const mins = (v: string) => Math.round(Number(String(v).replace('s', '')) / 60);
    return {
      peakMinutes: mins(r.duration),
      freeMinutes: mins(r.staticDuration ?? r.duration),
      driveMiles: Math.round((Number(r.distanceMeters ?? 0) / 1609.34) * 10) / 10,
    };
  } catch {
    return undefined;
  }
}

export interface Anchor {
  key: string;
  label: string;
  address: string;
  /** Why this place is on the list, shown so the numbers mean something. */
  note: string;
  coords?: { lat: number; lng: number };
  /**
   * Measure the 5pm drive FROM this place TO the house, not the other way.
   *
   * True for the office and nothing else. At five o'clock he is driving home
   * from work, not to it, and on this corridor the two are not the same trip:
   * 6005 Overleaf Terrace is 18 minutes house-to-office and 27 office-to-house
   * at the same departure, because one direction runs with the outbound rush
   * and the other against it. Asking for the wrong one put "18 min at 5pm" on
   * the detail page beside a list card reading 26, from the same house to the
   * same office on the same evening.
   */
  eveningFromAnchor?: boolean;
}

/* WHERE YOU LIVE AND WHERE YOU WORK ARE PERSONAL.
 *
 * Both come from the environment so this file can be public. Set HOME_ADDRESS
 * and WORK_ADDRESS in backend/.env; without them the commute still runs, just
 * against the centre of each town, which is accurate to a few minutes and
 * tells a reader nothing about anybody.
 *
 * ANCHORS ARE PERSONAL — do not hardcode a real street address here again. */
export const ANCHORS: Anchor[] = [
  {
    key: 'home',
    label: 'Midtown (home now)',
    address: process.env.HOME_ADDRESS ?? 'Midtown, Atlanta, GA',
    note: 'Where you live. The distance you would be adding to every trip back into the city.',
  },
  {
    key: 'work',
    label: 'Office',
    address: process.env.WORK_ADDRESS ?? 'Alpharetta, GA',
    note: 'North Point Parkway.',
    eveningFromAnchor: true,
  },
  {
    key: 'avalon',
    label: 'Avalon',
    address: '400 Avalon Blvd, Alpharetta, GA 30009',
    note: 'You said you never go. That is what makes it a good ruler — it marks where the built-up part of Alpharetta ends.',
  },
  {
    key: 'halcyon',
    label: 'Halcyon',
    address: '6365 Halcyon Way, Alpharetta, GA 30005',
    note: 'The northern equivalent. Past Halcyon is properly out.',
  },
];

let resolved: Anchor[] | null = null;

/** Geocoded once per process; these addresses do not move. */
export async function anchors(): Promise<Anchor[]> {
  if (resolved) return resolved;
  resolved = await Promise.all(
    ANCHORS.map(async (a) => ({
      ...a,
      coords: (await geocode(a.address).catch(() => null))?.coords,
    })),
  );
  return resolved;
}

export interface AnchorDistance {
  key: string;
  label: string;
  /**
   * Driving miles, from the route itself — not the straight line.
   *
   * This was `metresBetween`, as the crow flies, printed directly above a
   * driving time. 6005 Overleaf Terrace read "7.9 mi / 18 min at 5pm" when the
   * road distance is 10.7. Nobody reads a figure in that position as anything
   * but the drive. The straight line is kept as a fallback for when the Routes
   * call fails, and only then.
   */
  miles: number;
  note: string;
  /** Driving, leaving 5pm on an ordinary Tuesday. */
  peakMinutes?: number;
  /** The same drive with the road clear. */
  freeMinutes?: number;
}

export async function distancesFrom(
  coords: { lat: number; lng: number },
): Promise<AnchorDistance[]> {
  const list = (await anchors()).filter((a) => a.coords);
  return Promise.all(list.map(async (a) => {
    /* The office is measured on the drive he actually makes at five — home from
       work. Everything else is a ruler for how far out the house sits, so it is
       measured the way he would set off towards it. */
    const drive = a.eveningFromAnchor
      ? await driveTo(a.coords!, coords)
      : await driveTo(coords, a.coords!);
    const { driveMiles, ...times } = drive ?? {};
    return {
      key: a.key,
      label: a.label,
      miles: driveMiles ?? Math.round((metresBetween(coords, a.coords!) / 1609.34) * 10) / 10,
      note: a.note,
      ...times,
    };
  }));
}
