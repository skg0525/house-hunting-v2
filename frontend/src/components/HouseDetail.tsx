'use client';

import { useRef, useState } from 'react';
import {
  Ban, ExternalLink, Compass, Upload, Loader2, RefreshCw, Sparkles,
  Trash2, MapPin, CheckCircle2, AlertTriangle, Star, ThumbsDown, CalendarDays, Footprints, Satellite, Globe, Car, Bookmark, Clock, UserRound,
} from 'lucide-react';
import { ScoreRing } from './ScoreRing';
import { DimensionBars } from './DimensionBars';
import { AgentTrace } from './AgentTrace';
import { FeedbackDock } from './FeedbackDock';
import { SmartImage } from './SmartImage';
import {
  VastuPanel, HealthPanel, NegotiationPanel, HighlightsPanel, MarketPanel, NearbyPanel,
  PlanFamilyPanel,
} from './DetailPanels';
import { MyNotes } from './MyNotes';
import { StreetOwners } from './StreetOwners';
import { PlanCompass } from './PlanCompass';
import { HouseMap } from './HouseMap';
import {
  uploadPlan, removePlan, enrichListing, deleteListing, setVerdict, patchListing, refreshOpenHouses,
  refreshEverything,
} from '@/lib/api';
import type { Assessment, Listing, PreferenceProfile } from '@/types/listing';

/* The landmarks, by the same keys the backend uses, so a route can start from
   whichever one is closest rather than always from the office. */
const ANCHOR_ADDRESS: Record<string, string> = {
  home: process.env.NEXT_PUBLIC_HOME_ADDRESS ?? 'Midtown, Atlanta, GA',
  work: process.env.NEXT_PUBLIC_WORK_ADDRESS ?? 'Alpharetta, GA',
  avalon: '400 Avalon Blvd, Alpharetta, GA 30009',
  halcyon: '6365 Halcyon Way, Alpharetta, GA 30005',
};

const CONFIDENCE_TONE = {
  high: 'text-good-400',
  medium: 'text-brand-400',
  low: 'text-warn-400',
  none: 'text-ink-500',
} as const;

