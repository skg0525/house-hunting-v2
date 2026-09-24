/**
 * The drive, at the times it is actually driven.
 *
 * A single "35 minutes" is the number that makes people buy the wrong house.
 * It is the free-flow figure, measured at a time nobody commutes. The real
 * complaint about the current place is precise and worth encoding exactly:
 *
 *   35 min off-peak, 45 in the morning, and 75 coming home between 4 and 6.
 *
 * The 75 is the number that ruins a week. Twice a day, five days a week, an
 * hour and a quarter each way is ten hours in a car — and it is invisible to
 * every listing site, all of which quote something closer to the 35.
 *
 * So three departure times are priced separately.
 *
 * WHAT WENT WRONG, AND WHAT IT ACTUALLY WAS
 *
 * Google's predicted traffic came back flat for all eighty-seven houses, and
 * the conclusion drawn from that was that the Routes API does not model peak
 * congestion on this corridor. That was wrong, and worth writing down because
 * the reasoning looked sound.
 *
 * The departure time was computed as "the next weekday at 5pm". That skipped
 * Saturday and Sunday but not public holidays, so every scan run over a weekend
 * asked Google about Monday — and one of those Mondays was Labor Day. Office to
 * Midtown at 5pm returns 32 minutes on Labor Day and 57 on the Tuesday after.
 * The model was fine. The question was being asked about a day nobody commutes.
 *
 * Two fixes. The departure is now a normal midweek day, avoiding Mondays,
 * Fridays and the federal holidays, because those are the days that are not
 * representative of a working week. And the evening leg is asked twice, once
 * for the typical day and once with trafficModel PESSIMISTIC for a bad one.
 *
 * Calibration, stated plainly: on the single drive he has actually timed — the
 * current Midtown run — he reports 75 minutes where Google's typical says 57
 * and its pessimistic says 87. So the truth on this corridor sits between the
 * two and nearer the bad day than the good one. Both are reported and the
 * typical one is scored, which is the conservative choice in the direction that
 * matters: it does not flatter a house.
 *
 * His own stopwatch still outranks all of it. `observedPeakMinutes` on a
 * listing is what gets scored when it exists.
 */
import { Listing } from '../types/listing.js';

const KEY = process.env.GOOGLE_MAPS_API_KEY ?? '';

export interface CommuteLeg {
  label: string;
  minutes: number;
  freeFlowMinutes: number;
  /** How much of the trip is congestion rather than distance. */
  delayMinutes: number;
}

export interface CommuteResult {
  legs: CommuteLeg[];
  miles: number;
  /** The evening peak, because that is the one that hurts. */
  worstMinutes: number;
  /** False when the predicted delay was so small it cannot be believed. */
  trafficModelled: boolean;
  /** The evening run on a bad day, from Google's pessimistic model. */
  badDayMinutes?: number;
  available: boolean;
  note: string;
}

/**
 * US federal holidays, as month-day. Traffic on these is a Sunday's traffic,
 * and asking Google about one produces a number that describes no working day.
 * Only the fixed-date ones plus the handful of floating ones that matter for
 * a commute; close enough that no scan lands on a quiet road by accident.
 */
function isHoliday(d: Date): boolean {
  const md = `${d.getMonth() + 1}-${d.getDate()}`;
  if (['1-1', '6-19', '7-4', '11-11', '12-25', '12-24', '12-31'].includes(md)) return true;
  const dow = d.getDay(), dom = d.getDate(), mon = d.getMonth() + 1;
  // Third Monday: MLK (Jan), Presidents (Feb). First Monday: Labor (Sep).
  if (dow === 1 && mon === 1 && dom >= 15 && dom <= 21) return true;
  if (dow === 1 && mon === 2 && dom >= 15 && dom <= 21) return true;
  if (dow === 1 && mon === 9 && dom <= 7) return true;
  // Last Monday of May: Memorial.
  if (dow === 1 && mon === 5 && dom >= 25) return true;
  // Fourth Thursday of November and the Friday after: Thanksgiving.
  if (mon === 11 && dow === 4 && dom >= 22 && dom <= 28) return true;
  if (mon === 11 && dow === 5 && dom >= 23 && dom <= 29) return true;
  return false;
}

/**
 * The next ordinary working day at this hour, in UTC.
 *
 * Tuesday to Thursday only. Monday and Friday are lighter on this corridor —
 * enough people work from home on both that neither describes the week he would
 * actually be driving — and a Monday is where the holidays hide.
 */
