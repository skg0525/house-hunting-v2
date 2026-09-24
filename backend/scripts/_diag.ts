import { allListings } from '../src/services/listingStore.js';
import { hasCachedPage, fetchListingPage } from '../src/services/listingPage.js';
import { readSystems } from '../src/services/listingFacts.js';
const ls = await allListings();
let cached = 0, withAbout = 0, mentions = 0, extracted = 0;
const examples: string[] = [];
for (const l of ls) {
  const u = l.readableUrl ?? l.sourceUrl;
  if (!(await hasCachedPage(u).catch(() => false))) continue;
  cached++;
  const html = await fetchListingPage(u).catch(() => null);
  if (!html) continue;
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const about = text.match(/About this home\s*(.{80,2200}?)(?:Show more|Listed by|Property details)/i)?.[1] ?? '';
  if (about) withAbout++;
  if (/\b(roof|hvac|water heater|furnace)\b/i.test(about)) {
    mentions++;
    const sys = readSystems(about);
    if (Object.keys(sys).length) extracted++;
    else if (examples.length < 6) {
      const m = about.match(/[^.]{0,80}\b(roof|hvac|water heater|furnace)\b[^.]{0,80}/i);
      examples.push(`${l.address.slice(0, 26)} :: ${m?.[0]?.trim().slice(0, 120)}`);
    }
  }
}
console.log(`cached pages ${cached} | with an About section ${withAbout} | mentioning a system ${mentions} | years extracted ${extracted}`);
console.log('\nmentions a system but no year found:');
examples.forEach((e) => console.log('  ', e));
