'use client';

/**
 * Two houses, side by side, keep one.
 *
 * His idea, and a better one than anything I had given him. Two weeks of
 * top-tens — six of them, each weighted slightly differently — produced six
 * different orderings and no decision. Meanwhile every good call he actually
 * made was comparative and made in a sentence: "1190 had more land for similar
 * price", "Wilshire is the better version of Savannah Run", "1040 and 1190 are
 * two lanes apart and 1190 wins on land and facing".
 *
 * So this is the tool that matches how he already thinks. Forty houses is
 * unrankable; two houses is a question anyone can answer. Cutting one at a
 * time turns the list into a shortlist in about twenty clicks, and every cut
 * lands in the same `rejected` bucket as the ones he made from the car.
 *
 * Pairs are drawn to be genuinely comparable — near each other, or close in
 * price — because the useful comparison is the one where most things are held
 * constant and the difference is small enough to argue about.
 */

import { useMemo, useState } from 'react';
import { Swords, X, Check, SkipForward, Loader2, MapPin, Trophy, ExternalLink, FileText } from 'lucide-react';
import { setVerdict } from '@/lib/api';
import { HouseMap } from './HouseMap';
import type { Anchor } from '@/lib/api';
import type { Assessment, Listing, PreferenceProfile } from '@/types/listing';

type Row = { listing: Listing; a?: Assessment };

const money = (n?: number) => (n ? `$${n.toLocaleString()}` : '—');
const miles = (a: Listing, b: Listing) => {
  if (!a.coords || !b.coords) return undefined;
  return Math.hypot(
    (a.coords.lat - b.coords.lat) * 69,
    (a.coords.lng - b.coords.lng) * 57.5,
  );
};

/** The fields worth putting beside each other, and which way is better. */
type Field = {
  label: string;
  get: (r: Row) => number | string | undefined;
  fmt?: (v: number | string | undefined) => string;
  /** 1 = higher wins, -1 = lower wins, 0 = no winner (context only) */
  dir: 1 | -1 | 0;
};

const dim = (r: Row, key: string) => r.a?.dimensions.find((d) => d.key === key)?.score;
const evening = (l: Listing) =>
  l.commute?.legs.find((x) => x.label.startsWith('Evening'))?.minutes;
const offpeak = (l: Listing) =>
  l.commute?.legs.find((x) => x.label.startsWith('Off-peak'))?.minutes
  ?? l.commute?.legs.find((x) => x.label.startsWith('Evening'))?.freeFlowMinutes;
const capex = (r: Row) => {
  const m = /\$([\d,]+) of work due soon/.exec(
    r.a?.dimensions.find((d) => d.key === 'maintenance')?.reason ?? '');
  return m ? Number(m[1].replace(/,/g, '')) : 0;
};
/* `negotiation` is deliberately untyped on Assessment — the backend owns that
   payload's shape. Read the one number this table needs, and only if it is one. */
const expected = (n: unknown): number | undefined => {
  const v = (n as { expect?: unknown } | undefined)?.expect;
  return typeof v === 'number' ? v : undefined;
};
const landPsf = (l: Listing) =>
  l.lotSizeAcres ? Math.round(l.price / (l.lotSizeAcres * 43560)) : undefined;

