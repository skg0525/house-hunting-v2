'use client';

import { useRef, useState } from 'react';
import { Lock, SlidersHorizontal, Loader2, RotateCcw } from 'lucide-react';
import { patchProfile } from '@/lib/api';
import type { PreferenceProfile, DimensionKey } from '@/types/listing';

const LABELS: Record<DimensionKey, string> = {
  direction: 'Facing direction',
  kitchen: 'Kitchen & living space',
  commute: 'Commute & distance',
  mainFloorSuite: 'Main-floor bed + bath',
  yard: 'Backyard size',
  walkability: 'Walkability',
  schools: 'Schools',
  diversity: 'Neighbourhood mix',
  appreciation: 'Holds its value',
  maintenance: 'Age & upkeep',
  value: 'Price for what you get',
};

const ORDER: DimensionKey[] = [
  'yard', 'kitchen', 'commute', 'value', 'walkability', 'appreciation', 'schools',
  'diversity', 'mainFloorSuite', 'direction', 'maintenance',
];

/**
 * What you want, and how much.
 *
 * Moving a slider re-ranks every house immediately and costs nothing — the
 * expensive part (reading the plans) does not depend on any of this, so it is
 * never repeated. That is what makes it safe to fiddle.
 */
export function PreferencePanel({
  profile, onChange, onRescore,
}: {
  profile: PreferenceProfile;
  onChange: (p: PreferenceProfile) => void;
  onRescore: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<Partial<Record<DimensionKey, number>>>({});
  const timers = useRef<Partial<Record<DimensionKey, ReturnType<typeof setTimeout>>>>({});

  const value = (k: DimensionKey) => local[k] ?? profile.weights[k];

  async function commit(k: DimensionKey, v: number) {
    setBusy(true);
    try {
      onChange(await patchProfile({ weights: { [k]: v } }));
      onRescore();
    } finally {
      setBusy(false);
      setLocal((l) => { const n = { ...l }; delete n[k]; return n; });
    }
  }

  async function setPref<K extends keyof PreferenceProfile['preferences']>(
    key: K, v: PreferenceProfile['preferences'][K],
  ) {
    setBusy(true);
    try {
      onChange(await patchProfile({ preferences: { [key]: v } }));
      onRescore();
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      {/* ------------------------ the fixed two ------------------------ */}
      <section className="rounded-2xl border border-ink-700 bg-ink-850 p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-ink-300">
          <Lock size={14} className="text-bad-400" /> Non-negotiable
        </h3>
        <ul className="space-y-2 text-[13px] text-ink-200">
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-bad-400" />
            No south-facing front door.
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-bad-400" />
            The backyard has to be fenced.
          </li>
        </ul>
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-500">
          These rule a house out rather than costing it points, and they are not
          on a slider on purpose — a thing you can nudge is a thing you will nudge
          at eleven at night on the twenty-third house.
        </p>
      </section>

      {/* -------------------------- the weights -------------------------- */}
      <section className="rounded-2xl border border-ink-700 bg-ink-850 p-5">
        <header className="mb-4 flex items-center gap-2">
          <SlidersHorizontal size={14} className="text-brand-400" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-300">
            How much each thing counts
          </h3>
          {busy && <Loader2 size={13} className="ml-auto animate-spin text-brand-400" />}
        </header>

        <div className="space-y-3">
          {ORDER.map((k) => (
            <div key={k}>
              <div className="flex items-baseline justify-between">
                <span className="text-[12.5px] text-ink-200">{LABELS[k]}</span>
                <span className={`font-mono text-[11px] ${value(k) === 0 ? 'text-bad-400' : 'text-ink-400'}`}>
                  {value(k) === 0 ? 'ignored' : value(k).toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0} max={1} step={0.05}
                value={value(k)}
                /* Saved on change, debounced — not on mouse-up.
                   Dragging a slider to the far left and releasing over the page
                   rather than over the track fires mouseup on the document, so
                   the value showed 0.05 and nothing was ever written. He set
                   the commute weight to nothing, pressed re-rank, and the
                   server re-ranked using the old weight it still held. */
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setLocal((l) => ({ ...l, [k]: v }));
                  clearTimeout(timers.current[k]);
                  timers.current[k] = setTimeout(() => commit(k, v), 350);
                }}
                className="mt-1 w-full accent-[var(--color-brand-500)]"
              />
            </div>
          ))}
        </div>

        <p className="mt-4 text-[11.5px] leading-relaxed text-ink-500">
          Yard and walkability are separate on purpose. They pull against each
          other, and one blended number would hide the trade-off you actually
          have to make.
        </p>
      </section>

      {/* -------------------------- the numbers -------------------------- */}
      <section className="rounded-2xl border border-ink-700 bg-ink-850 p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-300">
          Limits
        </h3>
        <div className="space-y-3">
          {([
            ['maxPrice', 'Price ceiling', 25000],
            ['minYearBuilt', 'Nothing older than', 1],
            ['minLotAcres', 'Smallest lot you would take', 0.01],
            ['maxCommuteMinutes', 'Commute ceiling (min)', 1],
            ['negotiationRoomPct', 'Discount you expect off ask (0.12 = 12%)', 0.01],
          ] as const).map(([key, label, step]) => (
            <label key={key} className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] text-ink-200">{label}</span>
              <input
                type="number"
                step={step}
                defaultValue={profile.preferences[key]}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (v !== profile.preferences[key]) setPref(key, v as never);
                }}
                /* Enter saves too. Blur alone is the same trap the weight
                   sliders fell into: type a number, press Enter because that is
                   what Enter is for, see the number sitting there, and have
                   nothing written. */
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }}
                className="w-32 rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-right font-mono text-[12px] text-ink-100 outline-none focus:border-brand-400"
              />
            </label>
          ))}
        </div>
      </section>

      {/* ------------------------ what it has learnt ------------------------ */}
      {profile.learnedNotes.length > 0 && (
        <section className="rounded-2xl border border-ink-700 bg-ink-850 p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-ink-300">
            <RotateCcw size={14} className="text-saffron-400" /> What you have told it
          </h3>
          <ul className="space-y-1.5">
            {profile.learnedNotes.slice(0, 12).map((n, i) => (
              <li key={i} className="text-[11.5px] leading-relaxed text-ink-400">{n}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
