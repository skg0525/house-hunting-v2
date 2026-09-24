'use client';

import {
  Compass, BedDouble, Trees, Footprints, GraduationCap, Users, TrendingUp, Wrench,
  HelpCircle, CookingPot, Car, Receipt,
} from 'lucide-react';
import type { DimensionScore, DimensionKey, Verdict } from '@/types/listing';

const ICONS: Record<DimensionKey, typeof Compass> = {
  direction: Compass,
  kitchen: CookingPot,
  commute: Car,
  mainFloorSuite: BedDouble,
  yard: Trees,
  walkability: Footprints,
  schools: GraduationCap,
  diversity: Users,
  appreciation: TrendingUp,
  maintenance: Wrench,
  value: Receipt,
};

const TONE: Record<Verdict, { bar: string; text: string }> = {
  ideal: { bar: 'var(--color-good-400)', text: 'text-good-400' },
  acceptable: { bar: 'var(--color-brand-400)', text: 'text-brand-400' },
  concern: { bar: 'var(--color-warn-400)', text: 'text-warn-400' },
  dealbreaker: { bar: 'var(--color-bad-400)', text: 'text-bad-400' },
  unknown: { bar: 'var(--color-ink-600)', text: 'text-ink-500' },
};

/**
 * The breakdown.
 *
 * Two things are deliberately visible on every row. First the weight, because
 * a 40 on something you barely care about is a completely different fact from a
 * 40 on a must-have. Second, whether the dimension has any data at all — an
 * unknown reads as unknown rather than as a middling score, which is the only
 * honest way to show a house you have not finished researching.
 */
interface ScoreMath {
  weightedTotal: number; knownWeight: number; allWeight: number; average: number;
  coverageCap?: number; cappedBy?: { limit: number; reason: string };
}

