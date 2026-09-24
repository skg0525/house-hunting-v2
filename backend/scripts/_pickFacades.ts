/* Pick the front-elevation photo for the houses named, and write it to
   images.exterior. One model call each. Prints what it chose. */
import 'dotenv/config';
import { allListings, updateListing } from '../src/services/listingStore.js';
import { galleryUrls } from '../src/services/planFinder.js';
import { hasCachedPage, fetchListingPage } from '../src/services/listingPage.js';
import { pickFrontElevation } from '../src/services/geminiEvaluator.js';

const wanted = process.argv.slice(2);
const run = async () => {
  for (const l of await allListings()) {
    const short = l.address.split(',')[0]!;
    if (wanted.length && !wanted.some((w) => short.startsWith(w))) continue;
    const url = l.readableUrl ?? l.sourceUrl;
    if (!(await hasCachedPage(url))) { console.log(`${short.padEnd(26)} no cached page`); continue; }
    const urls = galleryUrls(await fetchListingPage(url));
    if (!urls.length) { console.log(`${short.padEnd(26)} no gallery`); continue; }
    const i = await pickFrontElevation(urls).catch((e) => { console.log(short, 'ERR', e.message); return null; });
    if (i === null) { console.log(`${short.padEnd(26)} none of ${urls.length} shows the front`); continue; }
    await updateListing(l.id, { images: { ...l.images, exterior: urls[i], gallery: urls.slice(0, 6) } });
    console.log(`${short.padEnd(26)} photo ${i + 1} of ${urls.length}`);
  }
};
run().catch((e) => { console.error(e); process.exit(1); });
