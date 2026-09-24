'use client';

import { useEffect, useRef, useState } from 'react';
import { NotebookPen, Footprints, Check, Loader2 } from 'lucide-react';
import { saveNotes, patchListing } from '@/lib/api';
import type { Listing } from '@/types/listing';

/**
 * What you thought, in your own words.
 *
 * Kept apart from everything the app fetches, and never overwritten by a
 * re-scan, a cache clear or a re-scrape. Standing in a kitchen and writing
 * "island too small, no pantry" is the one piece of information here that
 * cannot be fetched again — so it is the one piece that gets protected.
 *
 * Saves on its own a moment after you stop typing. A notes box with a Save
 * button you have to remember is a notes box that loses notes.
 */
export function MyNotes({
  listing, onSaved,
}: {
  listing: Listing;
  onSaved: (l: Listing) => void;
}) {
  const [text, setText] = useState(listing.myNotes ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(listing.myNotes ?? '');

  /* Switching house swaps the note, and must not carry the previous one over. */
  useEffect(() => {
    setText(listing.myNotes ?? '');
    lastSaved.current = listing.myNotes ?? '';
    setState('idle');
  }, [listing.id, listing.myNotes]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onChange = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (v === lastSaved.current) return;
      setState('saving');
      try {
        const r = await saveNotes(listing.id, v);
        lastSaved.current = v;
        onSaved({ ...listing, myNotes: r.myNotes, myNotesUpdatedAt: r.myNotesUpdatedAt });
        setState('saved');
        setTimeout(() => setState('idle'), 1800);
      } catch {
        setState('idle');
      }
    }, 700);
  };

  const when = listing.myNotesUpdatedAt
    ? new Date(listing.myNotesUpdatedAt).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    : null;

  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-850 p-5">
      <header className="mb-2.5 flex items-center gap-2">
        <NotebookPen size={14} className="text-saffron-400" />
        <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-300">
          Your notes
        </h3>

        {/* Toured is a tag, not a verdict.
            He has toured houses he then rejected and shortlisted houses he has
            never stood in, so this marks the card and filters nothing — it
            lives here, beside the note, because "I went" and "here is what I
            thought" are the same moment. */}
        <button
          onClick={async () => {
            /* Now, not midnight. A date-only value written as T00:00:00Z
               renders as the PREVIOUS day everywhere in the US — seven tours
               marked "19 Sep" displayed as Friday the 18th. Clicking this
               button records a real instant, which cannot slip a day. */
            const at = listing.touredAt ? undefined : new Date().toISOString();
            onSaved(await patchListing(listing.id, { touredAt: at ?? null }));
          }}
          title={listing.touredAt
            ? `Toured ${new Date(listing.touredAt).toLocaleDateString()} — click to clear`
            : 'Mark that you have been inside this one'}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition
            ${listing.touredAt
              ? 'border-brand-500/55 bg-brand-500/12 text-brand-400'
              : 'border-ink-700 text-ink-400 hover:border-ink-600 hover:text-ink-200'}`}
        >
          <Footprints size={12} />
          {listing.touredAt
            ? `Toured ${new Date(listing.touredAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
            : 'Mark toured'}
        </button>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10.5px] text-ink-500">
          {state === 'saving' && <><Loader2 size={11} className="animate-spin" /> saving</>}
          {state === 'saved' && <><Check size={11} className="text-good-400" /> saved</>}
          {state === 'idle' && when && `edited ${when}`}
        </span>
      </header>

      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder="What you thought after seeing it. Kitchen, yard, street noise, the neighbour&rsquo;s dog — whatever you would otherwise forget by Tuesday."
        className="w-full resize-y rounded-xl border border-ink-700 bg-ink-900 p-3 text-[13px] leading-relaxed text-ink-100 outline-none placeholder:text-ink-500 focus:border-saffron-500/60"
      />

      <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
        Saved as you type, and kept separately from everything the app fetches —
        re-scanning, clearing the cache and re-reading the listing all leave this
        untouched.
      </p>
    </section>
  );
}