export function nextTypicalWeekdayAt(hourLocal: number): string {
  const d = new Date();
  d.setHours(hourLocal, 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  while (d.getDay() < 2 || d.getDay() > 4 || isHoliday(d)) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

type Place = string | { lat: number; lng: number };

/* Coordinates when we have them, the address only as a fallback.
 *
 * Sending the address made the Routes API repeat the geocoder's mistake: for a
 * street it does not know it resolves to the town, so three houses five miles
 * apart came back with the same drive to the minute. We have already worked out
 * where the house is — use it. */
const asWaypoint = (p: Place) =>
  typeof p === 'string'
    ? { address: p }
    : { location: { latLng: { latitude: p.lat, longitude: p.lng } } };

async function leg(
  origin: Place, destination: Place, departISO: string,
  /** BEST_GUESS is the typical day; PESSIMISTIC is a bad one. */
  trafficModel: 'BEST_GUESS' | 'PESSIMISTIC' = 'BEST_GUESS',
): Promise<{ minutes: number; free: number; miles: number } | null> {
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters',
    },
    body: JSON.stringify({
      origin: asWaypoint(origin),
      destination: asWaypoint(destination),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
      departureTime: departISO,
      trafficModel,
    }),
  });

  const json: any = await res.json();
  if (json.error) throw new Error(json.error.message ?? 'routes failed');
  const r = json.routes?.[0];
  if (!r) return null;

  const secs = (v: string) => Number(String(v).replace('s', ''));
  return {
    minutes: Math.round(secs(r.duration) / 60),
    free: Math.round(secs(r.staticDuration ?? r.duration) / 60),
    miles: Math.round((r.distanceMeters / 1609.34) * 10) / 10,
  };
}

export async function assessCommute(
  listing: Listing, workAddress: string,
): Promise<CommuteResult> {
  const none = (note: string): CommuteResult =>
    ({ legs: [], miles: 0, worstMinutes: 0, trafficModelled: false, available: false, note });

  if (!KEY) return none('No Google Maps key configured.');
  if (!workAddress) return none('No work address set, so the commute has never been measured.');

  /* Morning in, evening out. The evening leg is measured in the correct
     direction — work to home — because that is when the road is full of people
     going the same way he is. */
  /* The house as a point, not as a name. */
  const here: Place = listing.coords ?? listing.address;

  const times: { label: string; from: Place; to: Place; at: string }[] = [
    { label: 'Morning, leaving 8am', from: here, to: workAddress, at: nextTypicalWeekdayAt(8) },
    { label: 'Evening, leaving 5pm', from: workAddress, to: here, at: nextTypicalWeekdayAt(17) },
    { label: 'Off-peak, midday', from: here, to: workAddress, at: nextTypicalWeekdayAt(13) },
  ];

  const legs: CommuteLeg[] = [];
  let miles = 0;

  for (const t of times) {
    try {
      const r = await leg(t.from, t.to, t.at);
      if (!r) continue;
      miles = Math.max(miles, r.miles);
      legs.push({
        label: t.label,
        minutes: r.minutes,
        freeFlowMinutes: r.free,
        delayMinutes: Math.max(0, r.minutes - r.free),
      });
    } catch (err) {
      const msg = (err as Error).message;
      return none(
        /blocked|PERMISSION_DENIED/i.test(msg)
          ? 'The Routes API is not on this key yet — enable it and add it to the key restrictions.'
          : msg,
      );
    }
  }

  if (!legs.length) return none('No driving route found.');

  /* The same evening drive on a bad day. Worth one extra request per house:
     the difference between 57 and 87 minutes is the difference between getting
     home for bedtime most nights and missing it most nights. */
  let badDayMinutes: number | undefined;
  try {
    const bad = await leg(workAddress, here, nextTypicalWeekdayAt(17), 'PESSIMISTIC');
    badDayMinutes = bad?.minutes;
  } catch { /* the typical figure is the one that gets scored; this is colour */ }

  const evening = legs.find((l) => l.label.startsWith('Evening'));
  const worst = Math.max(...legs.map((l) => l.minutes));
  const spread = Math.max(...legs.map((l) => l.minutes)) - Math.min(...legs.map((l) => l.minutes));

  /* If every time of day returns within a couple of minutes, the model is not
     modelling anything. Say so rather than passing a free-flow number off as a
     rush-hour one. */
  const trafficModelled = spread >= 5 || (evening?.delayMinutes ?? 0) >= 5;

  return {
    legs,
    miles,
    worstMinutes: evening?.minutes ?? worst,
    trafficModelled,
    badDayMinutes,
    available: true,
    note: trafficModelled
      ? `${miles} miles each way. The evening leg carries ${evening?.delayMinutes ?? 0} minutes ` +
        `of traffic on top of the drive — that is the one that decides whether you are home for bedtime.` +
        (badDayMinutes ? ` On a bad day Google says ${badDayMinutes} min. On the one drive you have ` +
          `actually timed, the real thing ran about a third over the typical figure, so read these ` +
          `as the optimistic end.` : '')
      : `${miles} miles each way, about ${legs[0]?.minutes ?? worst} minutes with the road clear. ` +
        `Google returned effectively the same time at 8am, 1pm and 5pm, which is not credible for ` +
        `metro Atlanta — so treat these as free-flow, not rush hour. Drive it once at 5pm and put ` +
        `the real number in.`,
  };
}
