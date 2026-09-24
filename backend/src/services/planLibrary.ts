/**
 * The builder's own plan book.
 *
 * Pulte opens a community with four or five plans and reuses them everywhere —
 * the Continental, the Wingate, the Woodward, the Riverton. Every lot in three
 * counties is one of those drawings turned some direction. Read the drawing
 * once and you know something about every lot that carries it, including the
 * ones not yet listed.
 *
 * This is deliberately separate from the listing store. A plan is not a house:
 * it has no price, no address, no lot, and it exists whether or not anything is
 * for sale. What it has is a layout, and a layout plus a compass bearing is a
 * Vastu reading — so the useful output is not one score but seven, one for each
 * way the front door could point.
 *
 * That turns a shapeless question ("is new construction any good?") into a
 * specific one he can take to a sales office: "the Continental, but I want a
 * north-east lot."
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STORE_DIR, UPLOADS_DIR } from '../paths.js';
import { CardinalDirection, Orientation, Perception } from '../types/listing.js';
import { readVastu } from './vastu.js';
import { CHOICES } from './planFamilies.js';

const FILE = join(STORE_DIR, 'plan-library.json');

export interface LibraryPlan {
  id: string;
  builder: string;
  name: string;
  /** Community it was drawn for, when the viewer names one. */
  community?: string;
  sqft?: number;
  sourceUrl?: string;
  /** Saved plan images, main floor first. */
  images: string[];
  /** What the reader made of the drawing. */
  perception?: Perception;
  entranceEdge?: string;
  byFacing?: { direction: CardinalDirection; score: number }[];
  best?: { direction: CardinalDirection; score: number };
  addedAt: string;
}

async function load(): Promise<LibraryPlan[]> {
  try {
    return JSON.parse(await readFile(FILE, 'utf8')) as LibraryPlan[];
  } catch {
    return [];
  }
}

async function save(plans: LibraryPlan[]): Promise<void> {
  await mkdir(STORE_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(plans, null, 2));
}

export const allPlans = load;

const DEG: Record<string, number> = {
  North: 0, 'North-East': 45, East: 90, 'South-East': 135,
  South: 180, 'South-West': 225, West: 270, 'North-West': 315,
};

const asFacing = (d: CardinalDirection): Orientation => ({
  entranceDirection: d,
  bearingDeg: DEG[d]!,
  confidence: 'high',
  method: 'hypothetical — this plan turned to face ' + d,
});

/**
 * Score a drawing at every facing it is allowed to have.
 *
 * South is absent from CHOICES on purpose: it is his one hard rule, so a plan
 * that would be wonderful facing south is not an option, and offering it as one
 * would be offering him a house he has already refused.
 */
export function scoreAllFacings(p: Perception, childOptions: string[] = []) {
  const positions = (p.planPositions ?? {}) as Record<string, string>;

  /* Which room the child gets is his choice, not the builder's.
   *
   * These plans have three, four, sometimes five secondary bedrooms. Picking
   * one of them arbitrarily and calling it the child's room made the score an
   * accident of which room happened to be named "Bedroom 2" on the drawing —
   * and on a house nobody has bought yet, the rooms are not assigned. So every
   * secondary bedroom is tried and the best one counts, because that is the one
   * a buyer would actually put a child in once they knew.
   *
   * The other placements are fixed by the builder and stay fixed: the kitchen
   * is where the plumbing is, the primary suite is where the drawing says. */
  const candidates = childOptions.length ? childOptions : [positions.childBedroom ?? 'Unknown'];

  const byFacing = CHOICES.map((direction) => ({
    direction,
    score: Math.max(...candidates.map((childBedroom) =>
      readVastu(p, asFacing(direction), { ...positions, childBedroom }).score)),
  }));

  return { byFacing, best: [...byFacing].sort((a, b) => b.score - a.score)[0]! };
}

/** Save one plan image and return the filename the app serves it under. */
export async function savePlanImage(dataUrl: string, slug: string): Promise<string> {
  const m = dataUrl.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/);
  if (!m) throw new Error('Expected a PNG, JPEG or WebP data URL.');
  const buf = Buffer.from(m[3]!, 'base64');
  if (buf.byteLength > 12 * 1024 * 1024) throw new Error('That image is over 12 MB.');
  const name = `plan-${slug}-${randomUUID().slice(0, 6)}${m[2] === 'png' ? '.png' : '.jpg'}`;
  await mkdir(UPLOADS_DIR, { recursive: true });
  await writeFile(join(UPLOADS_DIR, name), buf);
  return name;
}

export async function addPlan(p: Omit<LibraryPlan, 'id' | 'addedAt'>): Promise<LibraryPlan> {
  const plans = await load();
  /* Same builder and name is the same plan — re-adding replaces rather than
     duplicating, so re-reading a drawing after a better capture is safe. */
  const existing = plans.findIndex(
    (x) => x.builder.toLowerCase() === p.builder.toLowerCase()
        && x.name.toLowerCase() === p.name.toLowerCase(),
  );
  const plan: LibraryPlan = {
    ...p,
    id: existing >= 0 ? plans[existing]!.id : randomUUID().slice(0, 8),
    addedAt: new Date().toISOString(),
  };
  if (existing >= 0) plans[existing] = plan; else plans.push(plan);
  await save(plans);
  return plan;
}

export async function removePlan(id: string): Promise<boolean> {
  const plans = await load();
  const left = plans.filter((p) => p.id !== id);
  if (left.length === plans.length) return false;
  await save(left);
  return true;
}
