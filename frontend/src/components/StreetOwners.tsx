'use client';

/**
 * Who is actually on this street.
 *
 * Paste the county tax roll in, and it works out which of those parcels are
 * your immediate neighbours and what the road looks like as a whole.
 *
 * The census could never answer this. The tract around 5280 Blue Mountain Ln
 * reads 21.5% South Asian and every owner on the street is — a tract is four
 * thousand people over a wide area. Block groups got closer, 600 to 3,000, and
 * still describe several streets at once. Only the parcel records name the road.
 *
 * He does the lookup; this parses what he pastes. No scraping, and no automatic
 * classification of anybody — the rollup below counts nothing about people, it
 * only separates companies and trusts from private owners and shows the names
 * as the county wrote them.
 */

import { useState } from 'react';
import { Users, Loader2, Check, Trash2, Home } from 'lucide-react';
import { patchListing } from '@/lib/api';
import type { Listing } from '@/types/listing';

type Owner = { address: string; owner: string };

/**
 * qPublic lays each parcel out as: parcel id, owner, address, city, legal
 * description — across a table, a PDF copy, or a raw paste. All three arrive
 * here as lines with the owner before the street address, so the address is the
 * anchor and everything before it on the line is the owner.
 */
export function parseOwners(text: string): Owner[] {
  const out: Owner[] = [];
  const seen = new Set<string>();
  /* A house number, then AT MOST THREE words, then a street type.
   *
   * The word limit is the whole trick. Without it the pattern starts at the
   * parcel id and swallows the owner into the street name: "135 156 P&K
   * PROSPERITY LLC 1440 HERITAGE DR" parsed as number 135 on a street called
   * "156 P&K PROSPERITY LLC 1440 HERITAGE DR". No real street name runs to
   * three words plus a type, so capping it forces the match onto the address.
   *
   * Greedy rather than lazy, so "6035 HERITAGE MANOR DR" keeps the DR instead
   * of stopping at MANOR — MANOR is itself a street type.
   *
   * A type missing from this list is a silent failure, not a loud one: the line
   * simply does not match and the parcel vanishes. AVE was missing, and an
   * entire Fulton street parsed as zero owners. Add types on sight. */
  const ADDR = /\b(\d{2,6})\s+((?:[A-Z0-9'&.-]+\s){0,3}(?:LN|DR|CT|RD|ST|WAY|WY|AVE|AVENUE|AV|TRCE|TRACE|TRL|TRAIL|PL|CIR|BLVD|PKWY|TER|TERRACE|PASS|RUN|XING|CROSSING|WALK|PATH|LOOP|BND|POINT|PT|GLEN|CHASE|COVE|CV|HL|RDG|RIDGE|CRST|CREST|VW|VIEW|MNR|MANOR|OVLK|GRANGE|SQ|PARK|GATE|MILL|FARM|CMNS|COMMONS))\b/i;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line || /^parcel\s*id/i.test(line)) continue;
    const m = ADDR.exec(line);
    if (!m) continue;
    const address = `${m[1]} ${m[2]}`.replace(/\s+/g, ' ').toUpperCase();

    /* The owner is whatever sits before the address, minus the parcel id.
     *
     * Counties number parcels differently: Forsyth writes "135 156", Fulton
     * writes "22 514112550383". Stripping a fixed shape only handled Forsyth
     * and left Fulton's id glued to the front of every owner name. Any run of
     * digits and spaces at the start of the line is a parcel id, whatever its
     * shape — a person's name does not begin with a number. */
    let owner = line.slice(0, m.index)
      .replace(/^[\d\s-]+/, '')
      .replace(/[|\t]/g, ' ')
      .trim();
    if (!owner || owner.length < 3) continue;
    const key = `${address}|${owner}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ address, owner: owner.toUpperCase() });
  }
  return out;
}

const NOT_A_PERSON = /\b(LLC|INC|TRUST|ASSOC|ASSOCIATION|HOMEOWNERS|CORP|COMPANY|PROPERTIES|HOLDINGS|LP|LLP)\b/;

/**
 * Nearest parcels by house number: same side of the road, then across it.
 *
 * Odd on one side, even on the other is the usual convention, but it is only a
 * convention. Stonebrier Ln runs 190-280 even and 285-325 odd — one continuous
 * loop, not two sides. Splitting it by parity put "either side" of number 225
 * at 285 and 295, sixty houses away, while 220 and 230 — its actual next-door
 * neighbours — were filed as across the road.
 *
 * So check the assumption instead of trusting it: if the closest same-parity
 * parcel is much farther than the closest opposite-parity one, the street does
 * not split by parity, and we say so rather than labelling a guess.
 */
function neighboursOf(subject: string, all: Owner[]) {
  const num = Number(/^\d+/.exec(subject)?.[0]);
  if (!Number.isFinite(num)) return { sameSide: [], across: [], byParity: true };
  const withNum = all
    .map((o) => ({ ...o, n: Number(/^\d+/.exec(o.address)?.[0]) }))
    .filter((o) => Number.isFinite(o.n) && o.n !== num);
  const parity = num % 2;
  const near = (list: typeof withNum, k: number) =>
    [...list].sort((a, b) => Math.abs(a.n - num) - Math.abs(b.n - num)).slice(0, k);

  const same = withNum.filter((o) => o.n % 2 === parity);
  const opp = withNum.filter((o) => o.n % 2 !== parity);
  const gap = (list: typeof withNum) =>
    list.length ? Math.min(...list.map((o) => Math.abs(o.n - num))) : Infinity;

  /* Parity holds only when both sides have something genuinely close by. */
  const byParity = same.length > 0 && opp.length > 0 && gap(same) <= gap(opp) * 3 + 4;
  if (!byParity) return { sameSide: near(withNum, 2), across: near(withNum, 5).slice(2), byParity };
  return { sameSide: near(same, 2), across: near(opp, 3), byParity };
}

export function StreetOwners({
  listing, onSaved,
}: { listing: Listing; onSaved: (l: Listing) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const owners = listing.streetOwners ?? [];
  const subject = listing.address.split(',')[0].trim().toUpperCase();
  const { sameSide, across, byParity } = neighboursOf(subject, owners);
  const companies = owners.filter((o) => NOT_A_PERSON.test(o.owner));
  const people = owners.filter((o) => !NOT_A_PERSON.test(o.owner));

  const save = async () => {
    const parsed = parseOwners(text);
    if (!parsed.length) return;
    setBusy(true);
    try {
      onSaved(await patchListing(listing.id, {
        streetOwners: parsed,
        streetOwnersAt: new Date().toISOString(),
      }));
      setText(''); setOpen(false);
    } finally { setBusy(false); }
  };

  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-850 p-5">
      <header className="mb-2.5 flex items-center gap-2">
        <Users size={14} className="text-saffron-400" />
        <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-300">
          Who is on this street
        </h3>
        <span className="ml-auto font-mono text-[10.5px] text-ink-500">
          {owners.length ? `${owners.length} parcels` : 'not looked up'}
        </span>
      </header>

      {owners.length > 0 ? (
        <>
          <div className="space-y-2.5">
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-ink-500">
                {byParity ? 'Either side' : 'Closest by number'}
              </p>
              {sameSide.length ? sameSide.map((o) => (
                <p key={o.address} className="text-[12.5px] text-ink-200">
                  <span className="font-mono text-ink-500">{o.address}</span> — {o.owner}
                </p>
              )) : <p className="text-[12px] text-ink-500">nothing adjacent in the paste</p>}
            </div>
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-ink-500">
                {byParity ? 'Across the road' : 'Next closest'}
              </p>
              {across.length ? across.map((o) => (
                <p key={o.address} className="text-[12.5px] text-ink-200">
                  <span className="font-mono text-ink-500">{o.address}</span> — {o.owner}
                </p>
              )) : <p className="text-[12px] text-ink-500">nothing opposite in the paste</p>}
              {!byParity && owners.length > 0 && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-600">
                  Odd and even numbers do not sit opposite each other on this street, so
                  which side of the road each parcel is on is not something the numbering
                  can tell us. These are simply the nearest numbers.
                </p>
              )}
            </div>
          </div>

          <details className="mt-3 border-t border-ink-700 pt-2.5">
            <summary className="cursor-pointer text-[12px] text-ink-400 hover:text-ink-200">
              The whole street — {people.length} private owners
              {companies.length > 0 && `, ${companies.length} company or trust`}
            </summary>
            <div className="mt-2 max-h-64 overflow-y-auto pr-1">
              {owners.map((o) => (
                <p key={`${o.address}-${o.owner}`}
                   className={`flex gap-2 py-0.5 text-[12px] ${
                     o.address === subject ? 'font-semibold text-brand-400' : 'text-ink-300'}`}>
                  <span className="w-28 shrink-0 font-mono text-ink-500">{o.address}</span>
                  <span>{o.owner}</span>
                  {o.address === subject && <Home size={11} className="mt-0.5 shrink-0" />}
                </p>
              ))}
            </div>
          </details>

          <div className="mt-2.5 flex items-center gap-3 border-t border-ink-700 pt-2.5">
            <button onClick={() => setOpen((v) => !v)}
                    className="text-[11.5px] text-ink-500 hover:text-ink-200">
              paste a new list
            </button>
            <button
              onClick={async () => {
                setBusy(true);
                try {
                  onSaved(await patchListing(listing.id, { streetOwners: [], streetOwnersAt: undefined }));
                } finally { setBusy(false); }
              }}
              className="flex items-center gap-1 text-[11.5px] text-ink-600 hover:text-bad-400"
            >
              <Trash2 size={10} /> clear
            </button>
            {listing.streetOwnersAt && (
              <span className="ml-auto font-mono text-[10.5px] text-ink-600">
                {new Date(listing.streetOwnersAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </>
      ) : (
        <p className="mb-2.5 text-[12px] leading-relaxed text-ink-500">
          Look the street up on your county&rsquo;s tax portal — qPublic for Forsyth — and paste the
          results table here. The census cannot see a single road; the parcel roll can.
        </p>
      )}

      {(open || owners.length === 0) && (
        <div className="mt-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="Paste the qPublic results table — parcel id, owner, address, city…"
            className="w-full resize-y rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[12px] text-ink-100 outline-none placeholder:text-ink-600 focus:border-brand-400"
          />
          <div className="mt-1.5 flex items-center gap-3">
            <button
              onClick={save}
              disabled={busy || !text.trim()}
              className="flex items-center gap-1.5 rounded-lg border border-brand-500/50 bg-brand-500/10 px-3 py-1.5 text-[12px] font-medium text-brand-400 transition hover:bg-brand-500/20 disabled:opacity-40"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Save
            </button>
            {text.trim() && (
              <span className="font-mono text-[11px] text-ink-500">
                {parseOwners(text).length} parcels found
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
