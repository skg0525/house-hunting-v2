/** Read the market around any listing. */
import 'dotenv/config';
import { readMarket } from '../src/services/comps.js';
import { fetchFacts } from '../src/services/listingFacts.js';
import { geocode } from '../src/services/orientation.js';

const url = process.argv[2]!;
const addr = process.argv[3] ?? '';
const g = await geocode(addr || url);
if (!g) { console.log('  could not place that address'); process.exit(0); }
const f = await fetchFacts(url).catch(() => ({} as any));

const m = await readMarket(g.coords, { sqft: f.sqft ?? 0, price: f.price ?? 0, url });
console.log(`\n  ${addr || url}\n  ${m.summary}\n`);
console.log(`  ${'nearby'.padEnd(34)} ${'price'.padStart(11)} ${'$/sqft'.padStart(7)}  ${'status'.padEnd(12)} cut`);
for (const c of m.comps.slice(0, 10)) {
  const cut = c.cutPct ? `-${c.cutPct.toFixed(1)}%` : c.firstListPrice ? 'none' : '';
  console.log(`  ${c.address.slice(0, 33).padEnd(34)} ${('$' + c.price.toLocaleString()).padStart(11)} ${String(c.pricePerSqft).padStart(7)}  ${c.status.padEnd(12)} ${cut}`);
}
if (m.comingSoon.length) {
  console.log('\n  COMING SOON (not yet marketed):');
  for (const c of m.comingSoon) {
    console.log(`  ${c.address.slice(0, 33).padEnd(34)} ${('$' + c.price.toLocaleString()).padStart(11)} ${String(c.pricePerSqft).padStart(7)}  ${c.isNewConstruction ? 'new build' : ''}`);
  }
}
