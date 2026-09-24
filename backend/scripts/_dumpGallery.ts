/* Scratch: print the subject's gallery for a few listings, straight from the
   cached page. No fetch, no model call. Used to build a facade rating sheet. */
import { allListings } from '../src/services/listingStore.js';
import { galleryUrls } from '../src/services/planFinder.js';
import { hasCachedPage, fetchListingPage } from '../src/services/listingPage.js';

const wanted = process.argv.slice(2);
const run = async () => {
  const out: Record<string, string[]> = {};
  for (const l of await allListings()) {
    const short = l.address.split(',')[0]!;
    if (wanted.length && !wanted.some((w) => short.startsWith(w))) continue;
    const url = l.readableUrl ?? l.sourceUrl;
    if (!(await hasCachedPage(url))) { out[short] = []; continue; }
    out[short] = galleryUrls(await fetchListingPage(url));
  }
  console.log(JSON.stringify(out, null, 1));
};
run().catch((e) => { console.error(e); process.exit(1); });
