/**
 * Does the compass maths actually work?
 *
 * A floor plan has no north arrow. What it has is a front door on one edge of
 * the page, and that door is measured — separately, from Street View — to point
 * some real direction. Those two facts rotate the whole drawing, and every room
 * position follows. If that rotation is wrong then every Vastu reading in the
 * app is wrong in the same direction and nobody would notice.
 *
 * So: hand-worked cases, checked against reasoning anyone can follow.
 *
 *   npm --prefix backend run check:vastu
 */
import { rotateToCompass, RULES } from '../src/services/vastu.js';
import type { CardinalDirection } from '../src/types/listing.js';

let bad = 0;
function expect(
  page: string, edge: string, facing: CardinalDirection, want: string, why: string,
) {
  const got = rotateToCompass(page, edge, facing);
  const ok = got === want;
  if (!ok) bad += 1;
  console.log(
    `  ${ok ? '✓' : '✗'} door on the ${edge.toLowerCase()} facing ${facing}: ` +
    `a room at page-${page.toLowerCase()} is ${got}${ok ? '' : `  — expected ${want}`}`,
  );
  console.log(`      ${why}`);
}

console.log('\n  ROTATION — front door on the bottom of the page\n');
expect('North', 'Bottom', 'East', 'West',
  'Door points east, so the street is east. The back of the house is west, and the back is the top of the page.');
expect('South', 'Bottom', 'East', 'East',
  'The door edge itself must come out as the way the house faces.');
expect('East', 'Bottom', 'East', 'North',
  'Page-right is 90 degrees clockwise from page-top; if the top is west, the right is north.');
expect('West', 'Bottom', 'East', 'South',
  'And page-left is the opposite of page-right.');

console.log('\n  ROTATION — the same plan turned to face north\n');
expect('North', 'Bottom', 'North', 'South',
  'Door points north, so the back of the house points south. The top of the page is the back.');
expect('South', 'Bottom', 'North', 'North', 'The door edge is north by definition.');

console.log('\n  ROTATION — door on other edges\n');
expect('South', 'Top', 'South', 'North',
  'Door on the top edge facing south: the bottom of the page is the back, which is north.');
expect('North', 'Top', 'South', 'South', 'The door edge is south by definition.');
expect('East', 'Right', 'East', 'East', 'Door on the right edge facing east: page-right IS east.');
expect('West', 'Right', 'East', 'West', 'And the opposite edge is west.');
expect('North', 'Left', 'North', 'East',
  'Door on the left edge facing north: rotate so page-left points north, and page-top swings to east.');

console.log('\n  DIAGONALS\n');
expect('North-East', 'Bottom', 'East', 'North-West',
  'Halfway between page-top (west) and page-right (north).');
expect('South', 'Bottom', 'North-East', 'North-East',
  'The door edge itself becomes the facing, on a diagonal too.');
expect('South-West', 'Bottom', 'North-East', 'East',
  'Page-south-west is 45 degrees clockwise from page-south, so it lands 45 clockwise from north-east.');
expect('North', 'Bottom', 'North-East', 'South-West',
  'And the far side of the house is the opposite of the way it faces.');

console.log(bad === 0
  ? '\n  All rotation cases correct.'
  : `\n  ${bad} CASE(S) WRONG — the compass maths is broken.`);

/* The rules, printed rather than asserted, because they are beliefs and he is
   the one who should check them against what their own family actually says. */
console.log('\n  THE RULES BEING APPLIED — check these against what you were taught\n');
for (const r of RULES) {
  console.log(`  ${r.element}  (${r.theme})`);
  console.log(`      best:  ${r.best.join(', ')}`);
  console.log(`      ok:    ${r.ok.join(', ') || '—'}`);
  console.log(`      worst: ${r.worst.join(', ')}`);
}
console.log('');
process.exit(bad === 0 ? 0 : 1);
