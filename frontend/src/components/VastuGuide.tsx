'use client';

/**
 * The Vastu cheatsheet.
 *
 * His sister sent thirteen screenshots and a long message. He asked for all of
 * it, losing nothing, in a form he can actually read — and asked explicitly
 * that our own rules NOT be changed yet, only checked against hers and the
 * disagreements shown.
 *
 * So this page is a reference, not a scorer. Nothing here feeds the match
 * score. Where her sources and our RULES table disagree, the disagreement is
 * printed rather than quietly resolved.
 */

import { useState } from 'react';
import { patchProfile } from '@/lib/api';
import type { PreferenceProfile } from '@/types/listing';
import {
  Compass, AlertTriangle, Check, X, Info, Ban, Home, Clock,
  Briefcase, Droplets, Flame, Sparkles, Landmark,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* A 16-point compass rose, drawn rather than described.                */
/* ------------------------------------------------------------------ */

type Ring = { dir: string; label: string; tone: 'good' | 'bad' | 'none'; note?: string };

/** 16 sectors, N at the top, clockwise — the order a compass reads. */
const SIXTEEN = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

function CompassRose({
  title, rings, caption,
}: { title: string; rings: Ring[]; caption?: string }) {
  const byDir = new Map(rings.map((r) => [r.dir, r]));
  const R = 128, r0 = 66, cx = 160, cy = 160;
  const seg = 360 / 16;

  const arc = (i: number) => {
    /* Each sector is centred on its bearing, so N straddles 348.75°–11.25°. */
    const a0 = (i * seg - seg / 2 - 90) * (Math.PI / 180);
    const a1 = (i * seg + seg / 2 - 90) * (Math.PI / 180);
    const p = (rad: number, rr: number) => `${cx + rr * Math.cos(rad)} ${cy + rr * Math.sin(rad)}`;
    return `M ${p(a0, r0)} L ${p(a0, R)} A ${R} ${R} 0 0 1 ${p(a1, R)} L ${p(a1, r0)} A ${r0} ${r0} 0 0 0 ${p(a0, r0)} Z`;
  };
  const labelPos = (i: number) => {
    const a = (i * seg - 90) * (Math.PI / 180);
    const rr = (R + r0) / 2;
    return { x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) };
  };

  const fill = (t?: Ring['tone']) =>
    t === 'good' ? 'rgb(34 197 94 / 0.22)' : t === 'bad' ? 'rgb(239 68 68 / 0.22)' : 'rgb(120 120 130 / 0.10)';
  const stroke = (t?: Ring['tone']) =>
    t === 'good' ? 'rgb(34 197 94 / 0.55)' : t === 'bad' ? 'rgb(239 68 68 / 0.55)' : 'rgb(120 120 130 / 0.3)';

  return (
    <figure className="m-0">
      <figcaption className="mb-2 text-[12px] font-semibold text-ink-200">{title}</figcaption>
      <svg viewBox="0 0 320 320" className="w-full max-w-[320px]" role="img" aria-label={title}>
        {SIXTEEN.map((d, i) => {
          const rg = byDir.get(d);
          const { x, y } = labelPos(i);
          return (
            <g key={d}>
              <path d={arc(i)} fill={fill(rg?.tone)} stroke={stroke(rg?.tone)} strokeWidth="1" />
              <text
                x={x} y={y + 3} textAnchor="middle"
                className="fill-ink-200"
                style={{ fontSize: d.length > 2 ? 8.5 : 11, fontWeight: d.length <= 2 ? 700 : 500 }}
              >
                {d}
              </text>
            </g>
          );
        })}
        <circle cx={cx} cy={cy} r={r0 - 3} fill="rgb(20 20 24 / 0.55)" stroke="rgb(120 120 130 / 0.25)" />
        <text x={cx} y={cy - 4} textAnchor="middle" className="fill-ink-400" style={{ fontSize: 10 }}>centre of</text>
        <text x={cx} y={cy + 9} textAnchor="middle" className="fill-ink-400" style={{ fontSize: 10 }}>the house</text>
        <text x={cx} y={26} textAnchor="middle" className="fill-ink-300" style={{ fontSize: 10, letterSpacing: 1 }}>▲ N</text>
      </svg>
      {caption && <p className="mt-1 text-[11.5px] leading-relaxed text-ink-400">{caption}</p>}
    </figure>
  );
}

