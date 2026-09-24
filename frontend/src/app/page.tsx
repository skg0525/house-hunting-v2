'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Home, Loader2, Ban, Star, Footprints, CalendarDays, Bookmark, Clock, Hourglass, Layers, ThumbsDown, UserRound, Hammer } from 'lucide-react';
import { Header } from '@/components/Header';
import { PasteBox } from '@/components/PasteBox';
import { ListingCard } from '@/components/ListingCard';
import { HouseDetail } from '@/components/HouseDetail';
import { HouseMap } from '@/components/HouseMap';
import { VastuGuide } from '@/components/VastuGuide';
import { HeadToHead } from '@/components/HeadToHead';
import { PreferencePanel } from '@/components/PreferencePanel';
import {
  getHealth, getListings, getProfile, startScan, refreshPrices, getAnchors, getPlans, rescoreOne,
  refetchAssessment,
  type ScanMode, type Anchor,
} from '@/lib/api';
import type { Assessment, HealthPayload, Listing, PreferenceProfile } from '@/types/listing';

/* `by:<name>` is a referrer filter. Written as a template literal rather than
   an enum because the names come from the data — a second realtor should cost
   nothing, and the chips below are built from whatever names actually exist. */
type Filter = 'all' | 'contenders' | 'selfTour' | 'agentTour' | 'shortlist' | 'maybe' | 'tooFar' | 'out' | 'ruledOut' | 'new' | 'open' | 'fenced' | 'basement' | 'pending' | 'gone' | 'newBuild'
  | `by:${string}`;

/** Narrowing by the numbers, rather than by score alone. */
/**
 * How the list is ordered.
 *
 * Score is the default and usually right, but it cannot answer "show me the
 * biggest lots" or "which of these is closest to town" — and those are real
 * questions when the top ten are all within a few points of each other.
 */
type SortKey =
  | 'score' | 'vastu' | 'lot' | 'price' | 'commute' | 'fromHome' | 'added'
  | 'walk' | 'park' | 'halcyon' | 'avalon' | 'value' | 'growth' | 'schools' | 'land';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'score', label: 'Score' },
  { key: 'vastu', label: 'Vastu' },
  { key: 'lot', label: 'Lot size' },
  { key: 'price', label: 'Price' },
  { key: 'commute', label: 'Commute at 5pm' },
  { key: 'walk', label: 'Walkable' },
  { key: 'park', label: 'Near a park' },
  { key: 'value', label: '$ per sq ft of house' },
  { key: 'land', label: '$ per acre' },
  { key: 'schools', label: 'Schools' },
  { key: 'growth', label: 'Holds value' },
  { key: 'fromHome', label: 'Near Midtown' },
  { key: 'halcyon', label: 'Near Halcyon' },
  { key: 'avalon', label: 'Near Avalon' },
  { key: 'added', label: 'Recently added' },
];

/**
 * An open house still ahead of us.
 *
 * Past dates are dropped rather than shown greyed out — a Saturday that has
 * been and gone is not a plan, and the whole point of this tab is answering
 * "what can we walk into this weekend?"
 */
function hasUpcomingOpenHouse(l: Listing): boolean {
  /* A house he has already stood inside is not a plan either.
   *
   * Same reasoning as dropping past dates, and it was missed: 1510 Heritage Dr
   * and 6130 Bentley Commons Dr both held an open house today and he had
   * toured both the day before. The tab offered them anyway, because it knew
   * about the calendar and nothing about him. `touredAt` was set correctly on
   * both — the failure was downstream of the flag, not in it.
   *
   * Excluded rather than greyed out: the question this tab answers is "where
   * can we go today", and the answer never includes yesterday. His verdict on
   * the house lives in its bucket and its notes, which is where he looks for
   * what he thought of it. */
  if (l.touredAt) return false;
  return (l.openHouses ?? []).some((o) => Date.parse(o.end ?? o.start) >= Date.now());
}

/** As above, plus: a house that is out is not somewhere to spend a Sunday. */
function worthVisiting(l: Listing, a?: Assessment): boolean {
  return hasUpcomingOpenHouse(l) && !a?.ruledOut && a?.verdict !== 'rejected';
}

/** Off the market, one way or another. */
const GONE = ['sold', 'off market'];
/* Under contract, not gone. Roughly one in five of these falls through, and a
   house that comes back comes back at a price the seller has already had to
   defend — so it keeps its bucket, its notes and its score, and waits here
   rather than in "Sold / gone" where nothing ever comes back from. What it
   must NOT do is sit in "In play" looking buyable on a Saturday morning. */
const PENDING = ['pending'];

const gone = (l: Listing) => GONE.includes(l.status ?? '');
const pend = (l: Listing) => PENDING.includes(l.status ?? '');

type Pile = 'gone' | 'pending' | 'out' | 'ruledOut' | 'inPlay';

