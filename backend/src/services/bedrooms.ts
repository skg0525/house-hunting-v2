/**
 * How big the bedrooms actually are.
 *
 * This is the measurement that decides his houses, and until tonight the app
 * did not take it. `secondaryBedrooms` in the perception holds COMPASS
 * DIRECTIONS for the Vastu reading — it has never held a size.
 *
 * Read off the plans by hand, the separation is total:
 *
 *   6035 Ashborough Park   14x14, 13x16, 14x13, 14x14   min wall 13'0"   both rank #1
 *   6410 Hawkins Mnr Dr    14'2, 13'5, 16'0, 13'7        min wall 13'5"   wow
 *   5045 Reserve Dr        14'2x11'10, 14'2x11'9         min wall 11'9"   wow
 *   6130 Bentley Commons   14'9x14'8, 9'10x11'1          min wall 9'10"   rejected
 *   1510 Heritage Dr       13'11x10'3, 10'1x13'6         min wall 10'1"   rejected
 *
 * So the number that matters is the NARROW WALL of the smallest secondary
 * bedroom, and the line sits between 10'3" and 11'9".
 *
 * Why the narrow wall and not the area: 1510 Heritage's rooms are 143 and 136
 * sq ft, which sounds survivable, and they are not — they are ten feet wide
 * with two doors opening inward, so a queen bed leaves no floor. Area hides
 * that. The short wall does not.
 *
 * The primary is excluded on purpose. Every house has a big primary; none of
 * his complaints were ever about it.
 */
import { Type } from '@google/genai';
import type { Listing } from '../types/listing.js';
import { callWithFallback, loadImage } from './geminiEvaluator.js';

export interface BedroomRead {
  label: string;
  lengthFt: number;
  widthFt: number;
  isPrimary: boolean;
  onMainFloor: boolean;
}

export interface BedroomSummary {
  rooms: BedroomRead[];
  /** Secondary bedrooms whose short wall clears the bar. */
  realCount: number;
  /** Short wall of the smallest secondary bedroom, in feet. */
  smallestWallFt: number | null;
  note: string;
}

/** His line, from the five houses he has judged. */
export const MIN_WALL_FT = 11.0;

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    rooms: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          lengthFt: { type: Type.NUMBER },
          widthFt: { type: Type.NUMBER },
          isPrimary: { type: Type.BOOLEAN },
          onMainFloor: { type: Type.BOOLEAN },
        },
        required: ['label', 'lengthFt', 'widthFt', 'isPrimary', 'onMainFloor'],
      },
    },
  },
  required: ['rooms'],
} as const;

const PROMPT = `
These images are floor plans for ONE house, numbered. Image 1 is usually the
storey with the front door, but do not assume it — read the sheet titles.

List EVERY room whose printed label is a bedroom: "Bedroom", "Bedroom 2",
"Primary Bedroom", "Owner's Suite", "Master", "Guest Bedroom".

For each, give the two printed dimensions in DECIMAL FEET. 13'6" is 13.5.
14' x 14' is 14 and 14. Use the numbers printed on the plan; do not estimate
from the drawing. If a room's dimensions are not printed, leave it out.

isPrimary: true only for the one labelled Primary, Owner's, Master or Main
Suite. A big bedroom that is not labelled that way is NOT the primary.

onMainFloor: true if it sits on the storey with the front door / foyer / entry.

DO NOT include: bonus rooms, lofts, offices, flex rooms, dens, game rooms,
media rooms, sitting rooms, or any room over the garage — even when a listing
counts them as bedrooms. He walked into one of those at 6130 Bentley Commons Dr
expecting a bedroom and found a playroom, and that is exactly the distinction
this is for. If a room is labelled both ways ("Bedroom / Bonus"), leave it out.
`.trim();

export async function readBedrooms(listing: Listing): Promise<BedroomSummary> {
  const srcs = [listing.images?.floorPlan, ...(listing.images?.floorPlanExtra ?? [])]
    .filter((s): s is string => Boolean(s));
  const imgs = (await Promise.all(srcs.map((s) => loadImage(s)))).filter((i) => i !== null);
  if (!imgs.length) return { rooms: [], realCount: 0, smallestWallFt: null, note: 'No floor plan to read.' };

  const parts: unknown[] = [{ text: PROMPT }];
  imgs.forEach((img, i) => parts.push({ text: `FLOOR PLAN ${i + 1} of ${imgs.length}:` }, { inlineData: img! }));

  const { text } = await callWithFallback(
    (model) => ({
      model,
      contents: [{ role: 'user', parts: parts as never }],
      config: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA as never },
    }),
    { purpose: 'measure the bedrooms', images: imgs.length, rounds: 2 },
  );

  const rooms: BedroomRead[] = (JSON.parse(text).rooms ?? [])
    .filter((r: BedroomRead) => r.lengthFt > 4 && r.widthFt > 4);
  return summarise(rooms);
}

export function summarise(rooms: BedroomRead[]): BedroomSummary {
  const secondary = rooms.filter((r) => !r.isPrimary);
  const walls = secondary.map((r) => Math.min(r.lengthFt, r.widthFt));
  const real = secondary.filter((r) => Math.min(r.lengthFt, r.widthFt) >= MIN_WALL_FT);
  const smallest = walls.length ? Math.min(...walls) : null;

  const ft = (n: number) => `${Math.floor(n)}'${Math.round((n % 1) * 12)}"`;
  const note = !secondary.length
    ? 'No secondary bedrooms with printed dimensions.'
    : `${secondary.length} secondary bedroom${secondary.length === 1 ? '' : 's'}, `
      + `${real.length} of them at least ${ft(MIN_WALL_FT)} on the short wall. `
      + `Smallest is ${ft(smallest!)} wide`
      + (smallest! < MIN_WALL_FT ? ' — a queen leaves no floor in that one.' : '.');

  return { rooms, realCount: real.length, smallestWallFt: smallest, note };
}