/* ------------------------------------------------------------------ */

function Card({
  icon, title, children, tone,
}: { icon: React.ReactNode; title: string; children: React.ReactNode; tone?: 'warn' | 'bad' }) {
  const ring = tone === 'bad' ? 'border-bad-500/40 bg-bad-500/[0.05]'
    : tone === 'warn' ? 'border-warn-500/35 bg-warn-500/[0.05]'
    : 'border-ink-700 bg-ink-850';
  return (
    <section className={`rounded-xl border p-4 ${ring}`}>
      <h3 className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-ink-100">
        <span className="text-brand-400">{icon}</span>{title}
      </h3>
      <div className="space-y-1.5 text-[12.5px] leading-relaxed text-ink-300">{children}</div>
    </section>
  );
}

const Dir = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded bg-brand-500/12 px-1.5 py-px font-mono text-[11.5px] font-semibold text-brand-400">{children}</span>
);
const No = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded bg-bad-500/12 px-1.5 py-px font-mono text-[11.5px] font-semibold text-bad-400">{children}</span>
);

/* ------------------------------------------------------------------ */

const CLOCK: Ring[] = [
  { dir: 'N', tone: 'good', label: '' }, { dir: 'NNE', tone: 'good', label: '' },
  { dir: 'NE', tone: 'good', label: '' }, { dir: 'ENE', tone: 'good', label: '' },
  { dir: 'E', tone: 'good', label: '' }, { dir: 'ESE', tone: 'none', label: '' },
  { dir: 'SE', tone: 'bad', label: '' }, { dir: 'SSE', tone: 'bad', label: '' },
  { dir: 'S', tone: 'bad', label: '' }, { dir: 'SSW', tone: 'bad', label: '' },
  { dir: 'SW', tone: 'bad', label: '' }, { dir: 'WSW', tone: 'none', label: '' },
  { dir: 'W', tone: 'good', label: '' }, { dir: 'WNW', tone: 'good', label: '' },
  { dir: 'NW', tone: 'good', label: '' }, { dir: 'NNW', tone: 'good', label: '' },
];

/** The 16-fold toilet chart, from astroarunpandit. Only two zones need nothing. */
const TOILET: { dir: string; effect: string; tape: string; tone: 'good' | 'bad' | 'none' }[] = [
  { dir: 'N', effect: 'Hampers money and opportunity', tape: 'Blue', tone: 'bad' },
  { dir: 'NNE', effect: 'Affects health', tape: 'Blue', tone: 'bad' },
  { dir: 'NE', effect: 'Major health and prosperity issues', tape: 'NO REMEDY — remove the seat', tone: 'bad' },
  { dir: 'ENE', effect: 'Disrupts social harmony and happiness', tape: 'Green', tone: 'bad' },
  { dir: 'E', effect: 'Weak social network and growth', tape: 'Green', tone: 'bad' },
  { dir: 'ESE', effect: 'Taking less stress', tape: 'None needed', tone: 'good' },
  { dir: 'SE', effect: 'Weak cash flow', tape: 'Red', tone: 'bad' },
  { dir: 'SSE', effect: 'Weakens confidence, powerless feeling', tape: 'Red', tone: 'bad' },
  { dir: 'S', effect: 'Hurts reputation', tape: 'Red', tone: 'bad' },
  { dir: 'SSW', effect: 'Suitable direction', tape: 'None needed', tone: 'good' },
  { dir: 'SW', effect: 'Bad relationships, hampers peace', tape: 'Yellow', tone: 'bad' },
  { dir: 'WSW', effect: 'Financial drain, weak education', tape: 'White', tone: 'bad' },
  { dir: 'W', effect: 'Unfulfilled desires, fewer savings', tape: 'White', tone: 'bad' },
  { dir: 'WNW', effect: 'Mental unrest', tape: 'White', tone: 'bad' },
  { dir: 'NW', effect: 'Hinders progress', tape: 'Yellow', tone: 'bad' },
  { dir: 'NNW', effect: 'Reduces luck', tape: 'Blue', tone: 'bad' },
];

