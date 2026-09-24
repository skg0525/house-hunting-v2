/**
 * End-to-end check with no server and no model call.
 *
 * Exercises the parts that would be embarrassing to get wrong in front of a
 * house you actually want: does a pasted Redfin link yield an address, does the
 * store round-trip, and does a full assessment come out the other side reading
 * like something a person would act on.
 */
import { parsePastedUrls } from '../src/services/listingStore.js';
import { scoreProperty } from '../src/services/scoringEngine.js';
import { buildNarrative } from '../src/services/narrator.js';
import { defaultProfile } from '../src/types/preferences.js';
import type { Listing, Perception, Orientation } from '../src/types/listing.js';

console.log('\n=== 1. Reading pasted links ===\n');
const pasted = parsePastedUrls(`
  https://www.redfin.com/GA/Marietta/1234-Powers-Ferry-Rd-30067/home/12345678
  https://www.zillow.com/homedetails/887-Oakdale-Rd-NE-Atlanta-GA-30307/12345_zpid/
  https://www.redfin.com/GA/Alpharetta/55-Windward-Pkwy-30005/home/999
  not-a-link
  https://www.redfin.com/GA/Marietta/1234-Powers-Ferry-Rd-30067/home/12345678
`);
for (const p of pasted) {
  console.log(`  ${p.site.padEnd(7)} ${p.addressGuess ?? '(no address in the URL)'}`);
}
console.log(`\n  ${pasted.length} unique links (the repeat was dropped).`);

console.log('\n=== 2. A full assessment, start to finish ===\n');

const profile = defaultProfile('me');

const listing: Listing = {
  id: 'demo', sourceUrl: pasted[0]!.url,
  address: '1234 Powers Ferry Rd, Marietta, GA 30067',
  price: 785_000, beds: 4, baths: 3, sqft: 3100, lotSizeAcres: 0.31,
  yearBuilt: 2009, propertyType: 'Single Family', hoaMonthly: 0,
  images: {}, addedAt: new Date().toISOString(),
  neighborhood: { walkScore: 41, schoolRating: 9, diversityIndex: 0.68, southAsianPct: 11 },
};

const perception: Perception = {
  entranceEdgeOnPlan: 'Bottom',
  entranceEvidence: 'Covered porch and a labelled FOYER on the lower wall of the plan.',
  mainFloorFlexRoom: false,
  kitchenLengthFt: 27.4, kitchenWidthFt: 13.4, kitchenOpenToLiving: false,
  mainLivingLengthFt: 17.3, mainLivingWidthFt: 15.4, layoutStyle: 'Compartmentalized',
  hasPantry: true, pantryIsLaundry: false, kitchenIsThoroughfare: false, kitchenHasIsland: true,
  kitchenEvidence: 'Long narrow kitchen walled off from the living room; breakfast nook and sitting room each enclosed separately.',
  mainFloorBedroom: true, mainFloorFullBath: false,
  mainFloorSuiteEvidence: 'Main-floor guest room sits beside a room drawn with only a toilet and sink — a powder room, not a full bath.',
  houseVisibleInAerial: true, yardFenced: 'Yes', neighboursHaveFences: 'Most do', yardGrade: 'Gentle Slope', yardUsableSize: 'Generous', yardPrivacy: 'High',
  yardEvidence: 'Fence traceable along all three rear boundaries; mature trees screen the neighbours.',
  planPositions: { kitchen: 'South-East', primaryBedroom: 'South-West', childBedroom: 'West',
    livingRoom: 'North', masterBath: 'North-West', poojaSpace: 'Unknown' },
  backsOntoMajorRoad: false, backsOntoWater: false,
  waterEvidence: 'No water near the lot.',
  siteEvidence: 'Cul-de-sac, no multi-lane road touching the parcel.',
};

const orientation: Orientation = {
  entranceDirection: 'North-East', bearingDeg: 47,
  confidence: 'high',
  method: 'Front faces 47° (North-East), measured from the house to the nearest Street View camera 21 m away.',
};

const READ = { planRead: true, aerialRead: true };
const r = scoreProperty(listing, perception, READ, orientation, profile);
const n = buildNarrative(listing, perception, READ, orientation, r.dimensions, r.matchScore, r.ruledOut, profile);

console.log(`  Score: ${r.matchScore}/100${r.ruledOut ? '  RULED OUT' : ''}\n`);
console.log(`  ${n.summary}\n`);
if (r.concerns.length) {
  console.log('  Concerns:');
  for (const c of r.concerns) console.log(`    - ${c}`);
  console.log();
}
console.log('  Dimensions:');
for (const d of r.dimensions) {
  console.log(`    ${d.label.padEnd(28)} ${d.available ? String(d.score).padStart(3) : ' — '}  ×${d.weight.toFixed(2)}`);
}
console.log();