const FIELDS: Field[] = [
  { label: 'Match score', get: (r) => r.a?.matchScore, dir: 1 },
  { label: 'Price', get: (r) => r.listing.price, fmt: (v) => money(v as number), dir: -1 },
  { label: 'Realistic landing', get: (r) => expected(r.a?.negotiation), fmt: (v) => money(v as number), dir: -1 },
  { label: 'Beds / baths', get: (r) => `${r.listing.beds ?? '?'} / ${r.listing.baths ?? '?'}`, dir: 0 },
  { label: 'Square feet', get: (r) => r.listing.sqft, fmt: (v) => (v ? (v as number).toLocaleString() : '—'), dir: 1 },
  { label: '$ per sq ft', get: (r) => (r.listing.sqft ? Math.round(r.listing.price / r.listing.sqft) : undefined), fmt: (v) => (v ? `$${v}` : '—'), dir: -1 },
  { label: 'Lot (acres)', get: (r) => r.listing.lotSizeAcres || undefined, dir: 1 },
  { label: '$ per sq ft of land', get: (r) => landPsf(r.listing), fmt: (v) => (v ? `$${v}` : '—'), dir: -1 },
  { label: 'Backyard', get: (r) => dim(r, 'yard'), dir: 1 },
  { label: 'Fenced', get: (r) => r.a?.perception?.yardFenced, dir: 0 },
  { label: 'Built', get: (r) => r.listing.yearBuilt || undefined, dir: 1 },
  { label: 'Work due soon', get: (r) => capex(r), fmt: (v) => money(v as number), dir: -1 },
  { label: 'Basement', get: (r) => r.listing.basement ?? '—', dir: 0 },
  { label: 'Facing', get: (r) => r.a?.orientation?.entranceDirection, dir: 0 },
  /* Read before the Vastu row, deliberately. A vastu score with no plan behind
     it is the front door and six unknowns — comparing it against a house that
     has been fully read is comparing a guess to a measurement. */
  {
    label: 'Floor plan on file',
    get: (r) => {
      const im = r.listing.images ?? {};
      const n = (im.floorPlan ? 1 : 0) + (im.floorPlanExtra?.length ?? 0);
      return n ? `yes — ${n} page${n > 1 ? 's' : ''}` : 'NO';
    },
    dir: 0,
  },
  { label: 'Vastu', get: (r) => (r.a?.vastu as { score?: number } | undefined)?.score, dir: 1 },
  {
    label: 'Placements read',
    get: (r) => {
      const v = r.a?.vastu as { readings?: { verdict: string }[] } | undefined;
      if (!v?.readings?.length) return '—';
      const known = v.readings.filter((x) => x.verdict !== 'unknown').length;
      return `${known} of ${v.readings.length}`;
    },
    dir: 0,
  },
  { label: 'Commute at 5pm', get: (r) => evening(r.listing), fmt: (v) => (v ? `${v} min` : '—'), dir: -1 },
  { label: 'Clear road', get: (r) => offpeak(r.listing), fmt: (v) => (v ? `${v} min` : '—'), dir: -1 },
  { label: 'GA-400 exit', get: (r) => r.listing.exit?.number || undefined, dir: 0 },
  { label: 'Schools', get: (r) => r.listing.neighborhood?.schoolRating, dir: 1 },
  { label: 'Diversity index', get: (r) => r.listing.neighborhood?.diversityIndex, fmt: (v) => (typeof v === 'number' ? v.toFixed(2) : '—'), dir: 1 },
  { label: 'Walk Score', get: (r) => r.listing.neighborhood?.walkScore, dir: 1 },
  { label: 'HOA / month', get: (r) => r.listing.hoaMonthly ?? 0, fmt: (v) => money(v as number), dir: -1 },
  { label: 'Days listed', get: (r) => r.listing.daysOnMarket, dir: 1 },
  { label: 'Price cuts', get: (r) => r.listing.priceHistory?.cutCount, dir: 1 },
];

