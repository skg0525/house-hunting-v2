'use client';

import { useEffect, useState } from 'react';
import {
  ThumbsUp, ThumbsDown, Send, Loader2, BrainCircuit, ArrowRight, X, Undo2,
} from 'lucide-react';
import { sendFeedback, setVerdict, type FeedbackResponse } from '@/lib/api';
import type { Assessment, Listing, PreferenceProfile } from '@/types/listing';

const SUGGESTIONS = [
  'Backyard is too small for him to actually play in.',
  'Love this one — the yard is exactly what we wanted.',
  'Too far from anywhere I could run to.',
  'The downstairs bedroom has no proper bathroom.',
];

/**
 * Two different things you might be saying, kept apart.
 *
 * The thumbs are a verdict on THIS house, and they work on their own — you do
 * not have to justify not liking somewhere. The text box is the general lesson,
 * and it is the only part that touches the weights.
 *
 * They were the same control in the first version of this app, which is how
 * rejecting a house could push it UP the list: the rejection was expressed as a
 * weight change, the house scored well on that dimension, and the average moved
 * the wrong way. Separating them is the fix.
 */
export function FeedbackDock({
  listing, assessment, profile, onProfileChanged, onRescan,
}: {
  listing: Listing;
  assessment: Assessment;
  profile: PreferenceProfile;
  onProfileChanged: (p: PreferenceProfile) => void;
  onRescan: () => void;
}) {
  const [critique, setCritique] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FeedbackResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setCritique(''); setError(null); setResult(null); }, [listing.id]);

  const current = profile.propertyFeedback?.[listing.id];

  async function verdict(v: 'rejected' | 'shortlisted' | null) {
    setBusy(true); setError(null);
    try {
      onProfileChanged(await setVerdict(listing.id, v));
      onRescan();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function teach(action: 'thumbs_up' | 'thumbs_down') {
    if (!critique.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await sendFeedback(listing.id, action, critique.trim());
      setResult(res);
      onProfileChanged(res.profile);
      setCritique('');
      onRescan();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-850 p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-ink-300">
        <BrainCircuit size={14} className="text-saffron-400" /> Your call
      </h3>

      {/* --- verdict on this house, no explanation required --- */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => verdict(current === 'shortlisted' ? null : 'shortlisted')}
          disabled={busy}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px] font-medium transition-colors disabled:opacity-40
            ${current === 'shortlisted'
              ? 'border-good-500/50 bg-good-500/15 text-good-400'
              : 'border-ink-700 bg-ink-900 text-ink-300 hover:border-ink-600'}`}
        >
          <ThumbsUp size={14} /> Shortlist it
        </button>

        <button
          onClick={() => verdict(current === 'rejected' ? null : 'rejected')}
          disabled={busy}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px] font-medium transition-colors disabled:opacity-40
            ${current === 'rejected'
              ? 'border-bad-500/50 bg-bad-500/15 text-bad-400'
              : 'border-ink-700 bg-ink-900 text-ink-300 hover:border-ink-600'}`}
        >
          <ThumbsDown size={14} /> Not for us
        </button>

        {current && (
          <button
            onClick={() => verdict(null)}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-[12px] text-ink-500 transition hover:text-ink-200 disabled:opacity-40"
          >
            <Undo2 size={12} /> Undo
          </button>
        )}

        {busy && <Loader2 size={14} className="animate-spin text-saffron-400" />}
      </div>

      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-500">
        Marking a house drops it out of contention on its own. You do not owe it a reason.
      </p>

      {/* --- the general lesson, which is the only thing that generalises --- */}
      <div className="mt-4 border-t border-ink-700 pt-4">
        {/* This was being used as a second notes box, and it is not one.
            Anything typed here is turned into a weight change and a one-line
            summary on the profile; the words themselves are not kept, and they
            are not attached to this house. Notes about THIS house belong in
            "Your notes" above, which is saved verbatim and stays with it. */}
        <p className="mb-1 text-[12px] font-medium text-ink-300">
          Teach the ranking — this is not a notes box
        </p>
        <p className="mb-2 text-[11.5px] leading-relaxed text-ink-500">
          What you write here adjusts how <em>every other house</em> is scored, then is
          discarded. For anything you want to keep about this one, use
          <strong className="text-ink-300"> Your notes</strong> further up — that is saved word for word.
        </p>

        <textarea
          rows={2}
          value={critique}
          onChange={(e) => setCritique(e.target.value)}
          placeholder="In your own words…"
          className="w-full resize-none rounded-lg border border-ink-700 bg-ink-900 p-3 text-[13px] text-ink-100 outline-none placeholder:text-ink-500 focus:border-saffron-500/60"
        />

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setCritique(s)}
              title={s}
              className="max-w-[260px] truncate rounded-full border border-ink-700 px-2.5 py-1 text-[11px] text-ink-400 transition hover:border-ink-600 hover:text-ink-200"
            >
              {s}
            </button>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => teach('thumbs_up')}
            disabled={!critique.trim() || busy}
            className="flex items-center gap-2 rounded-lg bg-saffron-500 px-4 py-2 text-[13px] font-semibold text-ink-950 transition hover:bg-saffron-400 disabled:opacity-40"
          >
            <Send size={14} /> This is a plus
          </button>
          <button
            onClick={() => teach('thumbs_down')}
            disabled={!critique.trim() || busy}
            className="flex items-center gap-2 rounded-lg border border-ink-700 px-4 py-2 text-[13px] font-semibold text-ink-200 transition hover:border-ink-600 disabled:opacity-40"
          >
            This is a problem
          </button>
        </div>
      </div>

      {result && (
        <div className="mt-4 rounded-lg border border-saffron-500/25 bg-saffron-500/[0.07] p-3">
          <button
            onClick={() => setResult(null)}
            className="float-right rounded p-0.5 text-ink-400 hover:text-ink-200"
            aria-label="Dismiss"
          >
            <X size={13} />
          </button>
          <p className="text-[12.5px] font-medium text-saffron-400">{result.note}</p>
          {result.changes.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              {result.changes.map((c) => (
                <span key={c.dimension} className="flex items-center gap-1.5 font-mono text-[11px]">
                  <span className="text-ink-300">{c.dimension}</span>
                  <span className="text-ink-500">{c.from.toFixed(2)}</span>
                  <ArrowRight size={10} className="text-saffron-400" />
                  <span className={`font-bold ${c.to > c.from ? 'text-good-400' : 'text-bad-400'}`}>
                    {c.to.toFixed(2)}
                  </span>
                </span>
              ))}
              <span className="font-mono text-[10.5px] text-ink-500">
                v{result.profile.version} · everything re-ranked
              </span>
            </div>
          )}
          {result.degraded && (
            <p className="mt-1.5 text-[11px] text-warn-400">
              Saved your words, but the model was unreachable so no weights moved.
            </p>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-[12px] text-bad-400">{error}</p>}
    </section>
  );
}
