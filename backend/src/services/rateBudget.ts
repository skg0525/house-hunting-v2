/**
 * A hard ceiling on how much we ask of a listing site.
 *
 * These requests carry a signed-in session cookie, which means they are
 * attributed to a real account belonging to a real person who needs that
 * account to buy a house. Getting it flagged would cost him far more than any
 * feature here is worth.
 *
 * The politeness gap in listingPage.ts was necessary and nowhere near
 * sufficient. A scan of 58 houses was quietly issuing about nine requests each
 * — the page, its price history, a map search, and then a price history lookup
 * for every one of six comparables — which is five hundred requests in one
 * sitting from one account. That is not a scraper being careful, it is a
 * scraper being slow.
 *
 * So there is now a budget, and when it runs out the answer is "not today"
 * rather than "one more".
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STORE_DIR } from '../paths.js';

interface Budget {
  perHour: number;
  perDay: number;
}

/* Deliberately conservative, and raised once on his instruction from four
   hundred to six hundred a day.
 *
 * Worth being clear about what this is: it is OUR limit, not the listing
 * site's. Nothing has ever been refused by Redfin. The number exists because
 * these requests carry his signed-in cookie and an account he needs to buy a
 * house with, and a scraper that looks like a scraper eventually gets treated
 * like one. Raising it is his call to make; six hundred a day spread over a
 * polite four-second gap is still slower than a person clicking hard.
 *
 * The hourly cap matters more than the daily one — a burst looks automated in a
 * way that a steady trickle does not — so that stays at ninety. */
/* The hourly cap became the binding one once the day was raised to six
   hundred: ninety an hour means a full day's allowance needs seven hours to
   spend, and a single scan of a hundred and thirty houses swallows the hour in
   ten minutes and then blocks everything he does next. A hundred and fifty an
   hour still spreads six hundred over four hours, which is not a burst. */
const LIMITS: Budget = {
  perHour: Number(process.env.LISTING_REQUESTS_PER_HOUR ?? 150),
  perDay: Number(process.env.LISTING_REQUESTS_PER_DAY ?? 600),
};

/**
 * On disk, not in memory.
 *
 * The counter used to be a plain array in the process, which meant every server
 * restart handed the account a fresh four hundred requests. With a file watcher
 * restarting on every save, the ceiling that exists to protect his account was
 * being reset several times an hour and had never once actually stopped
 * anything. A budget you can reset by saving a file is not a budget.
 */
const FILE = join(STORE_DIR, 'listing-requests.json');

const stamps: number[] = (() => {
  try {
    const raw = JSON.parse(readFileSync(FILE, 'utf8')) as unknown;
    return Array.isArray(raw) ? raw.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
})();

let flush: NodeJS.Timeout | undefined;

/* Batched, because a sweep spends these a few seconds apart and rewriting a
   small file per request is pointless. A crash loses at most a second of
   counting, which errs in the safe direction anyway. */
function save() {
  if (flush) return;
  flush = setTimeout(() => {
    flush = undefined;
    try {
      mkdirSync(STORE_DIR, { recursive: true });
      writeFileSync(FILE, JSON.stringify(stamps));
    } catch { /* counting in memory still works; losing the file is not fatal */ }
  }, 1_000);
  flush.unref?.();
}

export class BudgetExhausted extends Error {
  constructor(public readonly window: 'hour' | 'day', public readonly retryAfterMin: number) {
    super(
      `Listing-site request budget for the ${window} is used up. Pausing rather than ` +
      `pushing — these requests carry your signed-in cookie and the account matters ` +
      `more than the data. Try again in about ${retryAfterMin} minutes; anything ` +
      `already fetched is cached and still readable.`,
    );
    this.name = 'BudgetExhausted';
  }
}

function prune() {
  const cutoff = Date.now() - 24 * 3_600_000;
  const before = stamps.length;
  while (stamps.length && stamps[0]! < cutoff) stamps.shift();
  if (stamps.length !== before) save();
}

export function remaining() {
  prune();
  const now = Date.now();
  const lastHour = stamps.filter((t) => t > now - 3_600_000).length;
  return {
    hour: Math.max(0, LIMITS.perHour - lastHour),
    day: Math.max(0, LIMITS.perDay - stamps.length),
    usedThisHour: lastHour,
    usedToday: stamps.length,
    limits: LIMITS,
  };
}

/** Call before every request to a listing site. Throws when the budget is gone. */
export function spend(): void {
  const r = remaining();
  if (r.hour <= 0) {
    const oldest = stamps.find((t) => t > Date.now() - 3_600_000) ?? Date.now();
    throw new BudgetExhausted('hour', Math.ceil((oldest + 3_600_000 - Date.now()) / 60_000));
  }
  if (r.day <= 0) throw new BudgetExhausted('day', 60);
  stamps.push(Date.now());
  save();
}
