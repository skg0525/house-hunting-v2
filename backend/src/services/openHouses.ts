/**
 * When can I walk through it?
 *
 * It is in the page, on the photo — the "OPEN SUN, 1PM TO 4PM" badge Redfin
 * server-renders into the sash over the hero image. `parseOpenHouses` below
 * reads it, and it costs no request at all beyond the page we already cache.
 *
 * This comment used to say the opposite: that open houses were not in the HTML
 * and had to come from a separate `mainHouseInfoPanelInfo` request. That was
 * true of the first attempt and stopped being true when the sash was found, and
 * nobody updated the paragraph at the top of the file. It then cost an
 * estimate: an 88-house refresh was quoted at 176 requests on the strength of
 * this text rather than the code twelve lines below it, which says plainly
 * "No extra request". He caught it from memory of the badge.
 *
 * A stale comment reads exactly like a current one.
 *
 * Whether an open house is a good sign: mostly it is just convenient — you can
 * walk it this weekend without an agent or an appointment. The signal is in the
 * pattern rather than the event. A new listing holding one is normal marketing;
 * a house holding its fourth in its ninth week is telling you something, and
 * that something is in your favour.
 */
import { fetchListingPage } from './listingPage.js';

export interface OpenHouse {
  start: string;
  end: string;
  /**
   * Redfin's own badge did not describe a real open house.
   *
   * 6105 Clydesdale Ct and 2140 Vanig Dr both advertise "OPEN TODAY, 1AM TO
   * 4PM" — fifteen hours, starting at one in the morning. The parser read that
   * correctly; the source is malformed. Almost certainly the start is 1PM, but
   * "almost certainly" is not a time you drive to, and writing 1PM here would
   * be the tool inventing a fact it does not have.
   *
   * So the window is kept exactly as published and flagged. The card says the
   * time is wrong rather than printing 1 AM as though it meant it.
   */
  suspect?: boolean;
}

/** No open house starts before 8am or runs longer than eight hours. */
function looksWrong(o: OpenHouse): boolean {
  const start = new Date(o.start);
  const hours = (Date.parse(o.end) - Date.parse(o.start)) / 3_600_000;
  return start.getHours() < 8 || hours > 8;
}

export function upcomingOnly(list: OpenHouse[] | undefined): OpenHouse[] {
  const now = Date.now();
  return (list ?? [])
    .filter((o) => Date.parse(o.end) > now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export function describe(o: OpenHouse): string {
  const s = new Date(o.start);
  const e = new Date(o.end);
  const day = s.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((s.getTime() - Date.now()) / 86_400_000);
  const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  return `${day}, ${t(s)}–${t(e)} (${when})`;
}

/**
 * Redfin's own `openHouseInfo.openHouseList` API returns an empty array even
 * for houses that plainly have one — verified against a listing showing
 * "OPEN TODAY, 3PM TO 6PM" on its hero photo while the API said nothing.
 *
 * What is reliable is the badge on the subject property's photo, which is
 * server-rendered into a `home-sash-container` div. That container appears
 * exactly once per page and belongs to the house being viewed; the sixty-odd
 * other sashes on the page are cards for neighbouring homes and must not be
 * confused with it.
 *
 * The upside of getting this wrong first: this needs no extra request at all.
 * It reads the page we already have.
 */
export function parseOpenHouses(html: string): OpenHouse[] {
  const container = html.match(
    /<div class="home-sash-container[^"]*"[^>]*data-rf-test-id="sashContainer"[\s\S]{0,1200}?<\/div>/,
  )?.[0];
  if (!container) return [];

  const badges = [...container.matchAll(/OPEN\s+([A-Z]{3}[A-Z]*\.?\s*\d*|TODAY|TOMORROW)[,\s]+([\d:]+\s*[AP]M)\s+TO\s+([\d:]+\s*[AP]M)/gi)];
  return badges
    .map((m) => toOpenHouse(m[1]!, m[2]!, m[3]!))
    .filter((o): o is OpenHouse => o !== null)
    .map((o) => (looksWrong(o) ? { ...o, suspect: true } : o));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** "3PM" / "10:30AM" to hours since midnight. */
function hourOf(t: string): number | null {
  const m = t.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AP])M$/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3]!.toUpperCase() === 'P') h += 12;
  return h + Number(m[2] ?? 0) / 60;
}

/**
 * Turn a badge into real datetimes.
 *
 * Redfin writes these as "TODAY", a weekday, or a month and day, always in the
 * property's local time and always in the future. A weekday means the NEXT one
 * — a badge saying SUN on a Saturday means tomorrow, not six days ago.
 */
function toOpenHouse(whenRaw: string, fromRaw: string, toRaw: string): OpenHouse | null {
  const from = hourOf(fromRaw);
  const to = hourOf(toRaw);
  if (from === null || to === null) return null;

  const when = whenRaw.trim().toLowerCase().replace(/\./g, '');
  const d = new Date();
  d.setHours(0, 0, 0, 0);

  if (when === 'tomorrow') {
    d.setDate(d.getDate() + 1);
  } else if (when !== 'today') {
    const dayIdx = DAYS.indexOf(when.slice(0, 3));
    const monthIdx = MONTHS.indexOf(when.slice(0, 3));

    if (dayIdx >= 0 && !/\d/.test(when)) {
      // Next occurrence of that weekday, today included.
      const delta = (dayIdx - d.getDay() + 7) % 7;
      d.setDate(d.getDate() + delta);
    } else if (monthIdx >= 0) {
      const dayNum = Number(when.match(/(\d+)/)?.[1]);
      if (!Number.isFinite(dayNum)) return null;
      d.setMonth(monthIdx, dayNum);
      // A month already past means next year.
      if (d.getTime() < Date.now() - 86_400_000) d.setFullYear(d.getFullYear() + 1);
    } else {
      return null;
    }
  }

  const start = new Date(d);
  start.setHours(Math.floor(from), Math.round((from % 1) * 60), 0, 0);
  const end = new Date(d);
  end.setHours(Math.floor(to), Math.round((to % 1) * 60), 0, 0);

  return { start: start.toISOString(), end: end.toISOString() };
}

export async function fetchOpenHouses(listingUrl: string): Promise<OpenHouse[]> {
  /* No extra request: the badge is in the page, and the page is cached. */
  return upcomingOnly(parseOpenHouses(await fetchListingPage(listingUrl)));
}