const CONTRADICTIONS = [
  {
    topic: 'Bathrooms',
    ours: 'Best: North-West and West. Acceptable: South. Worst: North-East, South-East.',
    hers: 'Only ESE and SSW need no remedy. NW "hinders progress" (yellow tape), W "unfulfilled desires, fewer savings" (white tape), SE is remediable with red tape.',
    verdict: 'Direct contradiction',
    detail: 'We call North-West and West the two BEST bathroom positions. Her 16-point chart calls both of them bad and prescribes tape for each. Her only two clean zones — ESE and SSW — are ones we do not rate at all. This is the biggest gap between the two systems.',
  },
  {
    topic: 'South-East bathroom',
    ours: 'Listed among the worst, alongside North-East.',
    hers: 'Bad, but remediable — red tape around the seat, keep lid and door closed. Only North-East is beyond remedy.',
    verdict: 'Severity differs',
    detail: 'We treat NE and SE as equally bad. She separates them sharply: NE is one of the two doshas with no remedy at all; SE is a cash-flow problem you can tape.',
  },
  {
    topic: 'South-West entrance',
    ours: 'Listed as "worst", scored the same as a south-facing door.',
    hers: 'One of only two doshas with NO remedy, the other being a North-East toilet. To be avoided at all times.',
    verdict: 'Severity differs',
    detail: 'Your one hard rule is the south-facing door. Her sources put a SOUTH-WEST entrance in the same un-fixable category. Worth deciding whether it should become a second hard rule.',
  },
  {
    topic: "Child's bedroom",
    ours: 'The ROOM should be in the West or North-West.',
    hers: 'Children who are studying should sleep with their HEAD to the west.',
    verdict: 'Different claim',
    detail: 'Not a contradiction — two different things. Hers is about which way the bed points, which no floor plan can tell us. Ours is about which part of the house the room sits in.',
  },
  {
    topic: 'Sleeping direction',
    ours: 'Not modelled at all.',
    hers: 'The earner should sleep with their head to the SOUTH.',
    verdict: 'We do not check this',
    detail: 'Nothing in a listing says which way a bed faces, so this can only ever be a thing you arrange after moving in — not a thing to choose a house on.',
  },
  {
    topic: 'Kitchen',
    ours: 'Best South-East, acceptable North-West, worst North-East and South-West.',
    hers: 'South-East, the fire zone. Cook facing East.',
    verdict: 'Agrees',
    detail: 'The one placement both systems state identically. She adds the direction the cook should face, which is a worktop decision, not a house decision.',
  },
  {
    topic: 'Primary bedroom',
    ours: 'Best South-West, acceptable South and West, worst North-East.',
    hers: 'Master bedroom in the South-West strengthens the primary relationship.',
    verdict: 'Agrees',
  },
  {
    topic: 'Prayer space',
    ours: 'Best North-East, acceptable North and East, worst South and South-West.',
    hers: 'Temple in the North-East corner. Never in a bedroom, never under the stairs. Sit facing East while praying.',
    verdict: 'Agrees, and adds two prohibitions',
    detail: 'The two "never" rules are about how a room is used, not where it is, so they are things to check on a tour rather than in the data.',
  },
  {
    topic: 'Main entrance',
    ours: 'Best East, North, North-East. Acceptable West, North-West. Worst South, South-West.',
    hers: 'Entrance should be well-lit and clutter-free. (No direction stated beyond the SW dosha.)',
    verdict: 'Agrees',
  },
  {
    topic: 'Living room',
    ours: 'Best North, North-East, East.',
    hers: 'The North-East corner should hold the pooja room, family seating, drawing room, study or meditation room.',
    verdict: 'Agrees',
  },
];

