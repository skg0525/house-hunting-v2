/* Measure secondary bedrooms from the floor plans. One model call per house. */
import 'dotenv/config';
import { allListings, updateListing } from '../src/services/listingStore.js';
import { readBedrooms } from '../src/services/bedrooms.js';

const run = async () => {
  const ids = process.argv.slice(2);
  for (const l of await allListings()) {
    if (ids.length && !ids.includes(l.id)) continue;
    const short = l.address.split(',')[0]!.slice(0, 26).padEnd(26);
    try {
      const s = await readBedrooms(l);
      if (!s.rooms.length) { console.log(`${short} —`); continue; }
      await updateListing(l.id, { bedroomSizes: s });
      const ft = (n: number | null) => (n === null ? '?' : `${Math.floor(n)}'${Math.round((n % 1) * 12)}"`);
      console.log(`${short} ${s.realCount} real, smallest ${ft(s.smallestWallFt)}  [`
        + s.rooms.filter((r) => !r.isPrimary).map((r) => `${r.lengthFt}x${r.widthFt}`).join(' ') + ']');
    } catch (e) { console.log(`${short} ERR ${(e as Error).message.slice(0, 60)}`); }
  }
};
run().catch((e) => { console.error(e); process.exit(1); });
