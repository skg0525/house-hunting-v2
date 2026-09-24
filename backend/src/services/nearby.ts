/**
 * What is actually within walking distance.
 *
 * A Walk Score is one number for a whole block and it cannot answer the
 * question this family is really asking, which is not "is this walkable" but
 * "can someone put a toddler in a stroller and get somewhere worth going".
 *
 * They live half a block from Piedmont Park, half a mile from the Botanical
 * Garden, a block from Colony Square and Arts Center station. That is the bar,
 * and it is a bar made of specific places rather than a score. So this lists
 * the specific places: parks and playgrounds first, then the everyday errands,
 * then transit — each with how far it actually is.
 *
 * Straight-line distance, not walking distance. It is honest about that: a park
 * 400 m away across a six-lane road is not a 400 m walk, which is exactly why
 * the road check on the aerial matters too.
 */
import { metresBetween } from './orientation.js';

const KEY = process.env.GOOGLE_MAPS_API_KEY ?? '';

export type NearbyCategory = 'Parks & playgrounds' | 'Everyday errands' | 'Food & coffee' | 'Transit';

export interface NearbyPlace {
  name: string;
  category: NearbyCategory;
  type: string;
  metres: number;
  /** Roughly how long to walk it, at an unhurried stroller pace. */
  walkMinutes: number;
}

/** Each search is one billed request, so the list is deliberately short. */
const SEARCHES: { types: string[]; category: NearbyCategory; radius: number }[] = [
  { types: ['park', 'playground'], category: 'Parks & playgrounds', radius: 2000 },
  { types: ['supermarket', 'grocery_store', 'pharmacy'], category: 'Everyday errands', radius: 2000 },
  { types: ['cafe', 'restaurant'], category: 'Food & coffee', radius: 1600 },
  { types: ['subway_station', 'train_station', 'bus_station'], category: 'Transit', radius: 2000 },
];

const PRETTY: Record<string, string> = {
  park: 'park', playground: 'playground', supermarket: 'supermarket',
  grocery_store: 'grocery', pharmacy: 'pharmacy', cafe: 'cafe',
  restaurant: 'restaurant', subway_station: 'rail', train_station: 'rail',
  bus_station: 'bus',
};

/* An adult walks about 1.4 m/s. With a stroller, on suburban pavement that
   stops and starts at driveways, 1.1 is closer to the truth. */
const STROLLER_PACE_MS = 1.1;

async function search(
  coords: { lat: number; lng: number },
  types: string[],
  radius: number,
): Promise<{ name: string; type: string; lat: number; lng: number }[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'places.displayName,places.primaryType,places.location',
    },
    body: JSON.stringify({
      includedTypes: types,
      maxResultCount: 6,
      rankPreference: 'DISTANCE',
      locationRestriction: { circle: { center: { latitude: coords.lat, longitude: coords.lng }, radius } },
    }),
  });

  const json: any = await res.json();
  if (json.error) throw new Error(`${json.error.status}: ${json.error.message}`);

  return (json.places ?? []).map((p: any) => ({
    name: p.displayName?.text ?? 'unnamed',
    type: p.primaryType ?? types[0]!,
    lat: p.location?.latitude,
    lng: p.location?.longitude,
  })).filter((p: any) => Number.isFinite(p.lat));
}

export interface NearbyResult {
  places: NearbyPlace[];
  /** Metres to the closest park or playground — the one the household asked about. */
  nearestParkMetres?: number;
  available: boolean;
  note: string;
}

export async function findNearby(coords: { lat: number; lng: number }): Promise<NearbyResult> {
  if (!KEY)
    return { places: [], available: false, note: 'No Google Maps key configured.' };

  const out: NearbyPlace[] = [];
  let failure = '';

  for (const s of SEARCHES) {
    try {
      const found = await search(coords, s.types, s.radius);
      for (const f of found) {
        const metres = Math.round(metresBetween(coords, { lat: f.lat, lng: f.lng }));
        out.push({
          name: f.name,
          category: s.category,
          type: PRETTY[f.type] ?? f.type.replace(/_/g, ' '),
          metres,
          walkMinutes: Math.max(1, Math.round(metres / STROLLER_PACE_MS / 60)),
        });
      }
    } catch (err) {
      failure = (err as Error).message;
    }
  }

  if (!out.length)
    return {
      places: [],
      available: false,
      note: failure.includes('PERMISSION_DENIED') || failure.includes('blocked')
        ? 'The Places API is not enabled on this key yet — enable "Places API (New)" and add it to the key restrictions.'
        : failure || 'Nothing found within walking distance.',
    };

  // Nearest first inside each category, and only the closest few of each.
  out.sort((a, b) => a.metres - b.metres);
  const perCategory = new Map<NearbyCategory, NearbyPlace[]>();
  for (const p of out) {
    const list = perCategory.get(p.category) ?? [];
    if (list.length < 3 && !list.some((x) => x.name === p.name)) list.push(p);
    perCategory.set(p.category, list);
  }

  const places = [...perCategory.values()].flat();
  const park = places.find((p) => p.category === 'Parks & playgrounds');

  return {
    places,
    nearestParkMetres: park?.metres,
    available: true,
    note: 'Straight-line distance, so a real walk is longer — and longer still if a ' +
          'big road sits between you and it.',
  };
}
