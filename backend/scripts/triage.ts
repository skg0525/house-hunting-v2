/**
 * Paste a wall of links, find out which are already out.
 *
 *   npm run triage -- links.txt
 *   pbpaste | npm run triage
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { triage } from '../src/services/triage.js';

const file = process.argv[2];
const text = file
  ? await readFile(file, 'utf8')
  : await new Promise<string>((r) => {
      let b = '';
      process.stdin.on('data', (c) => (b += c));
      process.stdin.on('end', () => r(b));
    });

process.stderr.write('  measuring…\n');
const s = await triage(text, (done, total) => {
  if (done % 10 === 0 || done === total) process.stderr.write(`  ${done}/${total}\n`);
});

const line = (r: (typeof s.results)[number]) =>
  `  ${r.facing.padEnd(11)} ${(r.bearingDeg !== null ? `${r.bearingDeg.toFixed(0)}°` : '').padStart(5)}  ` +
  `${r.confidence.padEnd(7)} ${r.address.split(',')[0]?.slice(0, 34)}`;

console.log(`\n  ${s.keep} worth keeping · ${s.checkYourself} need a look · ${s.out} out\n`);
if (s.out) {
  console.log('  OUT — south-facing:');
  for (const r of s.results.filter((r) => r.verdict === 'out')) console.log(line(r));
  console.log();
}
if (s.checkYourself) {
  console.log('  CHECK YOURSELF — could not measure, or measured badly:');
  for (const r of s.results.filter((r) => r.verdict === 'check yourself')) console.log(line(r));
  console.log();
}
console.log('  KEEPING:');
for (const r of s.results.filter((r) => r.verdict === 'keep')) console.log(line(r));
console.log(`\n  Paste the keepers into the app for the full read.\n`);
