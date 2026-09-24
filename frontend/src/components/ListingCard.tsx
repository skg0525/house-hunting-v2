'use client';

import {
  Ban, Bed, Bath, Ruler, Loader2, ThumbsDown, Star, Compass, Trees, CalendarDays, Layers, Footprints, Bookmark, Clock, Hourglass, Hammer, UserRound,
} from 'lucide-react';
import { SmartImage } from './SmartImage';
import type { Assessment, Listing } from '@/types/listing';

const band = (s: number) =>
  s >= 85 ? { chip: 'bg-good-500/15 text-good-400 ring-good-500/30', word: 'Strong fit' }
  : s >= 70 ? { chip: 'bg-brand-500/15 text-brand-400 ring-brand-500/30', word: 'Worth a look' }
  : s >= 55 ? { chip: 'bg-warn-400/15 text-warn-400 ring-warn-400/30', word: 'Compromised' }
  : { chip: 'bg-bad-500/15 text-bad-400 ring-bad-500/30', word: 'Skip' };

export function ListingCard({
  listing, assessment, isActive, isPending, rank, onClick,
}: {
  listing: Listing;
  assessment?: Assessment;
  isActive: boolean;
  isPending: boolean;
  rank?: number;
  onClick: () => void;
}) {
  const out = Boolean(assessment?.ruledOut);
  const b = assessment && !out ? band(assessment.matchScore) : null;
  const rejected = assessment?.verdict === 'rejected';
  const selfTour = assessment?.verdict === 'selfTour';
  const agentTour = assessment?.verdict === 'agentTour';
  const shortlisted = assessment?.verdict === 'shortlisted';
  const maybe = assessment?.verdict === 'maybe';
  const longDrive = (listing.commute?.badDayMinutes ?? 0) >= 30;
  const pending = listing.status === 'pending';
  const toured = Boolean(listing.touredAt);

  return (
    <button
      onClick={onClick}
      aria-current={isActive}
      className={`group w-full overflow-hidden rounded-xl border text-left transition-all duration-200
        ${isActive
          ? 'border-brand-500/60 bg-brand-500/[0.07] ring-1 ring-brand-500/40'
          : 'border-ink-700 bg-ink-850 hover:border-ink-600 hover:bg-ink-800'}
        ${out || rejected ? 'opacity-50' : ''}`}
    >
      <div className="flex gap-3 p-3">
        <div className="relative shrink-0">
          {/* The front of the house, not the roof from above. Satellite tiles
              all look alike and connect to nothing — after forty tours you
              remember the brick and the porch. The aerial stays on the detail
              page where it is doing real work. */}
          <SmartImage
            src={listing.images.exterior ?? listing.images.aerial}
            alt={`${listing.address}`}
            className="h-24 w-24 rounded-lg"
            empty="No photo yet"
          />
          {rank !== undefined && assessment && (
            <span className="absolute -left-1.5 -top-1.5 flex h-6 w-6 items-center justify-center
                             rounded-full bg-ink-950 font-mono text-[11px] font-bold text-ink-200
                             ring-1 ring-ink-600">
              {rank}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-lg font-semibold text-white">
              {listing.price ? `$${(listing.price / 1000).toFixed(0)}k` : '—'}
            </span>
            {assessment && (
              /* Two numbers, and they have to read as two. Printed tight as
                 "45(79)" they looked like one strange figure and went unnoticed
                 for days. */
              <span className="flex shrink-0 flex-col items-end leading-none">
                <span className={`font-mono text-[15px] font-bold ${out ? 'text-bad-400' : 'text-ink-100'}`}>
                  {assessment.matchScore}
                </span>
                {/* The drive home at five, right under the score.
                    It is the number that decides whether he is home for
                    bedtime, and it was three clicks away. */}
                {(() => {
                  const mins = listing.observedPeakMinutes ?? listing.commute?.worstMinutes;
                  if (mins === undefined) return null;
                  const bad = listing.commute?.badDayMinutes;
                  return (
                    <span
                      title={`Work to home leaving 5pm on an ordinary evening${bad ? `, ${bad} min on a bad one` : ''}`}
                      className={`mt-[3px] font-mono text-[10px] ${
                        mins <= 20 ? 'text-good-400' : mins <= 30 ? 'text-ink-400' : 'text-warn-400'}`}
                    >
                      {mins}m at 5pm{bad ? ` / ${bad}` : ''}
                    </span>
                  );
                })()}
                {assessment.baseScore !== assessment.matchScore && (
                  <span
                    className="mt-[3px] font-mono text-[9.5px] text-ink-500"
                    title="What it scores on its own merits, before a hard rule or your own pass held it down"
                  >
                    {assessment.baseScore} on merit
                  </span>
                )}
              </span>
            )}
            {isPending && <Loader2 size={14} className="animate-spin text-brand-400" />}
          </div>

          <p className="mt-0.5 truncate text-[13px] text-ink-300">
            {listing.address.split(',')[0]}
          </p>

          <div className="mt-1.5 flex items-center gap-3 font-mono text-[11px] text-ink-500">
            {listing.beds > 0 && <span className="flex items-center gap-1"><Bed size={11} />{listing.beds}</span>}
            {listing.baths > 0 && <span className="flex items-center gap-1"><Bath size={11} />{listing.baths}</span>}
            {listing.sqft > 0 && <span className="flex items-center gap-1"><Ruler size={11} />{(listing.sqft / 1000).toFixed(1)}k</span>}
            {listing.lotSizeAcres > 0 && <span>{Math.floor(listing.lotSizeAcres * 10) / 10} ac</span>}
            {/* Two prices per foot, because they answer different questions and
                on this list they disagree. The house figure says whether the
                building is dear; the land figure says how much ground the money
                actually buys — which is the one that matters when a usable
                back garden is third on the list. */}
            {listing.price > 0 && listing.sqft > 0 && (
              <span title={`$${Math.round(listing.price / listing.sqft)} per sq ft of house`}>
                ${Math.round(listing.price / listing.sqft)}/ft²
              </span>
            )}
            {listing.price > 0 && listing.lotSizeAcres > 0 && (
              <span
                title={`$${Math.round(listing.price / (listing.lotSizeAcres * 43560))} per sq ft of land — what the ground costs`}
                className="text-ink-400"
              >
                ${Math.round(listing.price / (listing.lotSizeAcres * 43560))}/ft² land
              </span>
            )}
            {/* He navigates by exit number, not postcode. */}
            {listing.exit && (
              <span
                title={listing.exit.number
                  ? `${listing.exit.miles} miles from the ${listing.exit.name} interchange`
                  : 'More than 8 miles from any GA-400 interchange'}
                className={listing.exit.number ? 'text-ink-400' : 'text-warn-400'}
              >
                {listing.exit.number ? `exit ${listing.exit.number}` : 'off 400'}
              </span>
            )}
            {listing.hoaMonthly > 0 && <span>HOA ${listing.hoaMonthly}</span>}
          </div>

          {/* An open house is a date you plan a Saturday around, so it belongs
              in the list rather than three clicks in. */}
          {(listing.openHouses?.length ?? 0) > 0 && (
            <p className={`mt-1.5 flex items-center gap-1 font-mono text-[10.5px] ${
              listing.openHouses![0]!.suspect ? 'text-warn-400' : 'text-brand-400'}`}>
              <CalendarDays size={10} />
              {(() => {
                const o = listing.openHouses![0]!;
                const d = new Date(o.start.slice(0, 10));
                const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
                const when = days <= 0 ? ' · today' : days === 1 ? ' · tomorrow' : ` · in ${days}d`;
                const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
                /* Redfin published a start time that cannot be real. Give the day
                   and the end, which are sound, and say the start is not — rather
                   than printing "1 AM" in the same confident type as a real time. */
                if (o.suspect)
                  return `${day}, ends ${new Date(o.end).toLocaleTimeString(undefined, { hour: 'numeric' })}` +
                         `${when} — start time looks wrong on Redfin, call first`;
                return `${day} ${d.toLocaleTimeString(undefined, { hour: 'numeric' })}${when}`;
              })()}
            </p>
          )}

          {/* The two facts that decide everything, visible without opening the house. */}
          {assessment && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {out ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-bad-500/15 px-2 py-0.5
                                 text-[11px] font-semibold text-bad-400 ring-1 ring-inset ring-bad-500/30">
                  <Ban size={10} /> Ruled out
                </span>
              ) : b && (
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${b.chip}`}>
                  {b.word}
                </span>
              )}

              <span className="inline-flex items-center gap-1 rounded-md bg-ink-800 px-2 py-0.5 font-mono text-[10px] text-ink-400">
                <Compass size={10} />
                {assessment.orientation.entranceDirection === 'Unknown'
                  ? '?'
                  : assessment.orientation.entranceDirection}
              </span>

              {listing.isNewConstruction && (
                <span className="rounded-md bg-saffron-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-saffron-400">
                  new build
                </span>
              )}

              {/* Freshly listed. Days-on-market rounds both "26 hours" and
                  "this morning" to zero, and neither seller will entertain the
                  offer a house at eighty days will. */}
              {listing.hoursOnMarket !== undefined && listing.hoursOnMarket < 96 && (
                <span className="rounded-md bg-brand-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-brand-400">
                  {listing.hoursOnMarket < 48
                    ? `new ${listing.hoursOnMarket}h`
                    : `new ${Math.round(listing.hoursOnMarket / 24)}d`}
                </span>
              )}

              {/* A finished basement is a floor of living space that does not
                  show in the room count, and the guest suite question answered.
                  Twenty-three of sixty-one have one and it was invisible. */}
              {(listing.basement === 'finished' || listing.basement === 'partly finished') && (
                <span
                  title={listing.basementEvidence}
                  className="inline-flex items-center gap-1 rounded-md bg-good-500/12 px-2 py-0.5 font-mono text-[10px] text-good-400"
                >
                  <Layers size={10} />
                  {listing.basement === 'finished' ? 'basement' : 'part basement'}
                </span>
              )}
              {listing.basement === 'unfinished' && (
                <span
                  title={listing.basementEvidence}
                  className="inline-flex items-center gap-1 rounded-md bg-ink-800 px-2 py-0.5 font-mono text-[10px] text-ink-400"
                >
                  <Layers size={10} /> unfin. basement
                </span>
              )}

              {/* Loudest badge on the card, because it is the one fact that makes
                  everything else on it irrelevant. Three of these were on a
                  Sunday tour list before the tool could read them. */}
              {listing.referredBy && (
                <span title={`${listing.referredBy} sent you this one`}
                      className="inline-flex items-center gap-1 rounded-md bg-saffron-500/12 px-2 py-0.5 text-[10px] font-semibold text-saffron-400">
                  <UserRound size={10} /> {listing.referredBy}
                </span>
              )}

              {listing.ageRestricted && (
                <span
                  title={listing.ageRestrictedEvidence}
                  className="inline-flex items-center gap-1 rounded-md bg-bad-500/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-bad-400"
                >
                  <Ban size={10} /> 55+ only
                </span>
              )}

              {listing.isHot && (
                <span className="rounded-md bg-bad-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-bad-400">
                  hot
                </span>
              )}

              {/* Four states, not three. "No fence" and "no fence but the HOA
                  allows one" are different houses — one is a dealbreaker and
                  the other is four to nine thousand pounds of fence and a
                  negotiating item. Collapsing them made a house he had already
                  cleared keep reading as ruled out. */}
              {(() => {
                const f = assessment.perception.yardFenced;
                const seen = Boolean(listing.observed?.fenced);
                const canFence = listing.fencePermitted === 'yes';
                const [text, tone] =
                  f === 'Yes' ? [seen ? 'fenced ✓' : 'fenced', 'bg-good-500/12 text-good-400']
                  : f === 'No' && canFence ? ['fence allowed', 'bg-warn-500/12 text-warn-400']
                  : f === 'No' ? ['no fence', 'bg-bad-500/12 text-bad-400']
                  : canFence ? ['fence? allowed', 'bg-ink-800 text-ink-300']
                  : ['fence?', 'bg-ink-800 text-ink-400'];
                return (
                  <span
                    title={seen ? 'You confirmed this in person — it overrides the aerial.'
                          : canFence && f !== 'Yes' ? 'No fence up, but you recorded that the HOA permits one.'
                          : undefined}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[10px] ${tone}`}
                  >
                    <Trees size={10} />{text}
                  </span>
                );
              })()}

              {rejected && (
                <span className="inline-flex items-center gap-1 rounded-md bg-ink-800 px-2 py-0.5 text-[10px] font-semibold text-ink-400">
                  <ThumbsDown size={10} /> Passed
                </span>
              )}
              {selfTour && (
                <span title="You can walk into this one yourself"
                      className="inline-flex items-center gap-1 rounded-md bg-brand-500/12 px-2 py-0.5 text-[10px] font-semibold text-brand-400">
                  <Footprints size={10} /> go myself
                </span>
              )}
              {maybe && (
                <span title="Kept — not a no, not promoted"
                      className="inline-flex items-center gap-1 rounded-md bg-ink-700/60 px-2 py-0.5 text-[10px] font-semibold text-ink-200">
                  <Bookmark size={10} /> maybe
                </span>
              )}
              {shortlisted && (
                <span title="Toured and liked — a real contender"
                      className="inline-flex items-center gap-1 rounded-md bg-good-500/12 px-2 py-0.5 text-[10px] font-semibold text-good-400">
                  <Star size={10} /> shortlisted
                </span>
              )}
              {agentTour && (
                <span title="Needs a showing arranged"
                      className="inline-flex items-center gap-1 rounded-md bg-saffron-500/12 px-2 py-0.5 text-[10px] font-semibold text-saffron-400">
                  <Star size={10} /> ask agent
                </span>
              )}
              {/* Under contract. It was invisible on the card, so a house that
                  had already gone looked exactly like one he could still buy —
                  and roughly one in five of these falls through, so it cannot
                  just be hidden either. */}
              {pending && (
                <span title="Under contract — often falls through, so it is kept"
                      className="inline-flex items-center gap-1 rounded-md bg-warn-500/15 px-2 py-0.5 text-[10px] font-semibold text-warn-400">
                  <Hourglass size={10} /> under contract
                </span>
              )}
              {/* Who built it and what they call the place. New construction is
                  a product line, not a street, and he had been holding this in
                  his head across four Toll Brothers communities. */}
              {listing.builder && (
                <span title={listing.community ? `${listing.community} by ${listing.builder}` : listing.builder}
                      className="inline-flex items-center gap-1 rounded-md bg-ink-700/70 px-2 py-0.5 text-[10px] font-semibold text-ink-300">
                  <Hammer size={10} /> {listing.community ?? listing.builder}
                </span>
              )}
              {toured && (
                <span title={`You toured this on ${new Date(listing.touredAt!).toLocaleDateString()}`}
                      className="inline-flex items-center gap-1 rounded-md bg-brand-500/12 px-2 py-0.5 text-[10px] font-semibold text-brand-400">
                  <Footprints size={10} /> toured
                </span>
              )}
              {longDrive && (
                <span title={`${listing.commute?.badDayMinutes} minutes on a bad evening. Costs the house points; does not remove it.`}
                      className="inline-flex items-center gap-1 rounded-md bg-warn-500/12 px-2 py-0.5 text-[10px] font-semibold text-warn-400">
                  <Clock size={10} /> {listing.commute?.badDayMinutes}m
                </span>
              )}
            </div>
          )}

          {/* The one line that says why, without opening the house.
              A band word — "Compromises on something you said mattered" — names
              a feeling; these name the two dimensions that produced it. */}
          {assessment && !out && (() => {
            const avg = assessment.math?.average ?? assessment.matchScore;
            const weak = assessment.dimensions
              .filter((d) => d.available && d.weight > 0 && d.score < avg)
              .sort((a, b) => (avg - b.score) * b.weight - (avg - a.score) * a.weight)
              .slice(0, 2);
            if (!weak.length) return null;
            return (
              <p className="mt-1.5 truncate text-[11px] text-ink-500">
                held back by{' '}
                {weak.map((d, i) => (
                  <span key={d.key}>
                    {i > 0 && ' and '}
                    <span className="text-ink-400">{d.label.toLowerCase()}</span>
                    <span className="font-mono text-ink-500"> {d.score}</span>
                  </span>
                ))}
              </p>
            );
          })()}
        </div>
      </div>
    </button>
  );
}
