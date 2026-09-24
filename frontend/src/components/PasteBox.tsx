'use client';

import { useState } from 'react';
import { Link2, Loader2, Plus, X } from 'lucide-react';
import { pasteUrls, createListing } from '@/lib/api';
import type { PastedResult, Listing } from '@/types/listing';

/**
 * How houses get in.
 *
 * You browse Redfin the way you already do, favourite what you like, and later
 * paste the links here in one go. Nothing crawls those sites — the street
 * address is right there in the URL, and the address is all that is needed to
 * place the house and measure which way it faces.
 *
 * The numbers Redfin shows on the page (price, lot size, year) are not in the
 * URL, so you type those. Twenty seconds a house, and no scraper.
 */

interface Draft extends Omit<PastedResult, 'address'> {
  /** Always a string here: the form needs something to bind to. */
  address: string;
  price: string;
  beds: string;
  baths: string;
  sqft: string;
  lotSizeAcres: string;
  yearBuilt: string;
  hoaMonthly: string;
  /* Both of these are printed on the Redfin page, so typing them beats paying
     for an API to fetch a number you are already looking at. Redfin shows
     walkability out of 10; multiply by 10. */
  walkScore: string;
  schoolRating: string;
  notes: string;
}

const toDraft = (r: PastedResult): Draft => ({
  ...r,
  address: r.address ?? r.addressGuess ?? '',
  price: '', beds: '', baths: '', sqft: '',
  lotSizeAcres: '', yearBuilt: '', hoaMonthly: '',
  walkScore: '', schoolRating: '', notes: '',
});

export function PasteBox({ onAdded }: { onAdded: (added: Listing[]) => void }) {
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function parse() {
    setBusy(true);
    setError(null);
    try {
      const results = await pasteUrls(text);
      setDrafts(results.filter((r) => r.status === 'new').map(toDraft));
      const dupes = results.length - results.filter((r) => r.status === 'new').length;
      if (dupes) setError(`${dupes} link${dupes === 1 ? ' was' : 's were'} already in your list.`);
      setText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveAll() {
    setBusy(true);
    try {
      const added: Listing[] = [];
      for (const d of drafts) {
        if (!d.address.trim()) continue;
        added.push(await createListing({
          sourceUrl: d.url,
          address: d.address.trim(),
          coords: d.coords,
          price: Number(d.price) || 0,
          beds: Number(d.beds) || 0,
          baths: Number(d.baths) || 0,
          sqft: Number(d.sqft) || 0,
          lotSizeAcres: Number(d.lotSizeAcres) || 0,
          yearBuilt: Number(d.yearBuilt) || 0,
          hoaMonthly: Number(d.hoaMonthly) || 0,
          // Left undefined when blank, so the dimension reads "not looked up"
          // rather than "scored zero".
          neighborhood: {
            walkScore: d.walkScore ? Number(d.walkScore) : undefined,
            schoolRating: d.schoolRating ? Number(d.schoolRating) : undefined,
          },
          notes: d.notes.trim() || undefined,
        }));
      }
      setDrafts([]);
      onAdded(added);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const set = (i: number, patch: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const field = (
    d: Draft, i: number, key: keyof Draft, label: string, width = 'w-24',
  ) => (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-ink-400">{label}</span>
      <input
        value={String(d[key] ?? '')}
        onChange={(e) => set(i, { [key]: e.target.value } as Partial<Draft>)}
        className={`${width} rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 font-mono text-[12px] text-ink-100 outline-none focus:border-brand-400`}
      />
    </label>
  );

  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-850 p-5">
      <header className="mb-3 flex items-center gap-2">
        <Link2 size={15} className="text-brand-400" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-200">
          Add houses
        </h2>
      </header>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Paste Redfin or Zillow links here — one per line, or all jumbled together. It sorts them out."
        className="w-full resize-y rounded-xl border border-ink-700 bg-ink-900 p-3 text-[13px] leading-relaxed text-ink-100 outline-none placeholder:text-ink-500 focus:border-brand-400"
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={parse}
          disabled={busy || !text.trim()}
          className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-[13px] font-semibold text-ink-950 transition hover:bg-brand-400 disabled:opacity-40"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Read the links
        </button>
        {error && <span className="text-[12px] text-warn-400">{error}</span>}
      </div>

      {drafts.length > 0 && (
        <div className="mt-5 space-y-3">
          <p className="text-[12px] text-ink-400">
            Addresses came from the links. Everything else is on the listing page.
            Fill in what you can — a blank field is left out of the score rather
            than guessed at.
          </p>

          {drafts.map((d, i) => (
            <div key={d.url} className="rounded-xl border border-ink-700 bg-ink-900/60 p-4">
              <div className="mb-3 flex items-start gap-3">
                <input
                  value={d.address}
                  onChange={(e) => set(i, { address: e.target.value })}
                  placeholder="Street address"
                  className="flex-1 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[13px] text-ink-100 outline-none focus:border-brand-400"
                />
                <button
                  onClick={() => setDrafts((ds) => ds.filter((_, j) => j !== i))}
                  className="rounded-lg border border-ink-700 p-2 text-ink-400 transition hover:border-bad-400 hover:text-bad-400"
                  aria-label="Drop this one"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="flex flex-wrap gap-3">
                {field(d, i, 'price', 'price', 'w-28')}
                {field(d, i, 'beds', 'beds', 'w-16')}
                {field(d, i, 'baths', 'baths', 'w-16')}
                {field(d, i, 'sqft', 'sq ft', 'w-24')}
                {field(d, i, 'lotSizeAcres', 'lot (acres)', 'w-24')}
                {field(d, i, 'yearBuilt', 'built', 'w-20')}
                {field(d, i, 'hoaMonthly', 'hoa /mo', 'w-20')}
                {field(d, i, 'walkScore', 'walk /100', 'w-24')}
                {field(d, i, 'schoolRating', 'schools /10', 'w-24')}
              </div>

              <p className="mt-2 text-[11px] text-ink-500">
                Walk and schools are both on the Redfin page. Redfin prints
                walkability out of 10 — multiply by 10. Leave blank and that
                dimension stays unscored rather than guessed.
              </p>

              <div className="mt-3 flex items-center gap-3 text-[11px] text-ink-500">
                <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono uppercase">{d.site}</span>
                {d.coords
                  ? <span className="text-good-400">placed on the map ({d.geocodeQuality?.toLowerCase()})</span>
                  : <span className="text-warn-400">address did not geocode — facing direction will be unknown</span>}
              </div>
            </div>
          ))}

          <button
            onClick={saveAll}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-good-500 px-4 py-2 text-[13px] font-semibold text-ink-950 transition hover:bg-good-400 disabled:opacity-40"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Add {drafts.length} house{drafts.length === 1 ? '' : 's'}
          </button>
        </div>
      )}
    </section>
  );
}