/**
 * Which single pile a house is in.
 *
 * Every house is in exactly one, and the tabs and the list both ask this rather
 * than testing conditions of their own. The last time two places decided this
 * separately, a tab promised 49 houses and showed 41, and he found it by
 * subtracting two numbers.
 *
 * The order is the point, because houses qualify for several at once:
 *
 * 1. Sold or under contract — a fact about the house, not an opinion.
 * 2. He passed. His decision outranks anything measured, always.
 * 3. The hard rule. Above the commute shelf deliberately: a south-facing house
 *    that is also 40 minutes away belongs in the pile he never reopens, not on
 *    the shelf he raids when the search widens. Widening the radius must not
 *    walk a barred facing back in.
 * 4. The commute shelf. Parked, not rejected — out stays out.
 * 5. Everything left is in play.
 */
function pileOf(l: Listing, a?: Assessment): Pile {
  if (gone(l)) return 'gone';
  if (pend(l)) return 'pending';
  if (a?.verdict === 'rejected') return 'out';
  if (a?.ruledOut) return 'ruledOut';
  return 'inPlay';
}

/**
 * A long drive, which is a lens rather than a shelf.
 *
 * This used to be a verdict he set by hand, and it moved houses OUT of "In
 * play" — which is why it shelved twenty-eight of them, including ones he
 * liked. His instruction: keep the bucket, make it thirty minutes, stop
 * parking them. So it is computed from the drive itself and every house it
 * matches is still in play; clicking the tab just narrows the list to them.
 *
 * The commute dimension still scores, at weight 0.75 against a forty-minute
 * ceiling. A long drive costs a house points, as it should. What it no longer
 * does is remove the house from the list before he has seen it.
 */
/* Built 2020 or later.
 *
 * Not `isNewConstruction`, which means "a builder is selling it now" — that
 * flag goes false the moment a 2021 house changes hands, and a 2021 house is
 * still a 2021 house. He asked for the year, so it reads the year. */
const NEW_BUILD_YEAR = 2020;
const isNewBuild = (l: Listing) => (l.yearBuilt ?? 0) >= NEW_BUILD_YEAR;

const LONG_DRIVE_MINS = 30;
function isLongDrive(l: Listing): boolean {
  return (l.commute?.badDayMinutes ?? 0) >= LONG_DRIVE_MINS;
}

interface Sieve {
  minLot?: number;
  maxCommute?: number;
  /** The same drive with the road clear — the one he makes at weekends. */
  maxOffPeak?: number;
  minVastu?: number;
  maxPrice?: number;
  /** 'any' is the absence of the filter; 'none' is a house he does not want. */
  basement?: 'any' | 'finished' | 'partly finished' | 'unfinished' | 'none';
}

