'use client';

import { useState } from 'react';

import {
  Home, RefreshCw, Loader2, Zap, SlidersHorizontal, Plus, TrendingDown, Map, Compass, Swords, ChevronDown,
} from 'lucide-react';
import type { HealthPayload } from '@/types/listing';
import { API_BASE } from '@/lib/api';
import type { ScanMode } from '@/lib/api';

const SOURCE_LABEL: Record<string, string> = {
  gemini: 'vision',
  maps: 'maps',
  census: 'census',
  walkScore: 'walk',
};

export function Header({
  health, scanning, progress, phase, onScan, onRescore, onCheckPrices, checkingPrices,
  onAdd, onPrefs, onMap, onVastu, onDuel, showingMap, showingVastu, showingDuel, showingPrefs, showingAdd,
}: {
  health: HealthPayload | null;
  scanning: boolean;
  progress: { done: number; total: number } | null;
  phase: string | null;
  onScan: (mode: ScanMode) => void;
  onRescore: () => void;
  onCheckPrices: () => void;
  checkingPrices: boolean;
  onAdd: () => void;
  onPrefs: () => void;
  onMap: () => void;
  showingMap: boolean;
  onVastu: () => void;
  showingVastu: boolean;
  onDuel: () => void;
  showingDuel: boolean;
  showingPrefs: boolean;
  showingAdd: boolean;
}) {
  /* Which scan, chosen deliberately rather than by muscle memory. */
  const [scanMenu, setScanMenu] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-ink-700 bg-ink-950/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-6 py-3">
        <div className="flex items-center gap-2.5">
          <Home size={18} className="text-brand-400" />
          <div className="leading-tight">
            <h1 className="text-[15px] font-semibold text-white">House Hunting V2</h1>
            {/* The backend this UI is actually talking to. Two copies run at
                once and they must never cross; naming the port here means a
                glance settles which one you are looking at. */}
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink-500">
              api {API_BASE.replace(/^https?:\/\//, '')}
            </p>
          </div>
        </div>

        {/* which data sources are actually on */}
        {health && (
          <div className="ml-4 hidden items-center gap-2 lg:flex">
            {Object.entries(health.sources).map(([k, on]) => (
              <span
                key={k}
                title={on ? `${k} is configured` : `${k} has no API key — that dimension stays blank`}
                className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ring-1 ring-inset
                  ${on ? 'bg-good-500/10 text-good-400 ring-good-500/25'
                       : 'bg-ink-800 text-ink-500 ring-ink-700'}`}
              >
                {SOURCE_LABEL[k] ?? k}
              </span>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* The listing-site budget, shown before it runs out rather than
              after. These requests carry a signed-in cookie. */}
          {health?.listingRequests && health.listingRequests.hour < 40 && (
            <span
              title={`${health.listingRequests.usedThisHour} of ${health.listingRequests.limits.perHour} listing-site requests used this hour`}
              className={`rounded px-2 py-1 font-mono text-[10.5px] ${
                health.listingRequests.hour <= 5
                  ? 'bg-bad-500/15 text-bad-400'
                  : 'bg-warn-400/12 text-warn-400'
              }`}
            >
              {health.listingRequests.hour} fetches left
            </span>
          )}

          {scanning && phase && (
            <span className="font-mono text-[10.5px] text-ink-400">{phase}…</span>
          )}
          {scanning && !phase && progress && (
            <span className="font-mono text-[11px] text-ink-400">
              {progress.done}/{progress.total}
            </span>
          )}

          <button
            onClick={onAdd}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12.5px] font-medium transition
              ${showingAdd
                ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
                : 'border-ink-700 text-ink-300 hover:border-ink-600 hover:text-ink-100'}`}
          >
            <Plus size={13} /> Add
          </button>

          {/* Two buttons that sound alike and are not. Re-rank re-does the
              arithmetic on readings already taken — instant and free. Scan
              looks at images again, which costs money and seconds. */}
          <button
            onClick={onRescore}
            disabled={scanning}
            title="Re-do the scoring with your current preferences, using readings already taken. Instant, free, no model calls. Use this after moving a slider."
            className="flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-2 text-[12.5px] font-medium text-ink-300 transition hover:border-ink-600 hover:text-ink-100 disabled:opacity-40"
          >
            <Zap size={13} /> Re-rank <span className="text-[10px] text-ink-500">free</span>
          </button>

          {/* One request per shortlisted house, for the only things that
              actually change. Nothing else needs re-reading. */}
          <button
            onClick={onCheckPrices}
            disabled={scanning || checkingPrices}
            title="Re-check price and days-on-market for your shortlisted houses only. One request each."
            className="flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-2 text-[12.5px] font-medium text-ink-300 transition hover:border-ink-600 hover:text-ink-100 disabled:opacity-40"
          >
            {checkingPrices ? <Loader2 size={13} className="animate-spin" /> : <TrendingDown size={13} />}
            Prices
          </button>

          {/* Scan is three different jobs with three different prices, and
              collapsing them into one button meant the cheap one was never used
              and the expensive one was used by accident. Named by what they
              cost, so the choice is obvious at the moment of pressing. */}
          <div className="relative">
            <button
              onClick={() => setScanMenu((v) => !v)}
              disabled={scanning}
              className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-[12.5px] font-semibold text-ink-950 transition hover:bg-brand-400 disabled:opacity-50"
            >
              {scanning ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Scan
              <ChevronDown size={12} />
            </button>

            {scanMenu && !scanning && (
              <div className="absolute right-0 z-30 mt-1 w-[19rem] overflow-hidden rounded-xl border border-ink-700 bg-ink-850 shadow-xl">
                {([
                  ['full', 'Fill the gaps', 'Reads only what has never been read. Pages already saved are reused, and comparables are cached for a week.', 'usually free'],
                  ['rescore', 'Re-rank only', 'Re-scores from readings already taken. Touches nothing outside this machine.', 'free'],
                  ['refetch', 'Fetch every page again', 'Forgets every saved page and downloads them all. The only way to pick up open houses posted since the last look.', 'about 1 request per house'],
                  ['force', 'Re-read every image', 'Throws away every plan and aerial reading and looks again. A model call per house, several minutes.', 'a model call per house'],
                ] as const).map(([mode, label, why, cost]) => (
                  <button
                    key={mode}
                    onClick={() => { setScanMenu(false); onScan(mode); }}
                    className="block w-full border-b border-ink-800 px-3.5 py-2.5 text-left last:border-0 hover:bg-ink-800"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12.5px] font-semibold text-ink-100">{label}</span>
                      {/* Green when it costs nothing outside this machine,
                          amber when it reaches the network or the model. */}
                      <span className={`font-mono text-[10px] ${
                        cost.includes('free') ? 'text-good-400' : 'text-warn-400'}`}>{cost}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-ink-400">{why}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={onMap}
            title="See where these houses actually are, against Midtown, the office, Avalon and Halcyon"
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12.5px] font-medium transition
              ${showingMap
                ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
                : 'border-ink-700 text-ink-300 hover:border-ink-600 hover:text-ink-100'}`}
          >
            <Map size={13} /> Map
          </button>

          {/* His sister's Vastu material, kept as a reference rather than a
              scorer. It is the one page here he reads rather than sorts. */}
          <button
            onClick={onVastu}
            title="The Vastu cheatsheet — room placements, toilet zones, remedies, and where it disagrees with this app"
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12.5px] font-medium transition
              ${showingVastu
                ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
                : 'border-ink-700 text-ink-300 hover:border-ink-600 hover:text-ink-100'}`}
          >
            <Compass size={13} /> Vastu
          </button>

          {/* His idea: two houses, keep one. Six ranked top-tens produced six
              orderings and no decision; a pair is a question he can answer. */}
          <button
            onClick={onDuel}
            title="Two houses side by side — keep one, cut the other"
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12.5px] font-medium transition
              ${showingDuel
                ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
                : 'border-ink-700 text-ink-300 hover:border-ink-600 hover:text-ink-100'}`}
          >
            <Swords size={13} /> Head to head
          </button>

          <button
            onClick={onPrefs}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12.5px] font-medium transition
              ${showingPrefs
                ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
                : 'border-ink-700 text-ink-300 hover:border-ink-600 hover:text-ink-100'}`}
          >
            <SlidersHorizontal size={13} />
          </button>
        </div>
      </div>

      {scanning && progress && progress.total > 0 && (
        <div className="h-0.5 w-full bg-ink-800">
          <div
            className="h-full bg-brand-500 transition-all duration-300"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
      )}
    </header>
  );
}
