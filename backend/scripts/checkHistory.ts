/** Read the published price story for any listing URL. */
import 'dotenv/config';
import { fetchPriceHistory } from '../src/services/priceHistory.js';

const urls = process.argv.slice(2);
for (const u of urls) {
  const h = await fetchPriceHistory(u).catch((e) => { console.log('  error:', e.message); return null; });
  console.log(`\n  ${u.split('/').slice(-3, -2)[0]}`);
  if (!h) { console.log('    no history'); continue; }
  console.log(`    ${h.summary}`);
  for (const e of h.events) {
    const p = e.price ? `$${e.price.toLocaleString()}` : '—';
    console.log(`      ${e.date}  ${e.event.padEnd(16)} ${p.padStart(12)}`);
  }
}
