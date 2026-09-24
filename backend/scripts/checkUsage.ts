/**
 * What this has actually cost.
 *
 * AI Studio's dashboard shows free-tier usage only, so a working paid key can
 * read zero there while the app is busy. This counts calls locally.
 *
 * Prices are the published Gemini 3.5 Flash-Lite rates per million tokens.
 * Treat the figure as an estimate and check the billing console for the truth —
 * an estimate presented as a bill is exactly the kind of confident wrong answer
 * this project keeps removing.
 */
import 'dotenv/config';
import { summary } from '../src/services/usage.js';

const IN_PER_M = 0.10;
const OUT_PER_M = 0.40;

const s = await summary();
const cost = (t: { inTok: number; outTok: number }) =>
  (t.inTok / 1e6) * IN_PER_M + (t.outTok / 1e6) * OUT_PER_M;

const show = (label: string, t: any) => {
  console.log(`\n  ${label}`);
  console.log(`    calls          ${t.calls}${t.failed ? `  (${t.failed} failed)` : ''}`);
  console.log(`    input tokens   ${t.inTok.toLocaleString()}`);
  console.log(`    output tokens  ${t.outTok.toLocaleString()}`);
  console.log(`    est. cost      $${cost(t).toFixed(4)}`);
  for (const [k, v] of Object.entries(t.byPurpose)) console.log(`      ${String(k).padEnd(30)} ${v}`);
};

console.log(`\n  First call: ${s.firstCall ?? 'never'}`);
console.log(`  Last call:  ${s.lastCall ?? 'never'}`);
show('Last hour', s.lastHour);
show('Last 24 hours', s.last24h);
show('All time', s.total);
console.log('\n  Rates used: $0.10 per million input tokens, $0.40 per million output.');
console.log('  Check the real figure at console.cloud.google.com/billing -> Reports.\n');
