/**
 * Which GA-400 exit a house hangs off.
 *
 * He navigates by exit number, not by postcode — "I know places up to exit 10,
 * a bit of 11 because I work there, nothing beyond." That is a real mental map
 * and the app was making him translate every address into it by hand.
 *
 * Straight-line nearest, which is an approximation and occasionally the wrong
 * answer for a house that would actually be reached from the next exit up. The
 * distance is carried alongside for that reason: two kilometres from exit 13
 * means exit 13, and ten kilometres from exit 13 means the exit is not really
 * the point — the house is well off the corridor, which is itself the useful
 * thing to know.
 *
 * Coordinates are the interchanges themselves. Checked against two he named:
 * 4710 Tovero Pass comes out at exit 13, and 2815 Pilgrim Mill Rd at exit 16,
 * which is the Pilgrim Mill Road exit.
 */
const EXITS: Record<number, { lat: number; lng: number; name: string }> = {
  7:  { lat: 34.0245, lng: -84.3213, name: 'Holcomb Bridge Rd' },
  8:  { lat: 34.0430, lng: -84.3080, name: 'Mansell Rd' },
  9:  { lat: 34.0655, lng: -84.2935, name: 'Haynes Bridge Rd' },
  10: { lat: 34.0745, lng: -84.2845, name: 'Old Milton Pkwy' },
  11: { lat: 34.1010, lng: -84.2670, name: 'Windward Pkwy' },
  12: { lat: 34.1355, lng: -84.2360, name: 'McFarland Pkwy' },
  13: { lat: 34.1780, lng: -84.1690, name: 'Peachtree Pkwy' },
  14: { lat: 34.2020, lng: -84.1400, name: 'GA-20 Cumming Hwy' },
  15: { lat: 34.2210, lng: -84.1090, name: 'Bald Ridge Marina Rd' },
  16: { lat: 34.2340, lng: -84.0930, name: 'Pilgrim Mill Rd' },
  17: { lat: 34.2660, lng: -84.0640, name: 'Keith Bridge Rd' },
  18: { lat: 34.2900, lng: -84.0480, name: 'Coal Mountain' },
};

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, r = (d: number) => (d * Math.PI) / 180;
  const dp = r(b.lat - a.lat), dl = r(b.lng - a.lng);
  const x = Math.sin(dp / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export interface NearestExit { number: number; name: string; miles: number }

export function nearestExit(coords?: { lat: number; lng: number }): NearestExit | undefined {
  if (!coords) return undefined;
  let best: NearestExit | undefined;
  for (const [n, e] of Object.entries(EXITS)) {
    const miles = km(coords, e) / 1.60934;
    if (!best || miles < best.miles) best = { number: Number(n), name: e.name, miles: Math.round(miles * 10) / 10 };
  }
  /* Past about eight miles the nearest interchange stops describing the house —
     it is simply off the corridor, and saying "exit 13" would mislead. */
  return best && best.miles <= 8 ? best : best ? { ...best, number: 0, name: `well off GA-400, nearest is exit ${best.number}` } : undefined;
}
