/** What open houses are scheduled for these listings. */
import 'dotenv/config';
import { fetchOpenHouses, describe } from '../src/services/openHouses.js';

for (const url of process.argv.slice(2)) {
  const oh = await fetchOpenHouses(url).catch((e) => { console.log('  ', e.message); return []; });
  console.log(`  ${url.split('/').slice(-3, -2)[0]}: ${oh.length ? '' : 'none scheduled'}`);
  for (const o of oh) console.log(`      ${describe(o)}`);
}
