/**
 * What the house has already been through.
 *
 * The single most useful thing in a negotiation, and it is published on every
 * listing. A house listed at $1,299,900 that sold for $965,000 is not a
 * $1.3M house that got a discount — it was never a $1.3M house, and its price
 * history says so in the seller's own record.
 *
 * Two houses in one Toll Brothers community make the point:
 *
 *   5615 Willowdale Ct   listed $1,063,000  ->  sold $862,490   -18.9%
 *   5615 Willowbough Ln  listed $1,219,000  ->  sold $1,139,000  -6.6%
 *
 * Both true, both public, and neither visible from the asking price of the
 * house next door that is still for sale.
 *
 * Redfin loads this from an internal endpoint rather than the page HTML, and
 * prefixes the JSON with `{}&&` to break naive parsers. Both handled here.
 */
import { spend } from './rateBudget.js';
import { fetchListingPage } from './listingPage.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

export interface PriceEvent {
  date: string;
  event: string;
  price?: number;
}

export interface PriceStory {
  events: PriceEvent[];
  firstListPrice?: number;
  currentOrSoldPrice?: number;
  soldPrice?: number;
  /** Percent below the first asking price. Positive means it came down. */
  cutFromFirstPct?: number;
  cutCount: number;
  daysSinceFirstListed?: number;
  summary: string;
}

/** The property id is the last path segment of a Redfin listing URL. */
export function propertyIdFrom(url: string): string | null {
  return url.match(/\/home\/(\d+)/)?.[1] ?? null;
}

export async function fetchPriceHistory(listingUrl: string): Promise<PriceStory | null> {
  const id = propertyIdFrom(listingUrl);
  if (!id) return null;

  /* Load the listing page first. It is cached, and hitting the internal API
     without ever having loaded the page it belongs to is both rude and the
     fastest way to get refused. */
  await fetchListingPage(listingUrl).catch(() => null);

  const api =
    `https://www.redfin.com/stingray/api/home/details/belowTheFold` +
    `?propertyId=${id}&accessLevel=1&listingId=&pageType=1`;

  spend();
  const res = await fetch(api, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      Referer: listingUrl,
      ...(process.env.REDFIN_COOKIE ? { Cookie: process.env.REDFIN_COOKIE } : {}),
    },
  });
  if (!res.ok) return null;

  const raw = await res.text();
  const guard = raw.indexOf('&&');
  if (guard === -1) return null;

  let payload: any;
  try {
    payload = JSON.parse(raw.slice(guard + 2))?.payload;
  } catch {
    return null;
  }

  const rawEvents: any[] = payload?.propertyHistoryInfo?.events ?? [];
  if (!rawEvents.length) return null;

  /* Redfin publishes the same event twice — once from the MLS feed and once
     from public records, days apart. Deduplicated on description and price so a
     single price cut does not read as two. */
  const seen = new Set<string>();
  const events: PriceEvent[] = [];
  for (const e of rawEvents) {
    const date = e.eventDate ? new Date(e.eventDate).toISOString().slice(0, 10) : '';
    const event = String(e.eventDescription ?? '').replace(/\s*\(MLS\)\s*/i, '').trim();
    const price = typeof e.price === 'number' && e.price > 0 ? e.price : undefined;

    /* Rental history is a different market and must not be counted.
       One house had been listed for rent at $4,200 while it sat unsold, and
       folding those events in produced "9 separate price cuts" on a house that
       had cut its sale price three times. */
    if (/rent/i.test(event)) continue;
    if (price !== undefined && price < 20_000) continue;

    /* Redfin publishes the same event twice, from the MLS feed and from public
       records, days apart and sometimes a few dollars apart. Deduplicated on
       description plus month so one cut does not read as two. */
    const key = `${event}|${price ?? ''}|${date.slice(0, 7)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({ date, event, price });
  }
  events.sort((a, b) => (a.date < b.date ? 1 : -1));

  /* Only this listing cycle counts.
   *
   * A house listed in 1998, sold, and listed again today is not a house that
   * has cut its price by 78% — but comparing today's ask to a 1998 sale says
   * exactly that, and one such record dragged a neighbourhood's average cut to
   * 28.9%. The current cycle starts after the most recent completed sale, or
   * three years back, whichever is later. */
  const soldIdx = events.findIndex((e) => /sold/i.test(e.event));
  const threeYearsAgo = new Date(Date.now() - 3 * 365 * 86_400_000).toISOString().slice(0, 10);

  /* If the most recent event IS the sale, the cycle is the run leading up to
     it. Otherwise the cycle is everything after the last sale. */
  const cycle = soldIdx === 0
    ? events.filter((e) => e.date >= threeYearsAgo)
    : events.slice(0, soldIdx === -1 ? events.length : soldIdx)
            .filter((e) => e.date >= threeYearsAgo);

  const priced = cycle.filter((e) => e.price);
  const listings = priced.filter((e) => /list/i.test(e.event));
  const sold = priced.find((e) => /sold/i.test(e.event));

  const firstListPrice = listings.length ? listings[listings.length - 1]!.price : undefined;
  const currentOrSoldPrice = sold?.price ?? priced[0]?.price;

  const cutFromFirstPct =
    firstListPrice && currentOrSoldPrice && firstListPrice > currentOrSoldPrice
      ? ((firstListPrice - currentOrSoldPrice) / firstListPrice) * 100
      : undefined;

  const cutCount = cycle.filter((e) => /price changed|price reduced/i.test(e.event)).length;

  const firstListed = listings.length ? listings[listings.length - 1]!.date : undefined;
  const daysSinceFirstListed = firstListed
    ? Math.round((Date.now() - Date.parse(firstListed)) / 86_400_000)
    : undefined;

  const money = (n: number) => `$${n.toLocaleString()}`;
  const parts: string[] = [];

  if (firstListPrice && currentOrSoldPrice && cutFromFirstPct) {
    parts.push(
      `First asked ${money(firstListPrice)}, ${sold ? 'sold for' : 'now asking'} ${money(currentOrSoldPrice)} — ` +
      `${cutFromFirstPct.toFixed(1)}% below where it started`,
    );
  }
  if (cutCount >= 2) parts.push(`${cutCount} separate price cuts`);
  else if (cutCount === 1) parts.push('one price cut so far');
  if (daysSinceFirstListed && daysSinceFirstListed > 120 && !sold)
    parts.push(`on and off the market for ${Math.round(daysSinceFirstListed / 30)} months`);

  return {
    events,
    firstListPrice,
    currentOrSoldPrice,
    soldPrice: sold?.price,
    cutFromFirstPct,
    cutCount,
    daysSinceFirstListed,
    summary: parts.length ? parts.join('; ') + '.' : 'No price changes recorded.',
  };
}