export function HouseDetail({
  listing, assessment, profile, allRows, anchors, plans = [],
  onListingChanged, onProfileChanged, onRemoved, onRescan, onSelect,
}: {
  listing: Listing;
  assessment?: Assessment;
  profile: PreferenceProfile;
  /** Every house, so this one can be shown in context rather than alone. */
  allRows: { listing: Listing; a?: Assessment }[];
  anchors: { key: string; label: string; address: string; note: string; coords?: { lat: number; lng: number } }[];
  /** Every drawing that has been read, so this one can be shown against its twins. */
  plans?: import('@/lib/api').PlanFamily[];
  onSelect: (id: string) => void;
  onListingChanged: (l: Listing) => void;
  onProfileChanged: (p: PreferenceProfile) => void;
  onRemoved: (id: string) => void;
  onRescan: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  /* Whether the next upload starts the set again or joins it. Adding is the
     common case by far, so it is the plain button and this is the exception. */
  const [replaceNext, setReplaceNext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function guard(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  const read = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      r.readAsDataURL(file);
    });

  /* Several at once, uploaded one after another rather than in parallel —
     each one appends to the list the previous one just wrote, so firing them
     together would lose all but the last. */
  const onFiles = (files?: FileList | null) => {
    if (!files?.length) return;
    const chosen = [...files];
    guard('plan', async () => {
      let last;
      for (const [i, f] of chosen.entries()) {
        last = await uploadPlan(listing.id, await read(f), replaceNext && i === 0);
      }
      setReplaceNext(false);
      if (last) onListingChanged(last);
      onRescan();
    });
  };

  const planCount =
    (listing.images.floorPlan ? 1 : 0) + (listing.images.floorPlanExtra?.length ?? 0);

  const o = assessment?.orientation;
  const verdict = profile.propertyFeedback?.[listing.id];
  const openHouses = listing.openHouses ?? [];

  const when = (iso: string, endIso: string) => {
    const s = new Date(iso), e = new Date(endIso);
    const days = Math.round((s.getTime() - Date.now()) / 86_400_000);
    const rel = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
    const hhmm = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${s.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ` +
           `${hhmm(s)}–${hhmm(e)} · ${rel}`;
  };

  return (
    <div className="space-y-4">
      {/* ---------------------------- header ---------------------------- */}
      <section className="rounded-2xl border border-ink-700 bg-ink-850 p-5">
        <div className="flex items-start gap-5">
          {assessment && (
            <div className="shrink-0 text-center">
              <ScoreRing score={assessment.matchScore} />
              {/* Without this the caps are invisible: a ruled-out or rejected
                  house is pinned, so moving a preference slider changes nothing
                  on screen and the panel looks broken. It isn't — something you
                  decided is overriding the arithmetic, and both numbers are
                  true. */}
              {assessment.baseScore !== assessment.matchScore && (
                <p className="mt-1 font-mono text-[10.5px] leading-tight text-ink-500">
                  {assessment.baseScore} on the numbers
                  <br />
                  <span className="text-ink-600">
                    {assessment.ruledOut ? 'pinned by a hard rule' : 'pinned by your verdict'}
                  </span>
                </p>
              )}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-white">{listing.address.split(',')[0]}</h2>
            <p className="text-[13px] text-ink-400">
              {listing.address.split(',').slice(1).join(',').trim()}
            </p>

            {/* OPEN badges are dropped here on purpose.
                Two places on one screen were answering "is there an open house
                today" from two different reads of the same page — the sash
                string, and the parsed `openHouses`. They disagreed: the detail
                page said "OPEN TODAY, 3PM TO 5PM" while the list showed nothing,
                and the list was right. The parse is the one that survives being
                stale, so it is the only one allowed to make the claim. The other
                badges — NEW CONSTRUCTION, PRICE DROP, 3D WALKTHROUGH — have no
                second source and stay. */}
            {/* Who sent it. Typed in rather than picked from a list, because the
                next realtor's name is not known and should not need a deploy. */}
            <div className="mt-2 flex items-center gap-1.5">
              <UserRound size={11} className="shrink-0 text-ink-500" />
              <input
                defaultValue={listing.referredBy ?? ''}
                placeholder="who sent this? (e.g. Jimena)"
                onBlur={async (e) => {
                  const v = e.target.value.trim();
                  if (v === (listing.referredBy ?? '')) return;
                  onListingChanged(await patchListing(listing.id, { referredBy: v || null }));
                }}
                className="w-48 rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[11px] text-ink-200 outline-none placeholder:text-ink-600 focus:border-brand-400"
              />
            </div>

            {(listing.sashes?.filter((b) => !/^OPEN/i.test(b)).length ?? 0) > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {listing.sashes!.filter((b) => !/^OPEN/i.test(b)).map((b) => (
                  <span
                    key={b}
                    className={`rounded px-2 py-0.5 font-mono text-[10px] font-semibold ${
                      /NEW CONSTRUCTION/i.test(b) ? 'bg-saffron-500/15 text-saffron-400'
                      : /PRICE/i.test(b) ? 'bg-brand-500/15 text-brand-400'
                      : 'bg-ink-800 text-ink-400'
                    }`}
                  >
                    {b}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[12px] text-ink-300">
              {listing.price > 0 && <span className="text-white">${listing.price.toLocaleString()}</span>}
              {listing.beds > 0 && <span>{listing.beds} bd</span>}
              {listing.baths > 0 && <span>{listing.baths} ba</span>}
              {listing.sqft > 0 && <span>{listing.sqft.toLocaleString()} sqft</span>}
              {listing.lotSizeAcres > 0 && <span>{listing.lotSizeAcres} acres</span>}
              {listing.yearBuilt > 0 && <span>built {listing.yearBuilt}</span>}
              {/* Already parsed, never shown. HOA is real monthly money —
                  $102 a month is $36,000 over thirty years. */}
              {listing.hoaMonthly > 0 && (
                <span title="Homeowners association dues">
                  HOA ${listing.hoaMonthly}/mo
                </span>
              )}
            </div>

            {/* Verdict lives here, not buried at the bottom of a long scroll —
                the previous version put the single most-used control ten
                screens below the fold, where it was never found. */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {/* Two shortlists, because they lead to two different phone
                  calls. An open house or a builder's sales office he can walk
                  into on a Saturday; anything else needs an agent to arrange,
                  and that is a different list with a different rhythm. */}
              {/* Three states, and they are a sequence, not a menu. Two ways
                  to get through the door — walk in yourself, or have the agent
                  open it — and then shortlisted for the ones that survived
                  being stood in. */}
              {([
                ['selfTour', 'Go myself', 'Open house or builder sales office — no appointment needed'],
                ['agentTour', 'Ask agent', 'Needs a showing arranged — send this one to the realtor'],
                ['shortlisted', 'Shortlist', 'Toured it and liked it — this is a real contender'],
                ['maybe', 'Maybe', "Not a no. Somewhere to put a house you do not want to lose and are not ready to promote"],
                /* "26+ min" was here. It is gone because it is now measured
                   rather than declared: the 30+ tab filters on the drive time
                   the app already knows, and the houses it matches stay in
                   play. A verdict that only ever restated a number the tool
                   had in hand was a shelf he had to keep by hand. */
              ] as const).map(([v, label, title]) => (
                <button
                  key={v}
                  title={title}
                  onClick={() => guard('verdict', async () => {
                    const next = verdict === v ? null : v;
                    setVerdict(listing.id, next).then(onProfileChanged);
                    onRescan();
                  })}
                  disabled={busy !== null}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold transition disabled:opacity-40
                    ${verdict === v
                      ? v === 'selfTour' ? 'border-brand-500/60 bg-brand-500/15 text-brand-400'
                        : v === 'agentTour' ? 'border-saffron-500/60 bg-saffron-500/15 text-saffron-400'
                        : v === 'maybe' ? 'border-ink-500 bg-ink-700/50 text-ink-100'
                        : 'border-good-500/60 bg-good-500/15 text-good-400'
                      : 'border-ink-700 text-ink-300 hover:border-ink-600 hover:text-ink-100'}`}
                >
                  {busy === 'verdict' ? <Loader2 size={13} className="animate-spin" />
                    : v === 'selfTour' ? <Footprints size={13} />
                    : v === 'agentTour' ? <CalendarDays size={13} />
                    : v === 'maybe' ? <Bookmark size={13} />
                    : <Star size={13} />}
                  {label}
                </button>
              ))}

              <button
                onClick={() => guard('verdict', async () => {
                  onProfileChanged(await setVerdict(listing.id, verdict === 'rejected' ? null : 'rejected'));
                  onRescan();
                })}
                disabled={busy !== null}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold transition disabled:opacity-40
                  ${verdict === 'rejected'
                    ? 'border-bad-500/60 bg-bad-500/15 text-bad-400'
                    : 'border-ink-700 text-ink-300 hover:border-bad-500/50 hover:text-bad-400'}`}
              >
                <ThumbsDown size={13} />
                {verdict === 'rejected' ? 'Not for us' : 'Pass'}
              </button>

              <span className="mx-1 h-5 w-px bg-ink-700" />

              <a
                href={listing.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-[12px] text-ink-300 transition hover:border-brand-500/50 hover:text-brand-400"
              >
                <ExternalLink size={12} /> Listing
              </a>

              {listing.coords && (
                <>
                  <a
                    href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${listing.coords.lat},${listing.coords.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-[12px] text-ink-300 transition hover:border-ink-600 hover:text-ink-100"
                  >
                    <MapPin size={12} /> Street View
                  </a>

                  {/* Straight into Google's own satellite view, zoomed to the lot.
                      The tiles here are a still frame; that one is live, pannable,
                      and shows the streets either side — which is the actual
                      question when you cannot get there in person. */}
                  {/* The /place/ form rather than bare @lat,lng: it drops a pin.
                      Centring the map on a coordinate leaves you looking at forty
                      identical roofs with no way to tell which one is the house. */}
                  <a
                    href={`https://www.google.com/maps/place/${encodeURIComponent(listing.address)}/@${listing.coords.lat},${listing.coords.lng},300m/data=!3m1!1e3`}
                    target="_blank"
                    rel="noreferrer"
                    title="Satellite view with a pin on the house"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-[12px] text-ink-300 transition hover:border-ink-600 hover:text-ink-100"
                  >
                    <Satellite size={12} /> Satellite
                  </a>

                  {/* Google Earth's tilted 3D view — the "fly around". Reads the
                      lie of the land in a way a flat photograph cannot: whether
                      the garden slopes, whether the house sits below the road. */}
                  {/* Earth's /search/ form flies to the address AND leaves a pin.
                      The @coordinate form arrives at the right place with nothing
                      marked, which on a street of new builds is useless. */}
                  <a
                    href={`https://earth.google.com/web/search/${encodeURIComponent(listing.address)}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Google Earth — flies to the house and pins it. Tilt to read the slope."
                    className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-[12px] text-ink-300 transition hover:border-ink-600 hover:text-ink-100"
                  >
                    <Globe size={12} /> Fly around
                  </a>

                  {/* Traced from whichever landmark is closest.
                      A pin tells you where the house is; a route line tells you
                      where it is RELATIVE to somewhere you already know. On a
                      new-build street where every roof looks the same, the second
                      is the one that actually orients you. */}
                  {(() => {
                    const near = [...(listing.anchors ?? [])].sort((a, b) => a.miles - b.miles)[0];
                    const from = near?.label ?? 'work';
                    const origin = ANCHOR_ADDRESS[near?.key ?? 'work'] ?? profile.preferences.workAddress;
                    return (
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(listing.address)}&travelmode=driving`}
                        target="_blank"
                        rel="noreferrer"
                        title={`Route line from ${from} — the nearest of your landmarks, ${near?.miles} miles away`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-[12px] text-ink-300 transition hover:border-ink-600 hover:text-ink-100"
                      >
                        <Car size={12} /> Trace from {from.replace(' (home now)', '')}
                      </a>
                    );
                  })()}
                </>
              )}

              <button
                onClick={() => guard('enrich', async () => {
                  onListingChanged(await enrichListing(listing.id));
                  onRescan();
                })}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-[12px] text-ink-300 transition hover:border-brand-500/50 hover:text-brand-400 disabled:opacity-40"
              >
                {busy === 'enrich' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                Look up the neighbourhood
              </button>

              <button
                onClick={() => { setReplaceNext(false); fileRef.current?.click(); }}
                disabled={busy !== null}
                title="Several at once is fine — one page per storey is normal, and the reader takes up to five."
                className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-[12px] text-ink-300 transition hover:border-brand-500/50 hover:text-brand-400 disabled:opacity-40"
              >
                {busy === 'plan' ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                {planCount ? `Add another plan (${planCount})` : 'Add floor plan'}
              </button>

              {planCount > 0 && (
                <button
                  onClick={() => { setReplaceNext(true); fileRef.current?.click(); }}
                  disabled={busy !== null}
                  title="Throw away the plans on this house and start again with what you pick next."
                  className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-[12px] text-ink-400 transition hover:border-ink-600 hover:text-ink-200 disabled:opacity-40"
                >
                  Start plans over
                </button>
              )}

              <button
                onClick={() => guard('openhouse', async () => {
                  const r = await refreshOpenHouses(listing.id);
                  onListingChanged(r.listing);
                })}
                disabled={busy !== null}
                title="Re-read this listing's page and pick up any open house it advertises. Free — the page is already cached."
                className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-[12px] text-ink-300 transition hover:border-brand-500/50 hover:text-brand-400 disabled:opacity-40"
              >
                {busy === 'openhouse' ? <Loader2 size={12} className="animate-spin" /> : <CalendarDays size={12} />}
                Check open house
              </button>

              {/* The full reset for one house. Everything else reuses caches by
                  design; this is the escape hatch for when a listing has
                  plainly changed or you simply do not believe the reading. */}
              <button
                onClick={() => guard('refresh', async () => {
                  const r = await refreshEverything(listing.id);
                  onListingChanged(r.listing);
                  onRescan();
                })}
                disabled={busy !== null}
                title="Forget everything cached for this house — its page, its reading, its gallery verdict — and do the whole job again. Three or four requests."
                className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-[12px] text-ink-300 transition hover:border-brand-500/50 hover:text-brand-400 disabled:opacity-40"
              >
                {busy === 'refresh' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                Re-read everything
              </button>

              <button
                onClick={() => guard('remove', async () => {
                  await deleteListing(listing.id);
                  onRemoved(listing.id);
                })}
                disabled={busy !== null}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-[12px] text-ink-500 transition hover:border-bad-400/50 hover:text-bad-400 disabled:opacity-40"
              >
                <Trash2 size={12} /> Remove
              </button>

              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }}
              />
            </div>

            {error && <p className="mt-2 text-[12px] text-bad-400">{error}</p>}
          </div>
        </div>

        {assessment && (
          <p className="mt-4 border-t border-ink-700 pt-4 text-[13.5px] leading-relaxed text-ink-200">
            {assessment.summary}
          </p>
        )}
      </section>

      {/* How far out, then what you wrote, then the arithmetic.
          He asked for this order and the reason is sound: the distance and
          his own note are the two things he actually re-reads, and they were
          sitting three screens below a breakdown he had already understood. */}
      {(listing.anchors?.length ?? 0) > 0 && (
        <section className="rounded-2xl border border-ink-700 bg-ink-850 p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-300">
            How far out this is
          </h3>
          <div className="grid gap-3 sm:grid-cols-5">
            {/* Which GA-400 exit this hangs off, first, because it is how he
                navigates: he talks about houses as "exit 13" long before he
                talks about them as 11.6 miles. Free — `nearestExit` is
                arithmetic against a fixed table of the twelve interchanges, no
                lookup — and already stored on all 164 houses. */}
            {listing.exit && (
              <div
                title={listing.exit.number
                  ? `${listing.exit.miles} miles from the ${listing.exit.name} interchange`
                  : 'More than 8 miles from any GA-400 interchange'}
                className={`rounded-xl border p-3 ${
                  listing.exit.number
                    ? 'border-brand-500/30 bg-brand-500/[0.06]'
                    : 'border-warn-500/30 bg-warn-500/[0.06]'}`}
              >
                <p className="font-mono text-[10px] uppercase tracking-widest text-ink-500">
                  Nearest exit
                </p>
                {listing.exit.number ? (
                  <>
                    <p className="mt-1 font-mono text-lg font-bold text-brand-400">
                      {listing.exit.number}
                    </p>
                    <p className="mt-1 font-mono text-[11px] leading-tight text-ink-400">
                      {listing.exit.name}
                      <br />
                      <span className="text-ink-500">{listing.exit.miles} mi from the ramp</span>
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-1 font-mono text-lg font-bold text-warn-400">off 400</p>
                    <p className="mt-1 font-mono text-[11px] leading-tight text-ink-400">
                      {listing.exit.name}
                      <br />
                      <span className="text-ink-500">{listing.exit.miles} mi away</span>
                    </p>
                  </>
                )}
              </div>
            )}
            {listing.anchors!.map((a) => (
              <div key={a.key} title={a.note} className="rounded-xl border border-ink-700 bg-ink-900/60 p-3">
                <p className="font-mono text-[10px] uppercase tracking-widest text-ink-500">
                  {a.label}
                </p>
                <p className="mt-1 font-mono text-lg font-bold text-ink-100">
                  {a.miles} <span className="text-[11px] font-normal text-ink-500">mi</span>
                </p>
                {/* The miles do not change; the minutes are what you feel. */}
                {a.peakMinutes !== undefined && (
                  <p className="mt-1 font-mono text-[11px] leading-tight text-ink-400">
                    <span className="text-warn-400">{a.peakMinutes}</span> min at 5pm
                    <br />
                    <span className="text-ink-500">{a.freeMinutes} min clear road</span>
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2.5 text-[11px] leading-relaxed text-ink-500">
            The exit is the GA-400 interchange you would come off, and how far the house
            sits from that ramp. Miles to the anchors are straight-line; the minutes are the actual drive, leaving 5pm
            on an ordinary Tuesday against the same road clear. Avalon is on the list
            because you said you never go — it marks where built-up Alpharetta ends,
            which is the useful thing about it.
          </p>
        </section>
      )}

      <MyNotes listing={listing} onSaved={onListingChanged} />

      <StreetOwners listing={listing} onSaved={onListingChanged} />

      {/* Directly under the score, not nine sections down.
          "Compromises on something you said mattered" is only a useful sentence
          if the very next thing you see is which ones. */}
      {assessment && (
        <DimensionBars
          dimensions={assessment.dimensions}
          math={assessment.math}
          score={assessment.matchScore}
        />
      )}

      {/* This house against all the others. A distance in miles is abstract;
          a pin among sixty others is not. */}
      {listing.coords && allRows.length > 1 && (
        <HouseMap rows={allRows} anchors={anchors} activeId={listing.id} onSelect={onSelect} compact />
      )}

      {openHouses.length > 0 && (
        <section className="rounded-2xl border border-brand-500/30 bg-brand-500/[0.06] p-4">
          <h3 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-brand-400">
            <CalendarDays size={13} /> Open house
          </h3>
          <ul className="space-y-1">
            {openHouses.map((o) => (
              <li key={o.start} className="font-mono text-[12.5px] text-ink-100">
                {when(o.start, o.end)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
            You can walk it without an agent or an appointment. Past dates disappear on
            their own; press Open houses to re-check.
          </p>
        </section>
      )}

      {/* ------------------------- the hard rules ------------------------- */}
      {assessment && (
        <section className={`rounded-2xl border p-5 ${
          assessment.ruledOut
            ? 'border-bad-500/40 bg-bad-500/[0.06]'
            : 'border-ink-700 bg-ink-850'
        }`}>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-ink-300">
            {assessment.ruledOut ? <Ban size={14} className="text-bad-400" /> : <CheckCircle2 size={14} className="text-good-400" />}
            Your two hard rules
          </h3>

          {assessment.ruledOut && (
            <p className="mb-4 text-[13.5px] font-medium leading-relaxed text-bad-400">
              {assessment.ruledOut}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {/* facing */}
            <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-4">
              <div className="flex items-center gap-2">
                <Compass size={14} className="text-brand-400" />
                <span className="text-[12px] font-semibold uppercase tracking-wider text-ink-300">
                  Which way it faces
                </span>
              </div>
              <p className="mt-2 font-mono text-2xl font-bold text-white">
                {o?.entranceDirection === 'Unknown' ? 'Unknown' : o?.entranceDirection}
                {o?.bearingDeg !== null && o?.bearingDeg !== undefined && (
                  <span className="ml-2 text-sm font-normal text-ink-400">{o.bearingDeg.toFixed(0)}°</span>
                )}
              </p>
              <p className={`mt-1 font-mono text-[11px] uppercase tracking-wider ${CONFIDENCE_TONE[o?.confidence ?? 'none']}`}>
                {o?.confidence ?? 'none'} confidence
              </p>
              <p className="mt-2 text-[11.5px] leading-snug text-ink-400">{o?.method}</p>

              {/* Check it yourself in ten seconds.
                  The bearing is the line from the house to the nearest Street
                  View camera, so the photograph that camera took should be
                  looking at the front door. If it shows the front, the number is
                  right; if it shows a side wall or the neighbour, it is not. */}
              {/* The override used to render only when there was a Street View
                  shot to show, which had it exactly backwards: a house with no
                  Street View is measured off the road network, that reading has
                  been 180° wrong, and it was the one house he could not correct.
                  7395 Winderlea Ln sat ruled out on a road 63 m away with no
                  button to say otherwise. The control shows always. */}
              {o && (
                <div className="mt-3 border-t border-ink-700 pt-3">
                  {o.streetViewUrl ? (
                    <>
                      <p className="mb-1.5 text-[11px] uppercase tracking-wider text-ink-500">
                        Check it — this is the view the bearing was measured from
                      </p>
                      <SmartImage
                        src={o.streetViewUrl}
                        alt="Street View looking at the house"
                        className="aspect-[16/10] overflow-hidden rounded-lg border border-ink-700"
                        empty="No Street View on this street."
                      />
                      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-500">
                        Front door in shot? Then {o.entranceDirection} is right. A side
                        wall or the wrong house means it is not — set it below and the
                        Vastu reading follows your answer instead.
                      </p>
                    </>
                  ) : (
                    <p className="mb-1.5 text-[11px] leading-relaxed text-ink-500">
                      No Street View on this street, so this was measured off the road
                      network — the weakest reading the tool makes. A satellite view or
                      thirty seconds on the kerb beats it. Set what you saw.
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap gap-1">
                    {(['North', 'North-East', 'East', 'South-East',
                       'South', 'South-West', 'West', 'North-West'] as const).map((dir) => (
                      <button
                        key={dir}
                        onClick={() => guard('facing', async () => {
                          onListingChanged(await patchListing(listing.id, {
                            observedFacing: listing.observedFacing === dir ? undefined : dir,
                          }));
                          onRescan();
                        })}
                        disabled={busy !== null}
                        className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] transition disabled:opacity-40
                          ${listing.observedFacing === dir
                            ? 'border-good-500/60 bg-good-500/15 text-good-400'
                            : 'border-ink-700 text-ink-500 hover:border-ink-600 hover:text-ink-300'}`}
                      >
                        {dir.replace('North', 'N').replace('East', 'E')
                            .replace('South', 'S').replace('West', 'W').replace('-', '')}
                      </button>
                    ))}
                  </div>
                  {/* Knowing a reading is wrong and knowing the right answer are
                      two different pieces of information, and the tool only
                      accepted the second. He said Winderlea was not south without
                      saying what it was; with only eight direction buttons the
                      choice was to invent a direction or leave it ruled out.
                      This records the doubt on its own: not ruled out, and not
                      credited with a facing either. */}
                  <button
                    onClick={() => guard('facing', async () => {
                      onListingChanged(await patchListing(listing.id, {
                        observedFacing: listing.observedFacing === 'Unknown' ? undefined : 'Unknown',
                      }));
                      onRescan();
                    })}
                    disabled={busy !== null}
                    className={`mt-1.5 rounded-md border px-2 py-0.5 text-[10.5px] transition disabled:opacity-40
                      ${listing.observedFacing === 'Unknown'
                        ? 'border-warn-500/60 bg-warn-500/15 text-warn-400'
                        : 'border-ink-700 text-ink-500 hover:border-ink-600 hover:text-ink-300'}`}
                  >
                    Not that — I looked, but cannot say which
                  </button>

                  {listing.observedFacing && listing.observedFacing !== 'Unknown' && (
                    <p className="mt-1.5 text-[11px] text-good-400">
                      You set this to {listing.observedFacing}. That overrides the measurement.
                    </p>
                  )}
                  {listing.observedFacing === 'Unknown' && (
                    <p className="mt-1.5 text-[11px] text-warn-400">
                      You rejected the measurement without naming a direction. The house is
                      not ruled out, and its facing scores nothing either way.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* fence */}
            <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-4">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold uppercase tracking-wider text-ink-300">
                  Fenced backyard
                </span>
              </div>
              {/* "Cannot tell" means an aerial was read and the fence was not
                  visible. That is a different fact from never having looked,
                  and collapsing the two is how a blank starts reading as a no. */}
              {/* What he saw outranks what the aerial guessed. Georgia canopy
                  hides fence lines on most of these, and he has stood in some
                  of these gardens. */}
              <p className={`mt-2 font-mono text-2xl font-bold ${
                listing.observed?.fenced === 'Yes' ? 'text-good-400'
                : listing.observed?.fenced === 'No' ? 'text-bad-400'
                : !assessment.evidence.aerialRead ? 'text-ink-500'
                : assessment.perception.yardFenced === 'Yes' ? 'text-good-400'
                : assessment.perception.yardFenced === 'No' ? 'text-bad-400' : 'text-warn-400'
              }`}>
                {listing.observed?.fenced
                  ? listing.observed.fenced
                  : !assessment.evidence.aerialRead ? 'Not read yet'
                  : assessment.perception.yardFenced === 'Unclear' ? 'Cannot tell'
                  : assessment.perception.yardFenced}
              </p>
              {listing.observed?.fenced && (
                <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-wider text-good-400">
                  you saw this yourself
                </p>
              )}
              {assessment.evidence.aerialRead && (
                <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-ink-500">
                  {assessment.perception.yardUsableSize.toLowerCase()} · {assessment.perception.yardGrade.toLowerCase()}
                </p>
              )}
              <p className="mt-2 text-[11.5px] leading-snug text-ink-400">
                {assessment.evidence.aerialRead
                  ? assessment.perception.yardEvidence
                  : 'No aerial has been read for this house yet.'}
              </p>

              {assessment.evidence.aerialRead && (
                <p className="mt-1.5 text-[11.5px] leading-snug text-ink-500">
                  Neighbouring yards: <span className="text-ink-300">
                    {assessment.perception.neighboursHaveFences.toLowerCase()}
                  </span> have fences.
                </p>
              )}

              <div className="mt-3 border-t border-ink-700 pt-3">
                <p className="mb-1.5 text-[11px] uppercase tracking-wider text-ink-500">
                  You have seen it — is there a fence?
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(['Yes', 'No'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => guard('observed', async () => {
                        onListingChanged(await patchListing(listing.id, {
                          observed: { fenced: listing.observed?.fenced === v ? undefined : v },
                        }));
                        onRescan();
                      })}
                      disabled={busy !== null}
                      className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition disabled:opacity-40
                        ${listing.observed?.fenced === v
                          ? v === 'Yes' ? 'border-good-500/50 bg-good-500/15 text-good-400'
                            : 'border-bad-500/50 bg-bad-500/15 text-bad-400'
                          : 'border-ink-700 text-ink-400 hover:border-ink-600'}`}
                    >
                      {v === 'Yes' ? 'Yes, it is fenced' : 'No fence'}
                    </button>
                  ))}
                </div>

                <p className="mt-2.5 mb-1.5 text-[11px] uppercase tracking-wider text-ink-500">
                  And the yard itself?
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(['Generous', 'Adequate', 'Cramped'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => guard('observed', async () => {
                        onListingChanged(await patchListing(listing.id, {
                          observed: { yardSize: listing.observed?.yardSize === v ? undefined : v },
                        }));
                        onRescan();
                      })}
                      disabled={busy !== null}
                      className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition disabled:opacity-40
                        ${listing.observed?.yardSize === v
                          ? 'border-brand-500/50 bg-brand-500/15 text-brand-400'
                          : 'border-ink-700 text-ink-400 hover:border-ink-600'}`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                {/* Open water is the one aerial finding that caps a house
                    outright, so it gets the same escape hatch as the fence. */}
                <p className="mt-2.5 mb-1.5 text-[11px] uppercase tracking-wider text-ink-500">
                  Is there open water against the lot?
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {([['yes', true], ['no', false]] as const).map(([label, v]) => (
                    <button
                      key={label}
                      onClick={() => guard('observed', async () => {
                        onListingChanged(await patchListing(listing.id, {
                          observed: {
                            backsOntoWater: listing.observed?.backsOntoWater === v ? undefined : v,
                          },
                        }));
                        onRescan();
                      })}
                      disabled={busy !== null}
                      className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition disabled:opacity-40
                        ${listing.observed?.backsOntoWater === v
                          ? v ? 'border-bad-500/50 bg-bad-500/15 text-bad-400'
                              : 'border-good-500/50 bg-good-500/15 text-good-400'
                          : 'border-ink-700 text-ink-400 hover:border-ink-600'}`}
                    >
                      {v ? 'Yes, water touches it' : 'No, it does not'}
                    </button>
                  ))}
                </div>

                <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
                  These replace whatever the aerial concluded, and survive every
                  re-read.
                </p>
              </div>

              {/* "Not fenced" and "cannot be fenced" are different houses.
                  Only the covenants know which, so this is the one thing that
                  has to be typed in. */}
              <div className="mt-3 border-t border-ink-700 pt-3">
                <p className="mb-1.5 text-[11px] uppercase tracking-wider text-ink-500">
                  Does the HOA allow a fence?
                </p>
                <div className="flex gap-1.5">
                  {(['yes', 'no', 'unknown'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => guard('fence', async () => {
                        onListingChanged(await patchListing(listing.id, { fencePermitted: v }));
                        onRescan();
                      })}
                      disabled={busy !== null}
                      className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition disabled:opacity-40
                        ${(listing.fencePermitted ?? 'unknown') === v
                          ? v === 'yes' ? 'border-good-500/50 bg-good-500/15 text-good-400'
                            : v === 'no' ? 'border-bad-500/50 bg-bad-500/15 text-bad-400'
                            : 'border-ink-600 bg-ink-800 text-ink-300'
                          : 'border-ink-700 text-ink-400 hover:border-ink-600'}`}
                    >
                      {v === 'yes' ? 'Allowed' : v === 'no' ? 'Forbidden' : "Don't know"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ---------------------------- imagery ---------------------------- */}
      <PlanCompass
        listing={listing}
        orientation={assessment?.orientation}
        perception={assessment?.perception}
        onRemove={(i) => guard('plan', async () => {
          onListingChanged(await removePlan(listing.id, i));
          onRescan();
        })}
        busy={busy !== null}
      />

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-850">
          <div className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Aerial, close in
          </div>
          {/* Google's satellite tiles are one to three years old in Forsyth,
              and every new build on this list was photographed before it
              existed. The reader already answers "is there a house here?", so
              say it out loud rather than letting a picture of mud be read as a
              picture of the garden. */}
          {assessment?.perception && assessment.evidence.aerialRead
            && !assessment.perception.houseVisibleInAerial && (
            <p className="border-b border-warn-500/25 bg-warn-500/[0.08] px-4 py-2 text-[11.5px] leading-relaxed text-warn-400">
              This photograph predates the house — it shows bare ground. Nothing
              here tells you about the garden, the fence or the neighbours, and
              the satellite links below will show the same empty lot. Street View
              is sometimes newer; the builder&rsquo;s own site is newer still.
            </p>
          )}
          <SmartImage
            src={listing.images.aerial}
            alt="Aerial view"
            className="aspect-[4/3]"
            empty="Run the neighbourhood lookup to pull this from the map."
          />
        </div>
        <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-850">
          <div className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Aerial, wider
          </div>
          <SmartImage
            src={listing.images.aerialWide ?? listing.images.aerial}
            alt="Wider aerial view"
            className="aspect-[4/3]"
            empty="Shows what the lot backs onto."
          />
        </div>
      </section>

      {(listing.images.gallery?.length ?? 0) > 0 && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {listing.images.gallery!.slice(0, 4).map((g, i) => (
            <SmartImage
              key={g}
              src={g}
              alt={`Photo ${i + 1} of ${listing.address}`}
              className="aspect-[4/3] overflow-hidden rounded-xl border border-ink-700"
            />
          ))}
        </section>
      )}

      {/* -------------------------- what it read -------------------------- */}
      {assessment && (
        <>
          {assessment.cons.length > 0 && (
            <section className="rounded-2xl border border-ink-700 bg-ink-850 p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-ink-300">
                <AlertTriangle size={14} className="text-warn-400" /> Check before you go
              </h3>
              <ul className="space-y-2">
                {assessment.cons.map((c, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-300">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-warn-400" />
                    {c}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <HighlightsPanel highlights={assessment.highlights as never} />

          <NearbyPanel nearby={listing.nearby as never} />

          <NegotiationPanel n={assessment.negotiation as never} />

          <MarketPanel market={assessment.market as never} />

          {/* The same drawing on other lots, immediately above the Vastu
              reading it explains — the reading is what this plan scores here,
              this is what it would score turned another way. */}
          {(() => {
            const fam = plans.find((f) => f.houses.some((h) => h.id === listing.id));
            if (!fam) return null;
            const me = fam.houses.find((h) => h.id === listing.id)!;
            return (
              <PlanFamilyPanel
                plan={{ byFacing: fam.byFacing, best: fam.best, current: me.score, forgone: me.forgone }}
                siblings={fam.houses
                  .filter((h) => h.id !== listing.id)
                  .map((h) => ({ ...h, better: h.score - me.score }))}
                onSelect={onSelect}
              />
            );
          })()}

          <VastuPanel vastu={assessment.vastu as never} />

          <HealthPanel
            health={assessment.health as never}
            systems={assessment.systems as never}
          />

          <FeedbackDock
            listing={listing}
            assessment={assessment}
            profile={profile}
            onProfileChanged={onProfileChanged}
            onRescan={onRescan}
          />

          <AgentTrace steps={assessment.trace} totalMs={assessment.totalMs} cached={assessment.cached} />
        </>
      )}

      {!assessment && (
        <section className="rounded-2xl border border-dashed border-ink-700 p-8 text-center">
          <RefreshCw size={20} className="mx-auto mb-3 text-ink-500" />
          <p className="text-[13px] text-ink-400">
            Not read yet. Add a floor plan and look up the neighbourhood, then run a scan.
          </p>
        </section>
      )}
    </div>
  );
}
