/**
 * Does the ranking actually obey the two rules that matter?
 *
 * Not a test suite — a check you can run and read. It builds houses that differ
 * in exactly one thing and prints what the engine does with them, so a rule
 * quietly stopping working is visible rather than inferred.
 */
import { scoreProperty } from '../src/services/scoringEngine.js';
import { defaultProfile } from '../src/types/preferences.js';
import type { Listing, Perception, Orientation } from '../src/types/listing.js';

const profile = defaultProfile('me');

/** These checks are about judgement, so assume both images were read. */
const READ = { planRead: true, aerialRead: true };

const house: Listing = {
  id: 'h1', sourceUrl: 'https://redfin.com/x', address: '1 Test St, Atlanta, GA',
  price: 720_000, beds: 4, baths: 3, sqft: 2800, lotSizeAcres: 0.28,
  yearBuilt: 2012, propertyType: 'Single Family', hoaMonthly: 0,
  images: {}, addedAt: new Date().toISOString(),
  neighborhood: { walkScore: 62, schoolRating: 8, diversityIndex: 0.72, southAsianPct: 16 },
};

const perception: Perception = {
  entranceEdgeOnPlan: 'Bottom', entranceEvidence: 'Foyer on the lower wall.',
  mainFloorFlexRoom: true,
  kitchenLengthFt: 18, kitchenWidthFt: 14, kitchenOpenToLiving: true,
  mainLivingLengthFt: 20, mainLivingWidthFt: 17, layoutStyle: 'Open concept',
  hasPantry: true, pantryIsLaundry: false, kitchenIsThoroughfare: false, kitchenHasIsland: true,
  kitchenEvidence: 'Kitchen opens directly onto the great room with no dividing wall.',
  mainFloorBedroom: true, mainFloorFullBath: true,
  mainFloorSuiteEvidence: 'Guest suite with a tub off the hall.',
  houseVisibleInAerial: true, yardFenced: 'Yes', neighboursHaveFences: 'Most do', yardGrade: 'Flat', yardUsableSize: 'Generous', yardPrivacy: 'High',
  yardEvidence: 'Fence line traceable on all three rear sides.',
  planPositions: { kitchen: 'South-East', primaryBedroom: 'South-West', childBedroom: 'West',
    livingRoom: 'North', masterBath: 'North-West', poojaSpace: 'Unknown' },
  backsOntoMajorRoad: false, backsOntoWater: false,
  waterEvidence: 'No water near the lot.', siteEvidence: 'Quiet residential street.',
};

const facing = (dir: any, deg: number, confidence: any = 'high'): Orientation =>
  ({ entranceDirection: dir, bearingDeg: deg, confidence, method: `measured ${deg}°` });

function run(label: string, o: Orientation, p: Perception = perception, l: Listing = house) {
  const r = scoreProperty(l, p, READ, o, profile);
  console.log(
    `${label.padEnd(46)} ${String(r.matchScore).padStart(3)}/100  ` +
    (r.ruledOut ? `RULED OUT — ${r.ruledOut}` : (r.concerns[0] ?? '')),
  );
}

console.log('\nBaseline: same good house, different front door\n');
run('east-facing', facing('East', 90));
run('north-facing', facing('North', 0));
run('west-facing', facing('West', 270));
run('south-west-facing', facing('South-West', 225));
run('SOUTH-facing, measurement trusted', facing('South', 180));
run('SOUTH-facing, measurement shaky', facing('South', 180, 'low'));
run('south-east, 155° (near the line)', facing('South-East', 155));

/* The only rule that is law rather than preference. A perfect east-facing house
   in a 55+ community is still a house he cannot buy, so it has to beat every
   other reason a house might be out. */
console.log('\n55+, which no amount of east-facing fixes\n');
run('east-facing, 55+ community',
    facing('East', 90), perception,
    { ...house, ageRestricted: true, ageRestrictedEvidence: 'this intimate 55+ community' });
run('east-facing, not age restricted',
    facing('East', 90), perception, { ...house, ageRestricted: false });

console.log('\nThe fence, with everything else held identical\n');
run('fenced', facing('East', 90));
run('NOT fenced', facing('East', 90), { ...perception, yardFenced: 'No' });
run('fence unclear from the aerial', facing('East', 90), { ...perception, yardFenced: 'Unclear' });

console.log('\nThe trade-off you asked to see kept separate\n');
for (const [label, walk, size] of [
  ['big yard, unwalkable', 22, 'Generous'],
  ['small yard, very walkable', 88, 'Cramped'],
  ['balanced', 62, 'Adequate'],
] as const) {
  const l = { ...house, neighborhood: { ...house.neighborhood, walkScore: walk } };
  const p = { ...perception, yardUsableSize: size as any };
  const r = scoreProperty(l, p, READ, facing('East', 90), profile);
  const y = r.dimensions.find((d) => d.key === 'yard')!;
  const w = r.dimensions.find((d) => d.key === 'walkability')!;
  console.log(`${label.padEnd(28)} overall ${String(r.matchScore).padStart(3)}  yard ${String(y.score).padStart(3)}  walk ${String(w.score).padStart(3)}`);
}

console.log('\nMissing data must not quietly average toward the middle\n');
const bare = { ...house, neighborhood: undefined };
const r = scoreProperty(bare, perception, READ, facing('East', 90), profile);
console.log(`  no neighbourhood data: ${r.matchScore}/100`);
console.log(`  dimensions counted:    ${r.dimensions.filter((d) => d.available).map((d) => d.key).join(', ')}`);
console.log(`  left out:              ${r.dimensions.filter((d) => !d.available).map((d) => d.key).join(', ')}`);

console.log('\nYour word on one house outranks the arithmetic\n');
profile.propertyFeedback['h1'] = 'rejected';
run('great house you said no to', facing('East', 90));
console.log();
