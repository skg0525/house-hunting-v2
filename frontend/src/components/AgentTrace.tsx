'use client';

import { useState } from 'react';
import { Activity, ChevronDown, Check, Zap, AlertTriangle, XCircle } from 'lucide-react';
import type { TraceStep } from '@/types/listing';

const MARK = {
  ok: { icon: Check, cls: 'text-good-400 bg-good-500/15 ring-good-500/30' },
  cached: { icon: Zap, cls: 'text-brand-400 bg-brand-500/15 ring-brand-500/30' },
  degraded: { icon: AlertTriangle, cls: 'text-warn-400 bg-warn-400/15 ring-warn-400/30' },
  error: { icon: XCircle, cls: 'text-bad-400 bg-bad-500/15 ring-bad-500/30' },
} as const;

/**
 * Where every number on this page came from.
 *
 * Which images were fetched, which model read them, how long each step took,
 * and whether anything was reused from cache rather than re-read. It is here so
 * that a score is checkable rather than taken on trust — if a house reads
 * "kitchen unmeasured", this says whether that is because no plan was found or
 * because the read failed.
 *
 * Timings and statuses come straight from the backend. The submitted version of
 * this project animated four hardcoded strings on a timer, which looked
 * identical whether anything had happened or not.
 */
export function AgentTrace({ steps, totalMs, cached }: {
  steps: TraceStep[]; totalMs: number; cached: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-850 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-5 py-3.5 text-left hover:bg-ink-800/60"
      >
        <Activity size={15} className="text-brand-400" />
        <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-300">
          How this house was read
        </h3>
        <span className="ml-auto flex items-center gap-2 font-mono text-[11px] text-ink-400">
          {cached && (
            <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-brand-400 ring-1 ring-brand-500/30">
              cache hit
            </span>
          )}
          <span>{totalMs}ms</span>
          <ChevronDown
            size={15}
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {open && (
        <ol className="border-t border-ink-700 px-5 py-4 space-y-3">
          {steps.map((s, i) => {
            const { icon: Icon, cls } = MARK[s.status];
            return (
              <li key={i} className="flex gap-3">
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center
                                  rounded-full ring-1 ${cls}`}>
                  <Icon size={11} strokeWidth={3} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] font-medium text-ink-200">{s.step}</span>
                    <span className="font-mono text-[11px] text-ink-400">{s.ms}ms</span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-ink-400">{s.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