export function HeadToHead({
  rows, anchors, onProfileChanged, onRescan,
}: {
  rows: Row[];
  anchors: Anchor[];
  onProfileChanged: (p: PreferenceProfile) => void;
  onRescan: () => void;
}) {
  const [cut, setCut] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  /* Only houses still in the running. A pair where one is already out teaches
     nothing. */
  const pool = useMemo(
    () => rows.filter(({ listing, a }) =>
      !a?.ruledOut && a?.verdict !== 'rejected' && a?.verdict !== 'tooFar'
      && !['sold', 'off market', 'pending'].includes(listing.status ?? '')
      && !cut.has(listing.id) && listing.price > 0),
    [rows, cut]);

  /* Pick the most *comparable* remaining pair: near each other first, then
     close in price. Two houses three miles and $40k apart is an argument you
     can settle; two houses twenty miles and $400k apart is not. */
  const pair = useMemo(() => {
    let best: [Row, Row] | null = null;
    let bestCost = Infinity;
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const A = pool[i], B = pool[j];
        const key = `${A.listing.id}|${B.listing.id}`;
        if (skipped.has(key)) continue;
        const d = miles(A.listing, B.listing);
        const dp = Math.abs(A.listing.price - B.listing.price) / 1000;
        /* A mile is worth about $12k of similarity — near neighbours at
           different prices are the most instructive pairs he has found. */
        const cost = (d === undefined ? 40 : d) * 12 + dp;
        if (cost < bestCost) { bestCost = cost; best = [A, B]; }
      }
    }
    return best;
  }, [pool, skipped]);

  const decide = async (keep: Row, drop: Row) => {
    if (busy) return;
    setBusy(true);
    try {
      onProfileChanged(await setVerdict(drop.listing.id, 'rejected'));
      setCut((s) => new Set(s).add(drop.listing.id));
      onRescan();
    } finally { setBusy(false); }
  };

  if (!pair) {
    return (
      <section className="rounded-2xl border border-ink-700 bg-ink-850 p-8 text-center">
        <Trophy size={22} className="mx-auto mb-3 text-brand-400" />
        <h3 className="text-[15px] font-semibold text-ink-100">
          {pool.length <= 1 ? 'Down to one.' : 'No pairs left to compare.'}
        </h3>
        <p className="mx-auto mt-2 max-w-md text-[12.5px] leading-relaxed text-ink-400">
          {pool.length} still standing. Everything else you have either cut here or ruled out
          elsewhere. Skipped pairs come back if you reload.
        </p>
      </section>
    );
  }

  const [A, B] = pair;
  const apart = miles(A.listing, B.listing);
  const pairKey = [A.listing.id, B.listing.id].sort().join('|');

  const Side = ({ r, other }: { r: Row; other: Row }) => {
    const photo = r.listing.images?.exterior ?? r.listing.images?.gallery?.[0];
    const plans = (r.listing.images?.floorPlan ? 1 : 0)
      + (r.listing.images?.floorPlanExtra?.length ?? 0);
    return (
    <div className="flex-1">
      {photo && (
        /* Two addresses look identical on paper. Two photographs do not — and
           half his verdicts have turned on what a place looked like. */
        <img
          src={photo}
          alt={r.listing.address}
          className="mb-2.5 h-40 w-full rounded-xl border border-ink-700 object-cover"
        />
      )}
      <h4 className="text-[13.5px] font-semibold leading-snug text-ink-100">
        {r.listing.address.split(',')[0]}
      </h4>
      <p className="mt-0.5 text-[11.5px] text-ink-500">
        {r.listing.address.split(',').slice(1, 3).join(',').trim()}
      </p>
      <div className="mt-1.5 flex items-center gap-3">
        <a
          href={r.listing.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11.5px] text-brand-400 hover:text-brand-300"
        >
          <ExternalLink size={11} /> Open on Redfin
        </a>
        <span className={`inline-flex items-center gap-1 text-[11.5px]
          ${plans ? 'text-ink-500' : 'text-warn-400'}`}>
          <FileText size={11} /> {plans ? `${plans} plan page${plans > 1 ? 's' : ''}` : 'no floor plan'}
        </span>
      </div>
      <button
        onClick={() => decide(r, other)}
        disabled={busy}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-good-500/50 bg-good-500/10 px-3 py-2 text-[12.5px] font-semibold text-good-400 transition hover:bg-good-500/20 disabled:opacity-40"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        Keep this one
      </button>
    </div>
    );
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-ink-700 bg-ink-850 p-5">
        <header className="mb-1 flex items-center gap-2">
          <Swords size={15} className="text-brand-400" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-300">
            Head to head
          </h3>
          <span className="ml-auto font-mono text-[11px] text-ink-500">
            {pool.length} still in
          </span>
        </header>
        <p className="mb-4 text-[12px] leading-relaxed text-ink-500">
          Keep one, the other goes to Out. Pairs are chosen to be comparable — close by, or close
          in price — so the difference is small enough to actually argue about.
          {apart !== undefined && (
            <> These two are <strong className="text-ink-300">{apart.toFixed(1)} miles apart</strong>.</>
          )}
        </p>

        <div className="flex items-start gap-4">
          <Side r={A} other={B} />
          <div className="flex shrink-0 flex-col items-center gap-1 pt-1">
            <span className="rounded-full bg-ink-700/70 px-2 py-0.5 font-mono text-[10px] text-ink-400">vs</span>
            {apart !== undefined && (
              <span className="flex items-center gap-1 font-mono text-[10px] text-ink-600">
                <MapPin size={9} />{apart.toFixed(1)}mi
              </span>
            )}
          </div>
          <Side r={B} other={A} />
        </div>
      </section>

      {/* Where they actually are, relative to each other and to the places he
          measures everything against. "0.9 miles apart" is a number; two pins
          with Halcyon and the office behind them is a neighbourhood. */}
      {A.listing.coords && B.listing.coords && (
        <section className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-850">
          <HouseMap rows={[A, B]} anchors={anchors} activeId={A.listing.id} onSelect={() => {}} compact />
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-850">
        <table className="w-full text-[12.5px]">
          <tbody>
            {FIELDS.map((f) => {
              const va = f.get(A), vb = f.get(B);
              const na = typeof va === 'number' ? va : undefined;
              const nb = typeof vb === 'number' ? vb : undefined;
              let winA = false, winB = false;
              if (f.dir !== 0 && na !== undefined && nb !== undefined && na !== nb) {
                winA = f.dir === 1 ? na > nb : na < nb;
                winB = !winA;
              }
              const cell = (v: typeof va, win: boolean) => (
                <td className={`w-[38%] px-4 py-1.5 font-mono tabular-nums
                  ${win ? 'font-bold text-good-400' : 'text-ink-100'}`}>
                  {f.fmt ? f.fmt(v) : (v ?? '—')}
                </td>
              );
              return (
                <tr key={f.label} className="border-b border-ink-700/70 last:border-0 odd:bg-ink-900/40">
                  {cell(va, winA)}
                  <td className="px-2 py-1.5 text-center text-[11.5px] font-medium text-ink-200">{f.label}</td>
                  {cell(vb, winB)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => setSkipped((s) => new Set(s).add(pairKey))}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-2 text-[12px] text-ink-400 transition hover:border-ink-600 hover:text-ink-200 disabled:opacity-40"
        >
          <SkipForward size={12} /> Can&rsquo;t choose — next pair
        </button>
        <button
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            try {
              onProfileChanged(await setVerdict(A.listing.id, 'rejected'));
              onProfileChanged(await setVerdict(B.listing.id, 'rejected'));
              setCut((s) => new Set(s).add(A.listing.id).add(B.listing.id));
              onRescan();
            } finally { setBusy(false); }
          }}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-bad-500/40 px-3 py-2 text-[12px] text-bad-400 transition hover:bg-bad-500/10 disabled:opacity-40"
        >
          <X size={12} /> Neither
        </button>
      </div>
    </div>
  );
}
