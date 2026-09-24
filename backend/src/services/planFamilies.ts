/**
 * The same drawing, on a different street.
 *
 * Builders open a community with four or five plans and reuse them across every
 * community they open. So the identical house turns up on a dozen lots facing a
 * dozen different ways — and the plan fixes only where the kitchen sits ON THE
 * PAGE. Which way the driveway points decides what that means on a compass.
 *
 * Two consequences worth acting on. The first is that a plan already read tells
 * you about every other lot carrying it, which is most of what makes new
 * construction hard to compare. The second is sharper: where the same plan sits
 * on two lots at similar money, one of them is simply turned the better way, and
 * that is a free choice nobody at the sales office will point out.
 *
 * Plans are matched on layout, not on name. Two houses from the same drawing
 * have the same rooms in the same places on the page, so the layout is its own
 * fingerprint — which avoids depending on a plan name that half these listings
 * never print.
 */
import { Listing, Perception, Orientation, CardinalDirection } from '../types/listing.js';
import { readVastu } from './vastu.js';

/** South is never an option, so it is not offered as one. */
export const CHOICES: CardinalDirection[] = [
  'North', 'North-East', 'East', 'South-East', 'South-West', 'West', 'North-West',
];

const DEG: Record<string, number> = {
  North: 0, 'North-East': 45, East: 90, 'South-East': 135,
  South: 180, 'South-West': 225, West: 270, 'North-West': 315,
};

const asFacing = (d: CardinalDirection): Orientation => ({
  entranceDirection: d,
  bearingDeg: DEG[d]!,
  confidence: 'high',
  method: 'hypothetical',
});

export interface FacingOption { direction: CardinalDirection; score: number }

export interface PlanRead {
  /** Layout fingerprint. Same string means same drawing. */
  key: string;
  byFacing: FacingOption[];
  best: FacingOption;
  /** What this house scores as it actually sits. */
  current?: number;
  /** Points left on the table by this lot's orientation. */
  forgone?: number;
}

/** Score one house's plan at every facing it could legally have. */
export function planRead(
  perception: Perception, orientation: Orientation, planRead_: boolean,
): PlanRead | null {
  if (!planRead_ || perception.entranceEdgeOnPlan === 'Unknown') return null;

  const positions = (perception.planPositions ?? {}) as Record<string, string>;
  const byFacing = CHOICES.map((direction) => ({
    direction,
    score: readVastu(perception, asFacing(direction), positions).score,
  }));

  const best = [...byFacing].sort((a, b) => b.score - a.score)[0]!;
  const here = orientation.entranceDirection;
  const current = byFacing.find((f) => f.direction === here)?.score;

  return {
    key: `${perception.entranceEdgeOnPlan}|` +
         CHOICES.map((d) => byFacing.find((f) => f.direction === d)!.score).join(','),
    byFacing,
    best,
    current,
    forgone: current === undefined ? undefined : best.score - current,
  };
}

export interface Sibling {
  id: string; address: string; price: number;
  facing: CardinalDirection | 'Unknown'; score: number; better: number;
}

/**
 * Other houses built from this same drawing, and how they are turned.
 *
 * Sorted by what they score rather than by what they cost, because the whole
 * point is that the cheaper one is sometimes the better-oriented one.
 */
export function siblingsOf(
  target: { id: string; plan: PlanRead },
  others: { listing: Listing; plan: PlanRead | null; facing: CardinalDirection | 'Unknown' }[],
): Sibling[] {
  return others
    .filter((o) => o.plan && o.listing.id !== target.id && o.plan.key === target.plan.key)
    .map((o) => ({
      id: o.listing.id,
      address: o.listing.address,
      price: o.listing.price,
      facing: o.facing,
      score: o.plan!.current ?? 0,
      better: (o.plan!.current ?? 0) - (target.plan.current ?? 0),
    }))
    .sort((a, b) => b.score - a.score);
}