export function VastuGuide({
  profile, onProfileChanged, onSchoolChanged,
}: {
  profile: PreferenceProfile | null;
  onProfileChanged: (p: PreferenceProfile) => void;
  onSchoolChanged?: () => Promise<{ changed: number; of: number; biggest: number } | void>;
}) {
  const [openContra, setOpenContra] = useState<string | null>('Bathrooms');
  const [busy, setBusy] = useState(false);
  const [effect, setEffect] = useState<{ changed: number; of: number; biggest: number } | null>(null);
  const school = profile?.preferences?.vastuSchool ?? 'classical';

  const pick = async (s: 'classical' | 'mahavastu') => {
    if (!profile || s === school || busy) return;
    setBusy(true);
    try {
      onProfileChanged(await patchProfile({ preferences: { vastuSchool: s } }));
      setEffect((await onSchoolChanged?.()) || null);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5 pb-10">
      {/* ---------------------------- header ---------------------------- */}
      <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink-100">
          <Compass size={16} className="text-brand-400" /> Vastu cheatsheet
        </h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-400">
          Everything your sister sent, in one place. Nothing on this page feeds the match score —
          it is a reference for walking houses and for arranging the one you buy. Where her
          sources and this app&rsquo;s rules disagree, the disagreement is shown rather than resolved.
        </p>
      </div>

      {/* --------------------------- the school ------------------------- */}
      <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink-100">
          <Compass size={14} className="text-brand-400" /> Which school the reading follows
        </h3>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-400">
          The two systems genuinely disagree about bathrooms, and neither is wrong. This changes
          the Vastu reading on every house. It does <strong className="text-ink-300">not</strong> touch
          the match score — no Vastu number has ever been in it.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {([
            ['classical', 'Classical — 8 directions',
             'North-west is the good place for a bathroom, south-east the second choice. The mainstream reading, and what this app has always used.'],
            ['mahavastu', 'MahaVastu — 16 zones',
             'What your sister follows. No bathroom position is simply good; north-west "hinders progress" and west costs savings. Only ESE and SSW need no remedy.'],
          ] as const).map(([k, title, blurb]) => (
            <button
              key={k}
              onClick={() => pick(k)}
              disabled={busy || !profile}
              className={`rounded-lg border p-3 text-left transition disabled:opacity-50
                ${school === k
                  ? 'border-brand-500/60 bg-brand-500/10'
                  : 'border-ink-700 hover:border-ink-600'}`}
            >
              <span className={`flex items-center gap-1.5 text-[12.5px] font-semibold
                ${school === k ? 'text-brand-400' : 'text-ink-200'}`}>
                {school === k && <Check size={12} />}{title}
              </span>
              <span className="mt-1 block text-[11.5px] leading-relaxed text-ink-400">{blurb}</span>
            </button>
          ))}
        </div>
        {(busy || effect) && (
          <p className={`mt-2.5 rounded-lg border px-3 py-2 text-[12px] ${
            busy ? 'border-ink-700 text-ink-400'
              : effect && effect.changed > 0
                ? 'border-brand-500/40 bg-brand-500/[0.07] text-brand-400'
                : 'border-ink-700 text-ink-400'}`}>
            {busy
              ? 'Re-reading every house…'
              : effect && effect.changed > 0
                ? `Re-read ${effect.of} houses — ${effect.changed} changed, the biggest by ${effect.biggest} points. `
                  + 'Open any house to see it on the Bathrooms line.'
                : `Re-read ${effect?.of ?? 0} houses — none changed. Nothing on this list has a bathroom position the two schools disagree about.`}
          </p>
        )}
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-500">
          Not a geography question. The solar reasoning behind these directions assumes the sun
          crossing the southern sky, which holds at 34°N in Atlanta just as at 28°N in Delhi. It is
          the southern hemisphere where practitioners split — and they disagree with each other there too.
        </p>
      </div>

      {/* ------------------------ the two hard ones --------------------- */}
      <Card icon={<Ban size={14} />} title="The two faults with no remedy" tone="bad">
        <p className="text-ink-200">
          Everything else in Vastu has a fix. These two do not, and both are decided
          <em> before</em> you buy:
        </p>
        <ul className="mt-2 space-y-2">
          <li className="flex gap-2.5">
            <No>NE</No>
            <span><strong className="text-ink-100">Toilet in the North-East.</strong> Tape and closed doors
              are not considered enough — the seat has to come out of that zone.</span>
          </li>
          <li className="flex gap-2.5">
            <No>SW</No>
            <span><strong className="text-ink-100">Entrance in the South-West.</strong> No remedy at all.</span>
          </li>
        </ul>
        <p className="mt-2.5 border-t border-ink-700 pt-2.5 text-[12px] text-ink-400">
          These are the only two worth refusing a house over. Everything below is arrangeable
          once you own it.
        </p>
      </Card>

      {/* --------------------------- by room ---------------------------- */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card icon={<Home size={14} />} title="Where each room belongs">
          <p><Dir>NE</Dir> Prayer room / temple, family seating, drawing room, study, meditation. Guest room.</p>
          <p><Dir>SE</Dir> Kitchen — the fire corner. Cook facing <strong className="text-ink-100">East</strong>.</p>
          <p><Dir>SW</Dir> Master bedroom. Strengthens the primary relationship.</p>
          <p><Dir>W / NW</Dir> Children&rsquo;s rooms.</p>
          <p><Dir>N / NE / E</Dir> Living and shared space.</p>
          <p className="pt-1.5 text-ink-400">Heavier things — staircases, storage — to the <strong className="text-ink-200">South and West</strong>.
            Lighter, open, glassy space to the <strong className="text-ink-200">North and East</strong>.</p>
        </Card>

        <Card icon={<Landmark size={14} />} title="The prayer room">
          <p><Check size={12} className="mr-1 inline text-good-400" />North-East corner of the home.</p>
          <p><Check size={12} className="mr-1 inline text-good-400" />Sit facing <strong className="text-ink-100">East</strong> while praying.</p>
          <p><X size={12} className="mr-1 inline text-bad-400" />Never inside a bedroom.</p>
          <p><X size={12} className="mr-1 inline text-bad-400" />Never a small shrine tucked under the stairs.</p>
          <p className="pt-1.5 text-ink-400">Both prohibitions are about how a room gets used, so they are tour
            questions rather than listing questions.</p>
        </Card>

        <Card icon={<Sparkles size={14} />} title="Money and valuables">
          <p><Dir>SW</Dir> Locker or safe in the South-West corner, door opening towards
            <strong className="text-ink-100"> North</strong>.</p>
          <p className="pl-1 text-ink-400">A mirror inside the locker is said to multiply what it holds.</p>
          <p><No>SE</No> <strong className="text-ink-100">Never a safe in the South-East.</strong> That is the Agni
            (fire) zone — the tradition says wealth kept there burns off through unexpected medical bills,
            vehicle breakdowns and poor investments.</p>
          <p><Dir>W</Dir> A bowl of coins on the West side (270° on a compass). Whatever sits
            in this direction is said to multiply.</p>
        </Card>

        <Card icon={<Droplets size={14} />} title="Walls, colour and the fire corner">
          <p><Dir>N</Dir> North wall: blue, or a water element — a waterfall painting works.
            <strong className="text-ink-100"> Avoid red on the north wall.</strong></p>
          <p><Dir>S</Dir> South wall: red, or red paintings — a rose. A peacock painting is also good.</p>
          <p><Dir>NNE</Dir> Medicines and medical reports just before the temple area.</p>
          <p><Dir>SE</Dir> A red bulb kept lit at all times in the South-East — the agni kon.
            No water element there.</p>
          <p className="text-warn-400"><AlertTriangle size={12} className="mr-1 inline" />
            If there is a toilet in the South-East, do <strong>not</strong> add the bulb.</p>
        </Card>
      </div>

      {/* ------------------------- mirrors & clocks --------------------- */}
      <div className="grid gap-4 md:grid-cols-[320px_1fr]">
        <Card icon={<Clock size={14} />} title="Clocks and mirrors">
          <p>All mirrors and clocks on the <strong className="text-ink-100">north wall</strong> of any room.</p>
          <p className="text-ink-400">The general rule behind it: whatever you place in front of a mirror
            keeps on increasing.</p>
          <div className="mt-3 space-y-1 border-t border-ink-700 pt-2.5 text-[12px]">
            <p className="text-good-400"><Check size={11} className="mr-1 inline" />
              <strong>N</strong> growth, opportunity, career and financial stability</p>
            <p className="text-good-400"><Check size={11} className="mr-1 inline" />
              <strong>E</strong> health, happiness, reputation, harmony</p>
            <p className="text-good-400"><Check size={11} className="mr-1 inline" />
              <strong>W</strong> goals and success, stability, children&rsquo;s growth</p>
            <p className="text-good-400"><Check size={11} className="mr-1 inline" />
              <strong>NE</strong> very auspicious — spiritual growth, wisdom, peace</p>
            <p className="text-good-400"><Check size={11} className="mr-1 inline" />
              <strong>NW</strong> relationships, communication, travel, networking</p>
            <p className="text-bad-400"><X size={11} className="mr-1 inline" />
              <strong>S</strong> financial losses, instability, stress, delays</p>
            <p className="text-bad-400"><X size={11} className="mr-1 inline" />
              <strong>SE</strong> anger, money drains, health issues, fights</p>
            <p className="text-bad-400"><X size={11} className="mr-1 inline" />
              <strong>SW</strong> heaviness, stagnant energy, debts, no mental peace</p>
          </div>
        </Card>
        <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
          <CompassRose
            title="Wall clock — where it helps and where it hurts"
            rings={CLOCK}
            caption="Green is favourable, red is not, grey is unstated. North through West via the top of the compass is the safe half; the entire southern arc is the one to avoid."
          />
        </div>
      </div>

      {/* ----------------------------- desk ----------------------------- */}
      <Card icon={<Briefcase size={14} />} title="Working from home">
        <div className="grid gap-2 sm:grid-cols-3">
          <p><Dir>Face N</Dir> for a <strong className="text-ink-100">job</strong> — attracts growth and opportunities.</p>
          <p><Dir>Face E</Dir> for a <strong className="text-ink-100">business</strong> — boosts success and visibility.</p>
          <p><No>Never face S</No> leads to stress, delays and blocks.</p>
        </div>
        <p className="pt-1.5 text-ink-400">Back to a solid wall — said to give stability, confidence and support.</p>
      </Card>

      {/* --------------------------- entrance --------------------------- */}
      <Card icon={<Home size={14} />} title="The entrance">
        <p>Well-lit and clutter-free.</p>
        <p><No>Shoe rack</No> never at the main door, and never in the North-East — said to block
          opportunities. Best in the <Dir>WNW</Dir>, and covered.</p>
      </Card>

      {/* ---------------------------- toilets --------------------------- */}
      <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
        <h3 className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-ink-100">
          <Flame size={14} className="text-brand-400" /> Toilets — the full 16-point chart
        </h3>
        <p className="mb-3 text-[12px] text-ink-400">
          &ldquo;Blocking the seat&rdquo; means tape around three or four sides of it, roughly 3–4 inches wide.
          Only two of the sixteen zones need nothing at all.
        </p>
        <div className="grid gap-4 md:grid-cols-[320px_1fr] md:items-start">
          <CompassRose
            title="Toilet position"
            rings={TOILET.map((t) => ({ dir: t.dir, label: '', tone: t.tone }))}
            caption="Green = nothing needed. Red = remediable with tape, except the North-East, which is not remediable at all."
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[380px] text-[12px]">
              <thead>
                <tr className="border-b border-ink-700 text-left text-ink-500">
                  <th className="py-1.5 pr-2 font-medium">Zone</th>
                  <th className="py-1.5 pr-2 font-medium">What it is said to cause</th>
                  <th className="py-1.5 font-medium">Tape</th>
                </tr>
              </thead>
              <tbody>
                {TOILET.map((t) => (
                  <tr key={t.dir} className={`border-b border-ink-800 ${t.tone === 'good' ? 'bg-good-500/[0.06]' : ''}`}>
                    <td className="py-1.5 pr-2 font-mono font-semibold text-ink-200">{t.dir}</td>
                    <td className="py-1.5 pr-2 text-ink-400">{t.effect}</td>
                    <td className={`py-1.5 font-medium ${
                      t.tape.startsWith('NO') ? 'text-bad-400'
                      : t.tape === 'None needed' ? 'text-good-400' : 'text-ink-300'}`}>{t.tape}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="mt-3 space-y-1.5 border-t border-ink-700 pt-3 text-[12.5px] text-ink-300">
          <p className="font-semibold text-ink-200">Remedies that apply to any wrongly placed toilet</p>
          <p>Position the seat so the user faces <strong className="text-ink-100">North or South</strong> — never East or West.</p>
          <p>Keep the bathroom door closed at all times, and the lid down when not in use.</p>
          <p className="text-warn-400"><AlertTriangle size={12} className="mr-1 inline" />
            A North-East toilet is the exception. Many consultants hold that the small fixes do not
            correct it and the seat must be removed from that zone.</p>
        </div>
      </div>

      {/* ------------------------ contradictions ------------------------ */}
      <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">
        <h3 className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-ink-100">
          <Info size={14} className="text-brand-400" /> How this compares with the app&rsquo;s rules
        </h3>
        <p className="mb-3 text-[12px] text-ink-400">
          Ten placements checked. Nothing has been changed — you said not yet.
        </p>
        <div className="space-y-1.5">
          {CONTRADICTIONS.map((c) => {
            const bad = c.verdict === 'Direct contradiction';
            const differs = c.verdict.startsWith('Severity') || c.verdict === 'Different claim' || c.verdict.startsWith('We do not');
            const open = openContra === c.topic;
            return (
              <div key={c.topic} className={`rounded-lg border ${
                bad ? 'border-bad-500/40 bg-bad-500/[0.05]'
                : differs ? 'border-warn-500/30 bg-warn-500/[0.04]'
                : 'border-ink-700'}`}>
                <button
                  onClick={() => setOpenContra(open ? null : c.topic)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                >
                  <span className="text-[12.5px] font-semibold text-ink-100">{c.topic}</span>
                  <span className={`shrink-0 rounded px-2 py-0.5 text-[10.5px] font-semibold ${
                    bad ? 'bg-bad-500/15 text-bad-400'
                    : differs ? 'bg-warn-500/15 text-warn-400'
                    : 'bg-good-500/12 text-good-400'}`}>{c.verdict}</span>
                </button>
                {open && (
                  <div className="space-y-1.5 border-t border-ink-700/60 px-3 py-2.5 text-[12px] leading-relaxed">
                    <p><span className="text-ink-500">This app:</span> <span className="text-ink-300">{c.ours}</span></p>
                    <p><span className="text-ink-500">Her sources:</span> <span className="text-ink-300">{c.hers}</span></p>
                    {c.detail && <p className="border-t border-ink-800 pt-1.5 text-ink-400">{c.detail}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="px-1 text-[11.5px] leading-relaxed text-ink-500">
        Written as &ldquo;the tradition says&rdquo;, because that is what it is — a body of belief with real
        cultural weight and no engineering behind it. Sources: the message from your sister, plus
        rakhejain_vastu, astroarunpandit, anantam_vastu, consultroopam and swastik.vaastu.
      </p>
    </div>
  );
}
