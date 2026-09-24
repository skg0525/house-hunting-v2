/* Drive time from arbitrary places to the office, for scouting an area before
   there are any listings in it. Two Routes calls per place. */
import 'dotenv/config';
import { assessCommute } from '../src/services/commute.js';
import { getProfile } from '../src/services/memoryManager.js';
import type { Listing } from '../src/types/listing.js';

const run = async () => {
  const profile = await getProfile('me');
  const work = profile.preferences.workAddress;
  for (const place of process.argv.slice(2)) {
    const fake = { id: 'probe', address: place } as unknown as Listing;
    const c = await assessCommute(fake, work);
    console.log(`${place.padEnd(46)} ${String(c.worstMinutes).padStart(3)} min bad day, `
      + `${c.miles} mi${c.trafficModelled ? '' : '  (no traffic model)'}`);
  }
};
run().catch((e) => { console.error(e); process.exit(1); });