export function DimensionBars({ dimensions, math, score }: {
  dimensions: DimensionScore[];
  math?: ScoreMath;
  score?: number;
}) {
  // Known things first, then by how much they matter to you.
  const ordered = [...dimensions].sort(
    (a, b) => (b.available === a.available ? b.weight > a.weight : b.available) as unknown as number,
  );
  const yard = dimensions.find((d) => d.key === 'yard');
  const walk = dimensions.find((d) => d.key === 'walkability');
  const tension = yard?.available && walk?.available && Math.abs(yard.score - walk.score) >= 30;

  /* What is actually costing this house, named up front.
   *
   * "Compromises on something you said mattered" is true and useless — it makes
   * you read ten bars and do the arithmetic yourself to find out which things.
   * A dimension drags the score down in proportion to how far below the average
   * it sits AND how much weight it carries, so that product is the ranking. */
  const avg = math?.average ?? 0;
  const drags = dimensions
    .filter((d) => d.available && d.weight > 0 && d.score < avg)
    .map((d) => ({ ...d, cost: (avg - d.score) * d.weight }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 3);
  const unknown = dimensions.filter((d) => !d.available).sort((a, b) => b.weight - a.weight);

  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-850 p-5">
      <header className="mb-4 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-300">
          Breakdown
        </h3>
        <span className="font-mono text-[11px] text-ink-500">score × weight</span>
      </header>

      {drags.length > 0 && (
        <div className="mb-4 rounded-xl border border-ink-700 bg-ink-900/60 p-3.5">
          <p className="mb-2 text-[11px] uppercase tracking-wider text-ink-500">
            What is costing it
          </p>
          <ul className="space-y-1.5">
            {drags.map((d) => (
              <li key={d.key} className="flex gap-2.5 text-[12.5px] leading-snug">
                <span className={`mt-px font-mono font-bold ${TONE[d.verdict].text}`}>
                  {d.score}
                </span>
                <span className="text-ink-300">
                  <span className="font-medium text-ink-100">{d.label}</span>
                  {' — '}
                  {d.reason}
                </span>
              </li>
            ))}
          </ul>

          {unknown.length > 0 && (
            <p className="mt-2.5 border-t border-ink-800 pt-2.5 text-[11.5px] leading-relaxed text-ink-500">
              Not counted either way, because nothing has been read yet:{' '}
              {unknown.map((d) => d.label.toLowerCase()).join(', ')}.
            </p>
          )}
        </div>
      )}

      {tension && (
        <p className="mb-4 rounded-lg border border-saffron-500/25 bg-saffron-500/[0.07] px-3 py-2 text-[12px] leading-relaxed text-saffron-400">
          Yard and walkability disagree sharply here. They usually do — the
          walkable street has the small lot. Both numbers are below; the call is
          yours.
        </p>
      )}

      <div className="space-y-3.5">
        {ordered.map((d) => {
          /* Fall back rather than render undefined. A dimension added to the
             backend before the frontend knows its name used to take the whole
             page down with "Element type is invalid". A missing icon is not
             worth a blank screen. */
          const Icon = (d.available ? ICONS[d.key] : HelpCircle) ?? HelpCircle;
          const tone = TONE[d.verdict];
          return (
            <div key={d.key} className={d.weight === 0 ? 'opacity-40' : d.available ? '' : 'opacity-60'}>
              <div className="flex items-center gap-2">
                <Icon size={14} className={tone.text} />
                <span className="text-[13px] font-medium text-ink-200">{d.label}</span>
                <span className="ml-auto flex items-baseline gap-2 font-mono text-[12px]">
                  {d.available
                    ? <span className={`font-bold ${tone.text}`}>{d.score}</span>
                    : <span className="text-ink-500">—</span>}
                  {d.weight === 0
                    ? <span className="text-bad-400">ignored</span>
                    : <span className="text-ink-500">×{d.weight.toFixed(2)}</span>}
                </span>
              </div>

              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: d.available ? `${d.score}%` : '100%',
                    background: d.available ? tone.bar : 'var(--color-ink-700)',
                    opacity: d.available ? 0.35 + d.weight * 0.65 : 1,
                  }}
                />
              </div>

              <p className="mt-1 text-[11.5px] leading-snug text-ink-400">{d.reason}</p>
            </div>
          );
        })}
      </div>

      {/* The arithmetic, so the number can be argued with rather than trusted.
          "Why is this 58?" was answerable only by reading a concerns list four
          screens down, which is the same as not being answerable. */}
      {math && (
        <div className="mt-5 border-t border-ink-700 pt-4">
          <h4 className="mb-2.5 font-mono text-[10.5px] uppercase tracking-widest text-ink-500">
            How this adds up
          </h4>

          <div className="space-y-1.5 font-mono text-[11.5px]">
            <div className="flex justify-between text-ink-400">
              <span>score × weight, added up</span>
              <span className="text-ink-200">{math.weightedTotal.toFixed(1)}</span>
            </div>
            <div className="flex justify-between text-ink-400">
              <span>divided by the weights that had data</span>
              <span className="text-ink-200">{math.knownWeight.toFixed(2)}</span>
            </div>
            <div className="flex justify-between border-t border-ink-800 pt-1.5 text-ink-300">
              <span>average</span>
              <span className="font-bold text-ink-100">{math.average}</span>
            </div>

            {math.knownWeight < math.allWeight && (
              <p className="pt-1 text-[10.5px] leading-relaxed text-ink-500">
                {Math.round((math.knownWeight / math.allWeight) * 100)}% of the things you
                care about had data. The rest are left out rather than guessed at
                {math.coverageCap !== undefined
                  ? `, and the score is held to ${math.coverageCap} until more is known — a half-researched house should not outrank one you know everything about.`
                  : '.'}
              </p>
            )}

            {math.cappedBy && (
              <div className="mt-2 rounded-lg border border-warn-400/25 bg-warn-400/[0.06] px-3 py-2">
                <div className="flex justify-between text-warn-400">
                  <span>capped at</span>
                  <span className="font-bold">{math.cappedBy.limit}</span>
                </div>
                <p className="mt-1 font-sans text-[11px] leading-relaxed text-ink-300">
                  {math.cappedBy.reason}
                </p>
              </div>
            )}

            {score !== undefined && (
              <div className="flex justify-between border-t border-ink-800 pt-1.5 text-ink-300">
                <span>final</span>
                <span className="font-bold text-ink-100">{score}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
