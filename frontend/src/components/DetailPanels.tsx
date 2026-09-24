'use client';

import { useState } from 'react';
import {
  Compass, HeartPulse, Wrench, Handshake, ChevronDown, Check, Minus, AlertTriangle,
  Lightbulb, TrendingDown, Clock, Footprints, HelpCircle,
} from 'lucide-react';

/* These four panels report things that sit NEXT to the score and never inside
   it. The Vastu reading beyond the south-facing rule is a set of beliefs he
   asked to see, not to be ranked on. Health and systems are things to inspect
   or budget for. Negotiation is advice about a house he already likes. */

function Section({ icon: Icon, title, subtitle, children, defaultOpen = false }: {
  icon: typeof Compass; title: string; subtitle?: string;
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-850">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-5 py-3.5 text-left hover:bg-ink-800/60"
      >
        <Icon size={15} className="shrink-0 text-brand-400" />
        <span className="text-sm font-semibold uppercase tracking-wider text-ink-300">{title}</span>
        {subtitle && <span className="truncate text-[12px] text-ink-500">— {subtitle}</span>}
        <ChevronDown
          size={15}
          className={`ml-auto shrink-0 text-ink-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="border-t border-ink-700 px-5 py-4">{children}</div>}
    </section>
  );
}

/* ----------------------------- highlights ----------------------------- */

interface Highlight { label: string; detail: string; tone: 'good' | 'neutral' | 'watch' }

const TONE = {
  good:    { dot: 'bg-good-400',    text: 'text-good-400' },
  neutral: { dot: 'bg-brand-400',   text: 'text-brand-400' },
  watch:   { dot: 'bg-warn-400',    text: 'text-warn-400' },
} as const;

/**
 * Reported, never scored. These are either things where the preference is not
 * settled (how much is a finished basement worth to you?) or where two
 * defensible views disagree (which way should a back garden face). Baking a
 * guess into the ranking would decide those quietly.
 */
export function HighlightsPanel({ highlights }: { highlights?: Highlight[] }) {
  if (!highlights?.length) return null;
  return (
    <Section
      icon={Lightbulb}
      title="Worth knowing"
      subtitle={`${highlights.length} thing${highlights.length === 1 ? '' : 's'} that don't affect the score`}
      defaultOpen
    >
      <div className="space-y-3.5">
        {highlights.map((h) => (
          <div key={h.label} className="flex gap-2.5">
            <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${TONE[h.tone].dot}`} />
            <div>
              <p className={`text-[12.5px] font-semibold ${TONE[h.tone].text}`}>{h.label}</p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-400">{h.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------- vastu ------------------------------- */

/* Four verdicts, four different icons.
   "Acceptable" and "unknown" were both a dash, distinguished only by how grey
   they were — so a room nobody has read looked identical to one that had been
   read and judged fine. Those are opposite facts and must not share a glyph. */
const MARK = {
  favourable:   { icon: Check,         cls: 'text-good-400', word: 'as the tradition wants it' },
  acceptable:   { icon: Minus,         cls: 'text-ink-300',  word: 'neither favoured nor warned against' },
  unfavourable: { icon: AlertTriangle, cls: 'text-warn-400', word: 'a placement the tradition warns about' },
  unknown:      { icon: HelpCircle,    cls: 'text-ink-600',  word: 'not readable from the plan' },
} as const;

interface Reading {
  element: string; theme: string; actual: string;
  ideal: string; verdict: keyof typeof MARK; says: string;
}

export function VastuPanel({ vastu }: {
  vastu?: { readings: Reading[]; note: string; score?: number; known?: number; of?: number };
}) {
  if (!vastu?.readings?.length) return null;

  const byTheme = new Map<string, Reading[]>();
  for (const r of vastu.readings) {
    if (!byTheme.has(r.theme)) byTheme.set(r.theme, []);
    byTheme.get(r.theme)!.push(r);
  }

  const known = vastu.readings.filter((r) => r.verdict !== 'unknown').length;

  return (
    <Section
      icon={Compass}
      title="Vastu reading"
      subtitle={vastu.score !== undefined
        ? `${vastu.score}/100 · ${known} of ${vastu.readings.length} placements known`
        : `${known} of ${vastu.readings.length} placements known`}
      defaultOpen
    >
      {vastu.score !== undefined && (
        <div className="mb-4 flex items-baseline gap-3 rounded-xl border border-saffron-500/25 bg-saffron-500/[0.06] px-4 py-3">
          <span className="font-mono text-3xl font-bold text-saffron-400">{vastu.score}</span>
          <span className="text-[11.5px] leading-snug text-ink-400">
            out of 100, weighted toward the entrance and counting only placements
            that could be read.
            <br />
            <span className="text-ink-500">
              Reported, not scored — it does not move the match number. Only the
              south-facing rule does that.
            </span>
          </span>
        </div>
      )}

      {/* What the four marks mean, once, rather than left to be guessed. */}
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
        {(Object.entries(MARK) as [keyof typeof MARK, typeof MARK[keyof typeof MARK]][])
          .map(([k, m]) => (
            <span key={k} className="inline-flex items-center gap-1 text-[10.5px] text-ink-500">
              <m.icon size={11} className={m.cls} />
              {m.word}
            </span>
          ))}
      </div>
      <p className="mb-4 rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-2 text-[11.5px] leading-relaxed text-ink-400">
        Only one of these affects the score: a south-facing front door rules a house
        out. The rest is reported because you asked to see it, and because it is
        what the tradition says rather than something anyone can measure. Read it,
        argue with it, ask your parents.
        <br /><br />
        <span className="text-ink-500">{vastu.note}</span>
      </p>

      <div className="space-y-4">
        {[...byTheme.entries()].map(([theme, rows]) => (
          <div key={theme}>
            <h4 className="mb-1.5 font-mono text-[10.5px] uppercase tracking-widest text-saffron-400">
              {theme}
            </h4>
            <div className="space-y-2">
              {rows.map((r) => {
                const m = MARK[r.verdict];
                const Icon = m.icon;
                return (
                  <div key={r.element} className="flex gap-2.5">
                    <Icon size={13} className={`mt-0.5 shrink-0 ${m.cls}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-[12.5px] font-medium text-ink-200">{r.element}</span>
                        <span className={`font-mono text-[12px] ${m.cls}`}>
                          {r.actual === 'Unknown' ? 'not readable' : r.actual}
                        </span>
                        <span className="font-mono text-[10.5px] text-ink-500">
                          classical: {r.ideal}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-ink-500">{r.says}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* --------------------------- health & systems --------------------------- */

interface Advisory { label: string; detail: string; severity: 'watch' | 'check' | 'budget' }

const SEV = {
  watch: 'text-good-400',
  check: 'text-warn-400',
  budget: 'text-brand-400',
} as const;

export function HealthPanel({ health, systems }: {
  health?: Advisory[];
  systems?: { advisories: Advisory[]; assumedFromYearBuilt: boolean };
}) {
  const h = health ?? [];
  const s = systems?.advisories ?? [];
  if (!h.length && !s.length) return null;

  const row = (a: Advisory) => (
    <div key={a.label} className="flex gap-2.5">
      <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current ${SEV[a.severity]}`} />
      <div>
        <p className={`text-[12.5px] font-medium ${SEV[a.severity]}`}>{a.label}</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-400">{a.detail}</p>
      </div>
    </div>
  );

  return (
    <Section
      icon={h.length ? HeartPulse : Wrench}
      title="Health & big-ticket systems"
      subtitle={`${h.length} health note${h.length === 1 ? '' : 's'}, ${s.length} system${s.length === 1 ? '' : 's'}`}
    >
      {h.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 font-mono text-[10.5px] uppercase tracking-widest text-saffron-400">
            What a house of this vintage may contain
          </h4>
          <div className="space-y-2.5">{h.map(row)}</div>
        </div>
      )}
      {s.length > 0 && (
        <div>
          <h4 className="mb-2 font-mono text-[10.5px] uppercase tracking-widest text-saffron-400">
            Roof, HVAC and the rest
          </h4>
          <div className="space-y-2.5">{s.map(row)}</div>
          {systems?.assumedFromYearBuilt && (
            <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
              Anything without an install year is assumed original to the build. Listing
              remarks usually mention these when they are new, because it is a selling
              point — add the years and these turn from costs into assets.
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

/* ------------------------------- nearby ------------------------------- */

interface Place {
  name: string; category: string; type: string; metres: number; walkMinutes: number;
}

/**
 * What you could actually walk to.
 *
 * These were being fetched, scored into walkability, and then never shown —
 * which made the number unarguable. "Walk Score 41" tells you nothing you can
 * check; "Midway Park is 300 m away, five minutes with the stroller" is the
 * thing the household actually asked about.
 */
export function NearbyPanel({ nearby }: {
  nearby?: { places: Place[]; nearestParkMetres?: number; note: string };
}) {
  if (!nearby?.places?.length) return null;

  const byCategory = new Map<string, Place[]>();
  for (const p of nearby.places) {
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category)!.push(p);
  }

  const park = nearby.nearestParkMetres;

  return (
    <Section
      icon={Footprints}
      title="Within walking distance"
      subtitle={park ? `nearest park ${(park / 1000).toFixed(1)} km` : `${nearby.places.length} places`}
      defaultOpen
    >
      <div className="space-y-4">
        {[...byCategory.entries()].map(([cat, places]) => (
          <div key={cat}>
            <h4 className="mb-1.5 font-mono text-[10.5px] uppercase tracking-widest text-saffron-400">
              {cat}
            </h4>
            <div className="space-y-1">
              {places.map((p) => (
                <div key={p.name} className="flex items-baseline gap-2 text-[12px]">
                  <span className="min-w-0 flex-1 truncate text-ink-200">{p.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-ink-400">
                    {p.metres < 1000 ? `${p.metres} m` : `${(p.metres / 1000).toFixed(1)} km`}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-ink-500">
                    {p.walkMinutes} min
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
        {nearby.note} Walking times are at an unhurried stroller pace, not an adult's.
      </p>
    </Section>
  );
}

/* ------------------------------ the street ------------------------------ */

interface Comp {
  address: string; url: string; price: number; sqft: number; pricePerSqft: number;
  status: string; metresAway: number; isNewConstruction: boolean; cutPct?: number;
  beds: number; yearBuilt: number;
}

/**
 * What the neighbours are asking, and how many have already blinked.
 *
 * An asking price alone says nothing. Eight houses within a mile, three of them
 * already cut, is the difference between opening at a number and defending one.
 */
export function MarketPanel({ market }: {
  market?: {
    comps: Comp[]; comingSoon: Comp[]; medianPricePerSqft?: number;
    cutting?: { count: number; of: number; averagePct: number }; summary: string;
    suggestions?: { comp: Comp & { beds: number; yearBuilt: number }; reasons: string[] }[];
  };
}) {
  if (!market?.comps?.length) return null;
  const money = (v: number) => `$${v.toLocaleString()}`;

  return (
    <Section
      icon={TrendingDown}
      title="The street"
      subtitle={market.cutting?.count
        ? `${market.cutting.count} of ${market.cutting.of} nearby have cut`
        : `${market.comps.length} comparables`}
    >
      <p className="mb-4 text-[12.5px] leading-relaxed text-ink-200">{market.summary}</p>

      <div className="overflow-x-auto rounded-xl border border-ink-700">
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-ink-500">
              <th className="px-3 py-2 font-medium">Nearby</th>
              <th className="px-3 py-2 text-right font-medium">Asking</th>
              <th className="px-3 py-2 text-right font-medium">$/sqft</th>
              <th className="px-3 py-2 text-right font-medium">Cut</th>
            </tr>
          </thead>
          <tbody>
            {market.comps.slice(0, 8).map((c) => (
              <tr key={c.url} className="border-t border-ink-800">
                <td className="px-3 py-1.5 text-ink-300">
                  <a href={c.url} target="_blank" rel="noreferrer" className="hover:text-brand-400">
                    {c.address.split(',')[0]}
                  </a>
                  <span className="ml-1.5 font-mono text-[10px] text-ink-600">
                    {(c.metresAway / 1000).toFixed(1)}km
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-ink-200">{money(c.price)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-ink-400">{c.pricePerSqft || '—'}</td>
                <td className={`px-3 py-1.5 text-right font-mono ${c.cutPct ? 'text-good-400' : 'text-ink-600'}`}>
                  {c.cutPct ? `-${c.cutPct.toFixed(1)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(market.suggestions?.length ?? 0) > 0 && (
        <div className="mt-4 rounded-xl border border-good-500/30 bg-good-500/[0.05] p-4">
          <h4 className="mb-2 font-mono text-[10.5px] uppercase tracking-widest text-good-400">
            Nearby, and looks like a better buy
          </h4>
          <div className="space-y-3">
            {market.suggestions!.map((s) => (
              <div key={s.comp.url}>
                <a
                  href={s.comp.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex flex-wrap items-baseline gap-x-2.5 text-[12.5px] font-semibold text-ink-100 hover:text-good-400"
                >
                  {s.comp.address.split(',')[0]}
                  <span className="font-mono text-[11.5px] text-ink-300">{money(s.comp.price)}</span>
                  <span className="font-mono text-[10.5px] text-ink-500">
                    {s.comp.sqft.toLocaleString()} sq ft · {s.comp.yearBuilt}
                  </span>
                </a>
                <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {s.reasons.map((r) => (
                    <li key={r} className="text-[11px] text-good-400">· {r}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-2.5 text-[11px] leading-relaxed text-ink-500">
            Only shown when a nearby home beats this one on at least two counts, and
            passes your budget, age and lot floors. Paste the link in to score it properly.
          </p>
        </div>
      )}

      {market.comingSoon.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-widest text-saffron-400">
            <Clock size={11} /> Coming soon — not marketed yet
          </h4>
          <div className="space-y-1">
            {market.comingSoon.map((c) => (
              <a
                key={c.url}
                href={c.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-baseline justify-between gap-3 rounded-lg border border-ink-700 px-3 py-1.5 text-[11.5px] transition hover:border-saffron-500/40"
              >
                <span className="truncate text-ink-300">
                  {c.address.split(',')[0]}
                  {c.isNewConstruction && (
                    <span className="ml-2 rounded bg-saffron-500/15 px-1.5 py-0.5 font-mono text-[9.5px] text-saffron-400">
                      new build
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-ink-200">{money(c.price)}</span>
              </a>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
            These are listed but not yet on the market properly — the window before
            everyone else sees them.
          </p>
        </div>
      )}
    </Section>
  );
}

/* ---------------------------- negotiation ---------------------------- */

export function NegotiationPanel({ n }: {
  n?: {
    openAt: number; expect: number; walkAway: number; reachable: boolean;
    anchor?: number; arguments?: string[];
    leverage: number; signals: string[]; strategy: string;
  };
}) {
  if (!n) return null;
  const money = (v: number) => `$${v.toLocaleString()}`;

  return (
    <Section
      icon={Handshake}
      title="What to offer"
      subtitle={`open ${money(n.openAt)} · expect ${money(n.expect)}`}
      defaultOpen
    >
      {n.anchor && (
        <p className="mb-3 text-[12px] text-ink-400">
          Every number below is priced off the{' '}
          <span className="font-mono text-ink-200">${n.anchor.toLocaleString()}</span> valuation, not
          off what they are asking — otherwise raising the ask would raise your offer with it.
        </p>
      )}

      <div className="grid grid-cols-3 gap-3">
        {[
          ['Open at', n.openAt, 'text-brand-400'],
          ['Likely landing', n.expect, n.reachable ? 'text-good-400' : 'text-warn-400'],
          ['Walk away', n.walkAway, 'text-bad-400'],
        ].map(([label, value, cls]) => (
          <div key={label as string} className="rounded-xl border border-ink-700 bg-ink-900/60 p-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink-500">
              {label as string}
            </p>
            <p className={`mt-1 font-mono text-lg font-bold ${cls as string}`}>
              {money(value as number)}
            </p>
          </div>
        ))}
      </div>

      {!n.reachable && (
        <p className="mt-3 rounded-lg border border-warn-400/25 bg-warn-400/[0.07] px-3 py-2 text-[12px] leading-relaxed text-warn-400">
          The evidence does not support getting this inside your ceiling. That does not
          make it unwinnable — it makes it a house where you should decide the walk-away
          now, not at the table.
        </p>
      )}

      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-200">{n.strategy}</p>

      {(n.arguments?.length ?? 0) > 0 && (
        <div className="mt-4 rounded-xl border border-ink-700 bg-ink-900/60 p-4">
          <h4 className="mb-2 font-mono text-[10.5px] uppercase tracking-widest text-saffron-400">
            What to say, in this order
          </h4>
          <ol className="space-y-2">
            {n.arguments!.map((a, i) => (
              <li key={i} className="flex gap-2.5 text-[12px] leading-relaxed text-ink-300">
                <span className="font-mono text-[11px] text-ink-500">{i + 1}.</span>
                {a}
              </li>
            ))}
          </ol>
        </div>
      )}

      {n.signals.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {n.signals.map((s, i) => (
            <li key={i} className="flex gap-2 text-[11.5px] leading-relaxed text-ink-400">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-500" />
              {s}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 font-mono text-[10.5px] text-ink-500">
        Leverage read from days on market, price cuts and the listing's own estimate —
        about {(n.leverage * 100).toFixed(0)}% of ask.
      </p>
    </Section>
  );
}

/* --------------------------- the same plan --------------------------- */

/**
 * What this drawing scores turned each way, and who else has it.
 *
 * Builders reuse four or five plans across every community, so the identical
 * house sits on lots facing every direction. The plan fixes where the kitchen
 * is on the page; the lot decides what that means on a compass. Where the same
 * plan sits on two lots at similar money, one is simply turned the better way,
 * and nobody at the sales office is going to mention it.
 */
export function PlanFamilyPanel({ plan, siblings, onSelect }: {
  plan?: {
    byFacing: { direction: string; score: number }[];
    best: { direction: string; score: number };
    current?: number;
    forgone?: number;
  };
  siblings?: { id: string; address: string; price: number; facing: string; score: number; better: number }[];
  onSelect?: (id: string) => void;
}) {
  if (!plan?.byFacing?.length) return null;
  const top = Math.max(...plan.byFacing.map((f) => f.score));

  return (
    <Section
      icon={Compass}
      title="This plan, turned other ways"
      subtitle={plan.forgone && plan.forgone > 4
        ? `${plan.forgone} points below what this drawing can do on a better lot`
        : 'On about the best orientation this drawing gets'}
      /* Open when there is a finding: this lot is turned the wrong way, or the
         same house exists on another street. A collapsed panel is a panel
         nobody reads, and "there is an identical house two doors down facing
         east" is not a footnote. */
      defaultOpen={(plan.forgone ?? 0) > 4 || (siblings?.length ?? 0) > 0}
    >
      <div className="grid grid-cols-7 gap-1">
        {plan.byFacing.map((f) => {
          const isNow = plan.current !== undefined && f.score === plan.current
            && f.direction === plan.byFacing.find((x) => x.score === plan.current)?.direction;
          return (
            <div
              key={f.direction}
              className={`rounded-lg border px-1 py-1.5 text-center ${
                isNow ? 'border-brand-500/60 bg-brand-500/10'
                : f.score === top ? 'border-good-500/40 bg-good-500/[0.07]'
                : 'border-ink-700'}`}
            >
              <div className="font-mono text-[9.5px] uppercase tracking-wide text-ink-500">
                {f.direction.replace('North', 'N').replace('East', 'E')
                  .replace('South', 'S').replace('West', 'W').replace('-', '')}
              </div>
              <div className={`font-mono text-[13px] font-bold ${
                isNow ? 'text-brand-400' : f.score === top ? 'text-good-400' : 'text-ink-300'}`}>
                {f.score}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
        Blue is the way this one actually faces; green is the best this drawing
        gets. South is left out — it is ruled out however it scores.
      </p>

      {(siblings?.length ?? 0) > 0 && (
        <div className="mt-3 border-t border-ink-700 pt-3">
          <p className="mb-2 text-[11px] uppercase tracking-wider text-ink-500">
            The same drawing on {siblings!.length} other lot{siblings!.length > 1 ? 's' : ''}
          </p>
          <ul className="space-y-1.5">
            {siblings!.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => onSelect?.(s.id)}
                  className="flex w-full items-baseline gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-ink-800"
                >
                  <span className={`font-mono text-[12px] font-bold ${
                    s.better > 0 ? 'text-good-400' : s.better < 0 ? 'text-ink-500' : 'text-ink-300'}`}>
                    {s.score}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-200">
                    {s.address.split(',')[0]}
                  </span>
                  <span className="font-mono text-[11px] text-ink-500">
                    ${Math.round(s.price / 1000)}k · {s.facing}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
            Same house, different lot. If one of these scores higher it is
            because of which way the driveway points, not because it is a better
            house — worth knowing before you pick a lot.
          </p>
        </div>
      )}
    </Section>
  );
}
