/**
 * The badges on a listing's own photo.
 *
 * Redfin renders these into a `home-sash-container` div that appears exactly
 * once per page and belongs to the house being viewed. It carries whatever is
 * notable about the listing right now:
 *
 *   OPEN TODAY, 3PM TO 6PM     an open house, which their own API denies exists
 *   NEW 26 HRS AGO             listed yesterday
 *   NEW CONSTRUCTION           a builder, which changes how you negotiate
 *   PRICE DROP                 they have moved once already
 *   3D WALKTHROUGH             you can look inside without driving out
 *
 * All of it free: the page is already fetched and cached. Reading only the
 * OPEN badge and discarding the rest was leaving the cheapest signals here on
 * the floor.
 */

export interface Sashes {
  raw: string[];
  /** Hours since listing, when the badge says so. Fresh listings resist offers. */
  hoursOnMarket?: number;
  isNewConstruction: boolean;
  hasPriceDrop: boolean;
  has3dTour: boolean;
  isHot: boolean;
}

/** Pull the badge strings off the subject property's photo. */
export function parseSashes(html: string): string[] {
  const container = html.match(
    /<div class="home-sash-container[^"]*"[^>]*data-rf-test-id="sashContainer"[\s\S]{0,1500}?<\/div>/,
  )?.[0];
  if (!container) return [];

  return container
    .replace(/<[^>]+>/g, '|')
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 2 && s.length < 60);
}

export function readSashes(html: string): Sashes {
  const raw = parseSashes(html);
  const joined = raw.join(' ').toUpperCase();

  /* "NEW 26 HRS AGO" / "NEW 3 DAYS AGO" / "NEW 1 HR AGO". Days-on-market from
     the facts table rounds to whole days and reads 0 for both of those; hours
     is the difference between "list it today" and "they have had a weekend". */
  const hrs = joined.match(/NEW\s+(\d+)\s*HRS?\s+AGO/);
  const days = joined.match(/NEW\s+(\d+)\s*DAYS?\s+AGO/);
  const hoursOnMarket = hrs ? Number(hrs[1]) : days ? Number(days[1]) * 24 : undefined;

  return {
    raw,
    hoursOnMarket,
    isNewConstruction: /NEW CONSTRUCTION/.test(joined),
    hasPriceDrop: /PRICE (DROP|REDUCED|CUT)/.test(joined),
    has3dTour: /3D WALKTHROUGH|VIDEO TOUR/.test(joined),
    isHot: /HOT HOME/.test(joined),
  };
}