export default function Page() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [profile, setProfile] = useState<PreferenceProfile | null>(null);
  const [assessments, setAssessments] = useState<Record<string, Assessment>>({});
  const [activeId, setActiveId] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  /* Which houses share a drawing. Cheap to compute and only changes when a new
     plan is read, so it is fetched once and after a scan rather than per house. */
  const [plans, setPlans] = useState<import('@/lib/api').PlanFamily[]>([]);
  /* The scan repairs half-added houses before it scores anything, and that
     part sends no per-house events. Without a word for it the button just sat
     there and the scan looked stuck. */
  const [phase, setPhase] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [bootError, setBootError] = useState<string | null>(null);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [showMap, setShowMap] = useState(false);
  const [showVastu, setShowVastu] = useState(false);
  const [showDuel, setShowDuel] = useState(false);
  const [sieve, setSieve] = useState<Sieve>({});
  const [sort, setSort] = useState<SortKey>('score');
  const [checkingPrices, setCheckingPrices] = useState(false);
  const [priceNews, setPriceNews] = useState<string | null>(null);

  /* ------------------------------ boot ------------------------------ */

  useEffect(() => {
    (async () => {
      try {
        const [h, l, p, an] = await Promise.all([
          getHealth(), getListings(), getProfile(), getAnchors().catch(() => []),
        ]);
        setAnchors(an);
        setHealth(h);
        setListings(l);
        getPlans().then(setPlans).catch(() => setPlans([]));
        setProfile(p);
        setShowAdd(l.length === 0);

        /* Load the scores that already exist.
         *
         * Assessments live in component state, so a page refresh started with
         * none of them and every house rendered blank — no score, no detail,
         * nothing. The auto-scan that used to paper over this was removed
         * (rightly: it fired hundreds of listing-site requests unasked), which
         * left the app looking broken on load.
         *
         * A re-score reads from the cache only. No model calls, no listing-site
         * requests, no cost — it is arithmetic over readings already taken. */
        if (l.length) scan('rescore');
      } catch (e) {
        setBootError((e as Error).message);
      }
    })();
  }, []);

  /* ------------------------------ scan ------------------------------ */

  const scan = useCallback((mode: ScanMode) => {
    setScanning(true);
    setProgress({ done: 0, total: 0 });
    setPhase(null);
    setPending(new Set(listings.map((l) => l.id)));

    startScan({
      onPhase: (d) => setPhase(d.note),
      onStart: (d) => { setPhase(null); setProgress({ done: 0, total: d.total }); },
      onAssessment: (a) => {
        setAssessments((prev) => ({ ...prev, [a.listingId]: a }));
        setPending((prev) => { const n = new Set(prev); n.delete(a.listingId); return n; });
      },
      onSkipped: (d) =>
        setPending((prev) => { const n = new Set(prev); n.delete(d.listingId); return n; }),
      onFailed: (d) =>
        setPending((prev) => { const n = new Set(prev); n.delete(d.listingId); return n; }),
      onProgress: setProgress,
      /* Re-read the listings, not just the scores.
       *
       * A scan writes to the houses as well as scoring them — it fetches the
       * gallery, saves the front photo, attaches floor plans, refreshes open
       * house dates. Only the assessments were being brought back, so twenty
       * newly added houses finished the scan with their photos sitting on disk
       * and the cards still showing empty grey boxes until the page was
       * reloaded by hand. */
      onDone: async () => {
        setScanning(false);
        setPending(new Set());
        setPhase(null);
        try { setListings(await getListings()); } catch { /* the scores are in either way */ }
        try { setPlans(await getPlans()); } catch { /* the panel simply will not show */ }
      },
    }, mode);
  }, [listings]);

  /* Read NEW houses automatically, but only a handful.
   *
   * This used to fire on any unread listing, which meant importing 58 houses
   * silently began a sweep that would have made hundreds of requests to a
   * listing site on a signed-in account — without anyone pressing anything.
   * A couple of new houses is a convenience; sixty is a decision, and
   * decisions get a button. */
  useEffect(() => {
    if (!profile || scanning) return;
    const unread = listings.filter((l) => !assessments[l.id]);
    if (unread.length > 0 && unread.length <= 3) scan('full');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings.length, profile?.userId]);

  /* ----------------------------- ordering ----------------------------- */

  /**
   * Ruled-out houses sink, whatever they scored. They stay in the list rather
   * than vanishing, because seeing that the south-facing one you liked is out
   * is the whole point — silently hiding it would just make you wonder where it
   * went and paste the link again next week.
   */
  const ranked = useMemo(() => {
    const withScore = listings.map((l) => ({ listing: l, a: assessments[l.id] }));

    const milesHome = (r: typeof withScore[number]) =>
      r.listing.anchors?.find((x) => x.key === 'home')?.miles ?? Infinity;
    const vastuOf = (r: typeof withScore[number]) =>
      (r.a?.vastu as { score?: number } | undefined)?.score ?? -1;
    const milesTo = (r: typeof withScore[number], key: string) =>
      r.listing.anchors?.find((x) => x.key === key)?.miles ?? Infinity;
    const dim = (r: typeof withScore[number], key: string) => {
      const d = r.a?.dimensions.find((x) => x.key === key);
      return d?.available ? d.score : -1;
    };

    /* Every sort but the default still sinks ruled-out houses, because a big
       lot on a south-facing house is not a reason to put it at the top. */
    if (sort !== 'score') {
      const value: Record<Exclude<SortKey, 'score'>, (r: typeof withScore[number]) => number> = {
        vastu: vastuOf,
        lot: (r) => r.listing.lotSizeAcres || -1,
        price: (r) => -(r.listing.price || Infinity),
        /* The evening drive on an ordinary day — work to home leaving 5pm,
           which is the leg that decides whether he is home for bedtime. Not
           distance, not the off-peak figure, and not the pessimistic bad-day
           number the score uses: for ordering a list, the typical evening is
           the honest comparison. His own stopwatch beats all of it. */
        commute: (r) => -(r.listing.observedPeakMinutes
          ?? r.listing.commute?.worstMinutes ?? Infinity),
        fromHome: (r) => -milesHome(r),
        halcyon: (r) => -milesTo(r, 'halcyon'),
        avalon: (r) => -milesTo(r, 'avalon'),
        walk: (r) => dim(r, 'walkability'),
        /* How well it is expected to hold its value, which is the appreciation
           dimension already on the card — not a separate forecast. */
        growth: (r) => dim(r, 'appreciation'),
        /* Straight distance to the nearest park, from the Places lookup. Not
           the walkability score, which mixes shops and transit in as well. */
        park: (r) => -(r.listing.nearby?.nearestParkMetres ?? Infinity),
        /* Price per square foot, cheapest first. A crude measure of value and
           an honest one — it says nothing about the lot or the finish, which is
           why it sits beside the score rather than inside it. */
        value: (r) =>
          r.listing.price > 0 && r.listing.sqft > 0
            ? -(r.listing.price / r.listing.sqft)
            : -Infinity,
        /* Land, not floor area. The two disagree sharply and he reads the
           first as the second: 1040 Krobot Way is the cheapest house per
           square foot on the list and among the dearest per acre, because it
           is six thousand square feet on a seventh of an acre. */
        land: (r) =>
          r.listing.price > 0 && r.listing.lotSizeAcres > 0
            ? -(r.listing.price / r.listing.lotSizeAcres)
            : -Infinity,
        schools: (r) => r.listing.neighborhood?.schoolRating ?? -1,
        added: (r) => (r.listing.addedAt ? Date.parse(r.listing.addedAt) : 0),
      };
      const f = value[sort as Exclude<SortKey, 'score'>];
      return withScore.sort((x, y) => {
        const out = (r: typeof withScore[number]) => (r.a?.ruledOut ? 1 : 0);
        if (out(x) !== out(y)) return out(x) - out(y);
        return f(y) - f(x);
      });
    }

    return withScore.sort((x, y) => {
      /* Out of contention sinks: ruled out by a hard rule, or passed on by
         hand. Neither changes the score any more — the score stays true and the
         ordering carries the decision. */
      const rank = (a?: Assessment, l?: Listing) =>
        GONE.includes(l?.status ?? '') ? 3
        : a?.ruledOut ? 2 : a?.verdict === 'rejected' ? 1 : 0;
      const xo = rank(x.a, x.listing);
      const yo = rank(y.a, y.listing);
      if (xo !== yo) return xo - yo;

      const byMatch = (y.a?.matchScore ?? -1) - (x.a?.matchScore ?? -1);
      if (byMatch !== 0) return byMatch;

      /* Houses pinned to the same number by a rule-out all tie, so without this
         the order never changes no matter what the preferences say. The
         uncapped score breaks the tie and makes re-ranking visible. */
      return (y.a?.baseScore ?? -1) - (x.a?.baseScore ?? -1);
    });
  }, [listings, assessments]);

  /* Recently added. Pasting five at once and then watching them scatter up and
     down a ranked list makes them impossible to find again.

     Six hours, not one: an hour assumed he would sit with the app right after
     pasting, and he does not — the houses go in, the evening happens, and the
     tab is empty by the time he looks. */
  const RECENT_MS = 6 * 60 * 60 * 1000;
  const isRecent = (l: Listing) =>
    l.addedAt ? Date.now() - Date.parse(l.addedAt) < RECENT_MS : false;

  const underFloor = useMemo(() => {
    const floor = profile?.preferences.minLotAcres;
    if (!floor) return 0;
    return listings.filter((l) => l.lotSizeAcres > 0 && l.lotSizeAcres < floor).length;
  }, [listings, profile]);

  const visible = useMemo(() => ranked.filter(({ listing, a }) => {
    if (filter === 'new' && !isRecent(listing)) return false;
    /* Houses you could walk this weekend without ringing anybody. The dates
       were on the card and in the detail but there was no way to ask the list
       for them, so planning a Saturday meant scrolling eighty-six houses. */
    if (filter === 'open' && !worthVisiting(listing, a)) return false;
    /* Everything the agent sent, whatever state it is in — including the ones
       that are out. Answering them needs the whole list and a reason for each,
       not just the survivors. */
    if (filter.startsWith('by:') && listing.referredBy !== filter.slice(3)) return false;
    /* The fence no longer moves the score, so this is how you ask for it.
       "Fenced" means a fence you can see or one he has stood next to — not
       one the covenants merely permit. */
    if (filter === 'fenced' && a?.perception.yardFenced !== 'Yes') return false;
    /* A basement is the cheapest square footage a house can have — a playroom
       that does not need building, or a guest floor. "Finished" and "partly
       finished" both count; an unfinished hole is a project, not a room. */
    if (filter === 'basement'
        && !['finished', 'partly finished'].includes(listing.basement ?? '')) return false;
    if (filter === 'ruledOut' && pileOf(listing, a) !== 'ruledOut') return false;
    if (filter === 'out' && pileOf(listing, a) !== 'out') return false;
    /* Two lists, two phone calls: what he can walk into himself, and what
       needs an agent to open a door. */
    if (filter === 'selfTour' && a?.verdict !== 'selfTour') return false;
    if (filter === 'agentTour' && a?.verdict !== 'agentTour') return false;
    /* The end of the funnel: stood in it, liked it. */
    if (filter === 'shortlist' && a?.verdict !== 'shortlisted') return false;
    /* Kept, not promoted. */
    if (filter === 'maybe' && a?.verdict !== 'maybe') return false;
    /* Parked on drive time alone. Every house he wanted to tour came in under
       25 minutes at 5pm and every one he hedged on was 26 or more, so this is
       the shelf those go on: out of the way, but not thrown away, because if
       the search has to widen he is not going back through "Out" to find
       them. Out stays out. */
    if (filter === 'tooFar' && !isLongDrive(listing)) return false;
    if (filter === 'newBuild' && !isNewBuild(listing)) return false;
    /* Sold or withdrawn. Kept rather than deleted — knowing what went, and for
       what, is how you learn what this market actually pays. */
    if (filter === 'gone' && !GONE.includes(listing.status ?? '')) return false;
    if (filter === 'pending' && !PENDING.includes(listing.status ?? '')) return false;
    if (filter === 'contenders' && (a?.ruledOut || a?.verdict === 'rejected' || a?.verdict === 'tooFar'
        || PENDING.includes(listing.status ?? ''))) return false;
    /* A sold house is not a contender for anything. It belongs in its own tab
       and in "All", and nowhere else. */
    if (filter !== 'gone' && filter !== 'all' && GONE.includes(listing.status ?? '')) return false;
    /* Under contract shows in its own tab, in All, and in the funnel buckets it
       was already filed under — not in the lists you shop from. */
    if (!['pending', 'all', 'selfTour', 'agentTour', 'shortlist', 'maybe'].includes(filter)
        && PENDING.includes(listing.status ?? '')) return false;

    /* A house whose lot size was never recorded is not a small lot — it is an
       unknown one, and hiding it would be answering a question nobody asked. */
    if (sieve.minLot !== undefined && listing.lotSizeAcres > 0
        && listing.lotSizeAcres < sieve.minLot) return false;
    if (sieve.maxPrice !== undefined && listing.price > sieve.maxPrice) return false;
    if (sieve.maxCommute !== undefined) {
      const m = listing.commute?.worstMinutes;
      if (m === undefined || m > sieve.maxCommute) return false;
    }
    /* Rush hour is what he commutes in; the clear road is what the house is
       like the rest of the time — the school run, the weekend, the evening out.
       Both are already measured in the same Routes reply, so this costs
       nothing and answers a different question. */
    if (sieve.maxOffPeak !== undefined) {
      const legs = listing.commute?.legs ?? [];
      const clear = legs.find((l) => l.label.startsWith('Off-peak'))?.minutes
        ?? legs.find((l) => l.label.startsWith('Evening'))?.freeFlowMinutes;
      if (clear === undefined || clear > sieve.maxOffPeak) return false;
    }
    if (sieve.basement && sieve.basement !== 'any') {
      if ((listing.basement ?? 'unknown') !== sieve.basement) return false;
    }
    if (sieve.minVastu !== undefined) {
      const v = (a?.vastu as { score?: number } | undefined)?.score;
      if (v === undefined || v < sieve.minVastu) return false;
    }
    return true;
  }), [ranked, filter, sieve]);

  const active = listings.find((l) => l.id === activeId)
    ?? visible[0]?.listing
    ?? listings[0];

  /* Who has sent houses, and how many each. Sorted by name so the chips do not
     reshuffle when a count changes. */
  const referrers = useMemo(() => {
    const seen = new Map<string, number>();
    for (const { listing } of ranked) {
      const by = listing.referredBy?.trim();
      if (by) seen.set(by, (seen.get(by) ?? 0) + 1);
    }
    return [...seen.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ranked]);

  const counts = useMemo(() => {
    /* Count what the tab will actually show, not something adjacent to it.
     *
     * Every count here used to apply its own rule while `visible` applied a
     * different one, and the two disagreed about sold and off-market houses:
     * "In play 49" opened a list of 41, because eight houses that had already
     * gone were being counted and then filtered out on the way to the screen.
     * He found it by subtracting two tabs and getting the wrong answer.
     *
     * So the counts are derived from one predicate, and the list uses the same
     * one. A number on a tab is a promise about what is behind it. */
    return {
    all: ranked.length,
    contenders: ranked.filter(({ a }) => !a?.ruledOut && a?.verdict !== 'rejected').length,
    selfTour: ranked.filter(({ a, listing }) => a?.verdict === 'selfTour' && !gone(listing)).length,
    agentTour: ranked.filter(({ a, listing }) => a?.verdict === 'agentTour' && !gone(listing)).length,
    shortlist: ranked.filter(({ a, listing }) => a?.verdict === 'shortlisted' && !gone(listing)).length,
    maybe: ranked.filter(({ a, listing }) => a?.verdict === 'maybe' && !gone(listing)).length,
    tooFar: ranked.filter(({ a, listing }) =>
      isLongDrive(listing) && pileOf(listing, a) === 'inPlay').length,
    gone: ranked.filter(({ a, listing }) => pileOf(listing, a) === 'gone').length,
    pending: ranked.filter(({ a, listing }) => pileOf(listing, a) === 'pending').length,
    ruledOut: ranked.filter(({ a, listing }) => pileOf(listing, a) === 'ruledOut').length,
    out: ranked.filter(({ a, listing }) => pileOf(listing, a) === 'out').length,
    recent: ranked.filter(({ listing }) => isRecent(listing)).length,
    openHouse: ranked.filter(({ a, listing }) => worthVisiting(listing, a)).length,
    fenced: ranked.filter(({ a, listing }) =>
      a?.perception.yardFenced !== 'No' && !gone(listing) && !pend(listing)).length,
    newBuild: ranked.filter(({ a, listing }) =>
      isNewBuild(listing) && pileOf(listing, a) === 'inPlay').length,
    basement: ranked.filter(({ listing }) =>
      ['finished', 'partly finished'].includes(listing.basement ?? '')
      && !gone(listing) && !pend(listing)).length,
    };
  }, [ranked]);

  /* ------------------------------ render ------------------------------ */

  if (bootError) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md rounded-2xl border border-bad-500/40 bg-bad-500/[0.06] p-6 text-center">
          <h1 className="mb-2 text-base font-semibold text-white">The backend is not answering</h1>
          <p className="text-[13px] leading-relaxed text-ink-300">{bootError}</p>
          <p className="mt-3 font-mono text-[12px] text-ink-400">
            cd backend && npm run dev
          </p>
        </div>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 size={22} className="animate-spin text-brand-400" />
      </main>
    );
  }

  return (
    <main className="relative z-10 min-h-screen">
      <Header
        health={health}
        scanning={scanning}
        progress={progress}
        phase={phase}
        onScan={(mode) => scan(mode)}
        onRescore={() => scan('rescore')}
        checkingPrices={checkingPrices}
        onCheckPrices={async () => {
          setCheckingPrices(true);
          try {
            const r = await refreshPrices();
            setListings(await getListings());
            setPriceNews(
              r.changed
                ? r.changes.map((c) => `${c.address.split(',')[0]}: ${c.note ?? c.error}`).join(' · ')
                : `Checked ${r.checked} — no price changes.`,
            );
          } catch (e) {
            setPriceNews((e as Error).message);
          } finally {
            setCheckingPrices(false);
          }
        }}
        onAdd={() => setShowAdd((v) => !v)}
        onPrefs={() => { setShowPrefs((v) => !v); setShowMap(false); setShowVastu(false); }}
        onMap={() => { setShowMap((v) => !v); setShowPrefs(false); setShowVastu(false); }}
        onVastu={() => { setShowVastu((v) => !v); setShowMap(false); setShowPrefs(false); setShowDuel(false); }}
        onDuel={() => { setShowDuel((v) => !v); setShowMap(false); setShowPrefs(false); setShowVastu(false); }}
        showingMap={showMap}
        showingVastu={showVastu}
        showingDuel={showDuel}
        showingPrefs={showPrefs}
        showingAdd={showAdd}
      />

      <div className="mx-auto max-w-[1600px] px-6 py-5">
        {priceNews && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-brand-500/30 bg-brand-500/[0.06] px-4 py-2.5">
            <p className="flex-1 text-[12.5px] text-ink-200">{priceNews}</p>
            <button
              onClick={() => setPriceNews(null)}
              className="text-[12px] text-ink-500 hover:text-ink-200"
            >
              dismiss
            </button>
          </div>
        )}

        {showAdd && (
          <div className="mb-5">
            <PasteBox
              onAdded={(added) => {
                setListings((prev) => [...prev, ...added]);
                if (added.length) setShowAdd(false);
              }}
            />
          </div>
        )}

        {listings.length === 0 && !showAdd && (
          <div className="rounded-2xl border border-dashed border-ink-700 p-12 text-center">
            <Home size={26} className="mx-auto mb-3 text-ink-600" />
            <p className="text-[14px] text-ink-300">No houses yet.</p>
            <button
              onClick={() => setShowAdd(true)}
              className="mt-3 rounded-lg bg-brand-500 px-4 py-2 text-[13px] font-semibold text-ink-950 hover:bg-brand-400"
            >
              Paste some links
            </button>
          </div>
        )}

        {/* items-start so the two columns size themselves rather than
            stretching to the taller one — which is what let the list drag the
            page down and made picking the sixtieth house a round trip. */}
        {listings.length > 0 && (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(300px,360px)_1fr]">
            {/* ------------------------- the list ------------------------- */}
            <div className="space-y-3 lg:sticky lg:top-4 lg:flex lg:max-h-[calc(100vh-2rem)] lg:flex-col">
              <div className="flex flex-wrap gap-1.5">
                {([
                  ['contenders', 'In play', counts.contenders],
                  ['selfTour', 'Go myself', counts.selfTour],
                  ['agentTour', 'Ask agent', counts.agentTour],
                  ['shortlist', 'Shortlisted', counts.shortlist],
                  ['maybe', 'Maybe', counts.maybe],
                  ['tooFar', '30+ min', counts.tooFar],
                  ['pending', 'Under contract', counts.pending],
                  ['gone', 'Sold / gone', counts.gone],
                  ['new', 'Just added', counts.recent],
                  ['open', 'Open house', counts.openHouse],
                  ['fenced', 'Fenced', counts.fenced],
                  ['newBuild', 'New build 2020+', counts.newBuild],
                  ['basement', 'Basement', counts.basement],
                  ['ruledOut', 'Out — hard rule', counts.ruledOut],
                  ['out', 'Out — I passed', counts.out],
                  ['all', 'All', counts.all],
                  /* A chip per realtor who has sent something, built from the
                     data so a new name needs no code. */
                  ...referrers.map((r) =>
                    [`by:${r.name}` as Filter, r.name, r.count] as const),
                ] as const).map(([key, label, n]) => (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition
                      ${filter === key
                        ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
                        : 'border-ink-700 text-ink-400 hover:border-ink-600 hover:text-ink-200'}`}
                  >
                    {key === 'out' && <ThumbsDown size={11} />}
                    {key === 'ruledOut' && <Ban size={11} />}
                    {key === 'selfTour' && <Footprints size={11} />}
                    {key === 'agentTour' && <CalendarDays size={11} />}
                    {key === 'shortlist' && <Star size={11} />}
                    {key === 'basement' && <Layers size={11} />}
                    {key === 'newBuild' && <Hammer size={11} />}
                    {key === 'maybe' && <Bookmark size={11} />}
                    {key === 'tooFar' && <Clock size={11} />}
                    {key === 'pending' && <Hourglass size={11} />}
                    {key === 'gone' && <Ban size={11} />}
                    {typeof key === 'string' && key.startsWith('by:') && <UserRound size={11} />}
                    {label}
                    <span className="font-mono text-[11px] opacity-70">{n}</span>
                  </button>
                ))}
              </div>

              {/* The lot floor in the profile costs a house points; it does not
                  remove it. This is the one click that does, and it says how
                  many rather than quietly shortening the list. */}
              {profile && underFloor > 0 && (
                <button
                  onClick={() => setSieve((v) => ({
                    ...v,
                    minLot: v.minLot === undefined ? profile.preferences.minLotAcres : undefined,
                  }))}
                  className={`w-full rounded-lg border px-2.5 py-1.5 text-left text-[11.5px] transition
                    ${sieve.minLot !== undefined
                      ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
                      : 'border-ink-700 text-ink-400 hover:border-ink-600 hover:text-ink-200'}`}
                >
                  {sieve.minLot !== undefined
                    ? `Hiding ${underFloor} under ${profile.preferences.minLotAcres} acres — show them`
                    : `${underFloor} are under your ${profile.preferences.minLotAcres} acre floor — hide them`}
                </button>
              )}

              <div className="flex flex-wrap gap-1">
                {SORTS.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setSort(s.key)}
                    className={`rounded-lg border px-2 py-1 text-[11px] font-medium transition
                      ${sort === s.key
                        ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
                        : 'border-ink-700 text-ink-500 hover:border-ink-600 hover:text-ink-300'}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* Narrow by the numbers, not just the score. */}
              <details className="rounded-xl border border-ink-700 bg-ink-850">
                <summary className="cursor-pointer px-3 py-2 text-[12px] text-ink-300">
                  Narrow it down
                  {Object.values(sieve).some((v) => v !== undefined) && (
                    <span className="ml-2 rounded bg-brand-500/15 px-1.5 py-0.5 font-mono text-[10px] text-brand-400">
                      {visible.length} of {ranked.length}
                    </span>
                  )}
                </summary>
                <div className="space-y-2 border-t border-ink-700 px-3 py-2.5">
                  {([
                    ['minLot', 'Lot at least (acres)', 0.05],
                    ['maxPrice', 'Price at most', 5000],
                    ['maxCommute', 'Commute at 5pm, at most (min)', 1],
                    ['maxOffPeak', 'Commute off-peak, at most (min)', 1],
                    ['minVastu', 'Vastu at least (0-100)', 1],
                  ] as const).map(([key, label, step]) => (
                    <label key={key} className="flex items-center justify-between gap-2">
                      <span className="text-[11.5px] text-ink-400">{label}</span>
                      <input
                        type="number"
                        step={step}
                        defaultValue={sieve[key] ?? ''}
                        onBlur={(e) => setSieve((s) => ({
                          ...s,
                          [key]: e.target.value === '' ? undefined : Number(e.target.value),
                        }))}
                        className="w-24 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-right font-mono text-[11.5px] text-ink-100 outline-none focus:border-brand-400"
                      />
                    </label>
                  ))}
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-[11.5px] text-ink-400">Basement</span>
                    <select
                      value={sieve.basement ?? 'any'}
                      onChange={(e) => setSieve((s) => ({
                        ...s,
                        basement: e.target.value === 'any'
                          ? undefined : e.target.value as NonNullable<Sieve['basement']>,
                      }))}
                      className="w-32 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-right font-mono text-[11.5px] text-ink-100 outline-none focus:border-brand-400"
                    >
                      <option value="any">any</option>
                      <option value="finished">finished</option>
                      <option value="partly finished">partly finished</option>
                      <option value="unfinished">unfinished</option>
                      <option value="none">none</option>
                    </select>
                  </label>
                  <button
                    onClick={() => { setSieve({}); }}
                    className="text-[11px] text-ink-500 hover:text-ink-200"
                  >
                    clear
                  </button>
                </div>
              </details>

              {/* The cards scroll inside the column; the tabs, sorts and
                  filter above them stay put. Scrolling to the bottom of the
                  list and back up to read the house you picked is not a
                  navigation model. */}
              <div className="space-y-2.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
                {visible.map(({ listing, a }, i) => (
                  <ListingCard
                    key={listing.price ?? listing.id}
                    listing={listing}
                    assessment={a}
                    isActive={active?.id === listing.id}
                    isPending={pending.has(listing.id)}
                    rank={a && !a.ruledOut ? i + 1 : undefined}
                    onClick={() => setActiveId(listing.id)}
                  />
                ))}
                {visible.length === 0 && (
                  <p className="rounded-xl border border-dashed border-ink-700 p-6 text-center text-[13px] text-ink-500">
                    Nothing in this bucket yet.
                  </p>
                )}
              </div>
            </div>

            {/* ------------------------ the detail ------------------------ */}
            <div>
              {showDuel ? (
                <HeadToHead
                  rows={ranked}
                  anchors={anchors}
                  onProfileChanged={setProfile}
                  onRescan={() => { /* verdicts re-rank locally; no scan needed */ }}
                />
              ) : showVastu ? (
                <VastuGuide
                  profile={profile}
                  onProfileChanged={setProfile}
                  /* The school changes every house's reading server-side the
                     moment it is saved. Pull the new numbers in rather than
                     leaving the page showing yesterday's copies. Cheap: no
                     force, so nothing is re-perceived. */
                  onSchoolChanged={async () => {
                    const ids = Object.keys(assessments);
                    const fresh = await Promise.all(
                      ids.map((id) => refetchAssessment(id).catch(() => null)),
                    );
                    /* Count what actually moved, so the switch can say so. He
                       toggled it, saw nothing, and reasonably concluded it was
                       broken — the readings HAD changed, but this tab covers
                       the detail panel, so there was no house on screen to
                       show it on. */
                    let changed = 0, biggest = 0;
                    const n: Record<string, Assessment> = { ...assessments };
                    fresh.forEach((a) => {
                      if (!a) return;
                      const was = (assessments[a.listingId]?.vastu as { score?: number } | undefined)?.score;
                      const now = (a.vastu as { score?: number } | undefined)?.score;
                      if (was !== undefined && now !== undefined && was !== now) {
                        changed += 1;
                        biggest = Math.max(biggest, Math.abs(was - now));
                      }
                      n[a.listingId] = a;
                    });
                    setAssessments(n);
                    return { changed, of: fresh.filter(Boolean).length, biggest };
                  }}
                />
              ) : showMap ? (
                <HouseMap
                  rows={visible}
                  anchors={anchors}
                  activeId={active?.id}
                  onSelect={(id) => { setActiveId(id); setShowMap(false); }}
                />
              ) : showPrefs ? (
                <PreferencePanel
                  profile={profile}
                  onChange={setProfile}
                  onRescore={() => scan('rescore')}
                />
              ) : active ? (
                <HouseDetail
                  plans={plans}
                  listing={active}
                  assessment={assessments[active.id]}
                  profile={profile}
                  allRows={ranked}
                  anchors={anchors}
                  onSelect={setActiveId}
                  onListingChanged={(l) =>
                    setListings((prev) => prev.map((x) => (x.id === l.id ? l : x)))}
                  onProfileChanged={setProfile}
                  onRemoved={(id) => {
                    setListings((prev) => prev.filter((x) => x.id !== id));
                    setAssessments((prev) => { const n = { ...prev }; delete n[id]; return n; });
                    setActiveId(null);
                  }}
                  /* One house, not all of them. */
                  onRescan={async () => {
                    if (!active) return;
                    setPending((p) => new Set(p).add(active.id));
                    try {
                      const a = await rescoreOne(active.id);
                      setAssessments((prev) => ({ ...prev, [a.listingId]: a }));
                    } finally {
                      setPending((p) => { const n = new Set(p); n.delete(active.id); return n; });
                    }
                  }}
                />
              ) : null}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
