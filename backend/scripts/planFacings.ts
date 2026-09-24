/**
 * Which way should this house be turned?
 *
 * Builders reuse four or five plans across every community they open, so the
 * same drawing turns up on a dozen lots facing a dozen different ways. The plan
 * fixes where the kitchen sits ON THE PAGE; the lot decides what that means on
 * a compass. Same house, two streets apart, can be a good Vastu answer or a
 * poor one purely because of which way the driveway points.
 *
 * That is a question worth asking before driving anywhere, and it is free — the
 * page positions are already read and stored, so this is arithmetic over data
 * we hold. For every house with a legible plan it scores all eight facings and
 * says which ones work.
 *
 *   npm --prefix backend run check:facings
 */
import { readVastu } from '../src/services/vastu.js';
import type { Orientation, CardinalDirection, Perception } from '../src/types/listing.js';

const API = process.env.API ?? 'http://localhost:8787';
const DIRS: CardinalDirection[] = [
  'North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West',
];
const DEG: Record<string, number> = {
  North: 0, 'North-East': 45, East: 90, 'South-East': 135,
  South: 180, 'South-West': 225, West: 270, 'North-West': 315,
};

const facing = (d: CardinalDirection): Orientation => ({
  entranceDirection: d,
  bearingDeg: DEG[d]!,
  confidence: 'high',
  method: 'hypothetical',
});

async function main() {
  const res = await fetch(`${API}/api/listings`);
  const body = await res.json() as any;
  const listings = Array.isArray(body) ? body : body.listings;

  const rows: {
    addr: string; price: number; actual: string; scores: Record<string, number>;
    best: string[]; worst: string[]; now: number;
  }[] = [];

  for (const l of listings) {
    const a = await (await fetch(`${API}/api/listings/${l.id}/assessment`)).json() as any;
    const p: Perception = a.perception;
    if (!a.evidence?.planRead || p.entranceEdgeOnPlan === 'Unknown') continue;

    const positions = (p.planPositions ?? {}) as Record<string, string>;
    const scores: Record<string, number> = {};
    for (const d of DIRS) scores[d] = readVastu(p, facing(d), positions).score;

    /* South is his one hard rule, so it is never an option however it scores. */
    const options = DIRS.filter((d) => d !== 'South');
    const ranked = [...options].sort((x, y) => scores[y]! - scores[x]!);
    const top = scores[ranked[0]!]!;

    rows.push({
      addr: String(l.address).split(',')[0]!,
      price: l.price,
      actual: a.orientation?.entranceDirection ?? 'Unknown',
      scores,
      best: ranked.filter((d) => scores[d]! >= top - 4),
      worst: ranked.slice(-2).reverse(),
      now: scores[a.orientation?.entranceDirection] ?? 0,
    });
  }

  rows.sort((x, y) => y.now - x.now);

  console.log(`\n  ${rows.length} houses with a legible plan.\n`);
  console.log('  Vastu score if the same house faced each way. South is excluded — it is out whatever it scores.\n');
  const head = DIRS.filter((d) => d !== 'South').map((d) => d.replace('North', 'N').replace('East', 'E')
    .replace('South', 'S').replace('West', 'W').replace('-', '').padStart(4)).join('');
  console.log(`  ${'address'.padEnd(26)}${'now'.padStart(5)}${head}   best facing`);

  for (const r of rows) {
    const cells = DIRS.filter((d) => d !== 'South')
      .map((d) => {
        const v = String(r.scores[d]).padStart(4);
        return d === r.actual ? `\x1b[1m${v}\x1b[0m` : v;
      }).join('');
    console.log(
      `  ${r.addr.slice(0, 25).padEnd(26)}${String(r.now).padStart(5)}${cells}   ` +
      `${r.best.join(', ')}`,
    );
  }

  console.log('\n  The bold column is the way this house actually faces.');

  /* ----------------------- plans, grouped ----------------------- */

  /* Builders reuse a handful of plans, and two houses built from the same
     drawing have the same rooms in the same places on the page. So the layout
     itself is the fingerprint — no need to scrape a plan name off a listing
     that may not carry one. Where two houses share a fingerprint they share a
     plan, and everything learned about one applies to the other. */
  const families = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = DIRS.filter((d) => d !== 'South').map((d) => r.scores[d]).join('|');
    families.set(key, [...(families.get(key) ?? []), r]);
  }

  const repeated = [...families.values()].filter((g) => g.length > 1)
    .sort((a, b) => b.length - a.length);

  if (repeated.length) {
    console.log(`\n  ${repeated.length} plans appear on more than one lot. Same drawing, different streets:\n`);
    for (const g of repeated) {
      const best = g[0]!.best.join(', ');
      console.log(`  A plan on ${g.length} lots — best facing ${best}`);
      for (const h of g.sort((a, b) => b.now - a.now)) {
        const gap = h.scores[h.best[0]!]! - h.now;
        console.log(
          `      ${String(h.now).padStart(3)}  ${h.addr.padEnd(26)}` +
          `$${String(Math.round(h.price / 1000)).padStart(4)}k  faces ${h.actual}` +
          (gap > 4 ? `  — ${gap} points below the same plan turned ${h.best[0]}` : '  — best orientation available'),
        );
      }
      console.log('');
    }
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
