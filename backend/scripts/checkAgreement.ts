/**
 * Does the app contradict itself?
 *
 * Every bug worth finding this month has been the same shape: two parts of the
 * tool holding different answers to one question, each perfectly confident.
 * The detail page said "OPEN TODAY, 3PM TO 5PM" while the list showed nothing.
 * A house was 55+ in its description and unrestricted in its fields. A bearing
 * was ruled out by one rule and called reliable by the guard meant to stop it.
 *
 * None of these are caught by asking "is this value right?", because both
 * values look right on their own. They are only caught by asking "do these two
 * agree?" — so that is the question this asks, once per pair, out loud.
 *
 * It prints. It does not assert. Read the output.
 */
import { allListings } from '../src/services/listingStore.js';
import { readAgeRestriction } from '../src/services/listingFacts.js';

type Row = { address: string; problem: string };

const run = async () => {
  const listings = await allListings();
  const found: Row[] = [];
  const note = (address: string, problem: string) => found.push({ address: address.split(',')[0]!, problem });

  for (const l of listings) {
    const openSash = (l.sashes ?? []).filter((s) => /^OPEN/i.test(s));
    const parsed = l.openHouses ?? [];

    /* The one that started this. */
    if (openSash.length && !parsed.length)
      note(l.address, `badge says "${openSash[0]}" but no open house is parsed`);
    if (!openSash.length && parsed.length)
      note(l.address, 'an open house is parsed but the photo carries no badge');

    /* An open house that cannot be real. Kept, flagged, never silently shown. */
    for (const o of parsed) {
      const hours = (Date.parse(o.end) - Date.parse(o.start)) / 3_600_000;
      if ((new Date(o.start).getHours() < 8 || hours > 8) && !o.suspect)
        note(l.address, `${hours.toFixed(1)}h open house starting ${new Date(o.start).getHours()}:00, not flagged suspect`);
    }

    /* 55+ is stored as a field and stated in prose. They must not diverge. */
    const said = readAgeRestriction(l.description ?? '');
    if (said.restricted && !l.ageRestricted)
      note(l.address, 'the description says 55+ but the field does not');
    if (l.ageRestricted && l.description && !said.restricted)
      note(l.address, 'marked 55+ but its description no longer says so');

    /* A toured house with no note, or a note about touring with no date. */
    if (/\btoured\b/i.test(l.myNotes ?? '') && !l.touredAt)
      note(l.address, 'the notes say toured but touredAt is unset');

    /* A price that contradicts its own history. */
    if (l.priceHistory?.soldPrice && l.status === 'for sale')
      note(l.address, 'has a sold price but is still listed for sale');

    /* The asking price and the story told about the asking price.
       4440 Sanderling St carried price $665,000 with a history whose latest
       event was "Price Changed 685000" and a summary sentence saying "now
       asking $685,000" — one cut recorded where two had happened, and a
       narrative quoting a number the house no longer asks. Price refreshes on
       its own; the history it is narrated from does not. */
    /* Not "the latest event differs from the price" — builders move a price
       without recording an event, and that fired on forty houses that were
       fine. The two below are wrong every time they fire. */
    if (l.price && l.priceHistory?.firstListPrice
        && l.price < l.priceHistory.firstListPrice && !l.priceHistory.cutCount)
      note(l.address, `asking $${l.price.toLocaleString()} below its $${l.priceHistory.firstListPrice.toLocaleString()} opening, but cutCount is 0`);
    if (l.price && l.priceHistory?.summary?.match(/\$([\d,]+)/)) {
      const quoted = Number(l.priceHistory.summary.match(/now asking \$([\d,]+)/)?.[1]?.replace(/,/g, ''));
      if (quoted && quoted !== l.price)
        note(l.address, `summary says "now asking $${quoted.toLocaleString()}" but the price is $${l.price.toLocaleString()}`);
    }
  }

  console.log(`\n${listings.length} listings checked for self-contradiction\n`);
  if (!found.length) { console.log('  Nothing disagrees.\n'); return; }
  for (const f of found) console.log(`  ${f.address.padEnd(28)} ${f.problem}`);
  console.log(`\n  ${found.length} disagreement${found.length === 1 ? '' : 's'}.\n`);
};

run().catch((e) => { console.error(e); process.exit(1); });
