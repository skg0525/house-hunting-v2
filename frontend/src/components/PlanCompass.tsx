'use client';

import { useState } from 'react';
import { SmartImage } from './SmartImage';
import type { Listing, Orientation, Perception } from '@/types/listing';

/**
 * A floor plan with north drawn on it.
 *
 * Listing plans have no north arrow — that is the whole problem this project
 * exists around. But two things are known: which edge of the page the front
 * door sits on, and the true bearing the house faces, measured from the street.
 * The difference between them is how far the drawing is rotated, and once you
 * have that you can draw the compass the plan never had.
 *
 * It is the one place the measurement becomes visible rather than asserted. If
 * the rose points somewhere that contradicts what you saw standing in the
 * driveway, the reading is wrong and everything downstream of it is too.
 */

const EDGE_DEG: Record<string, number> = { Top: 0, Right: 90, Bottom: 180, Left: 270 };
const DEG: Record<string, number> = {
  North: 0, 'North-East': 45, East: 90, 'South-East': 135,
  South: 180, 'South-West': 225, West: 270, 'North-West': 315,
};

export function PlanCompass({
  listing, orientation, perception, onRemove, busy,
}: {
  listing: Listing;
  orientation?: Orientation;
  perception?: Perception;
  /** Take one plan back off, for when the wrong image went on. */
  onRemove?: (index: number) => void;
  busy?: boolean;
}) {
  const [showRose, setShowRose] = useState(true);

  const plans = [
    listing.images.floorPlan,
    ...(listing.images.floorPlanExtra ?? []),
  ].filter(Boolean) as string[];

  if (!plans.length) return null;

  const edge = perception?.entranceEdgeOnPlan;
  const facing = orientation?.entranceDirection;
  const edgeDeg = edge ? EDGE_DEG[edge] : undefined;
  const faceDeg = facing && facing !== 'Unknown' ? DEG[facing] : undefined;

  /* How far the page is turned relative to true north. If the front door is at
     the bottom of the page and the house faces east, the bottom of the page IS
     east, so the page is rotated 90 degrees anticlockwise from north-up. */
  const rotation =
    edgeDeg !== undefined && faceDeg !== undefined
      ? (edgeDeg - faceDeg + 360) % 360
      : undefined;

  const canOrient = rotation !== undefined && orientation?.confidence !== 'none';

  return (
    <section className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-850">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
          Floor plan{plans.length > 1 ? `s · ${plans.length}` : ''}
        </span>
        {canOrient && (
          <button
            onClick={() => setShowRose((v) => !v)}
            className={`ml-auto rounded-md border px-2 py-0.5 font-mono text-[10px] transition ${
              showRose
                ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
                : 'border-ink-700 text-ink-500 hover:text-ink-300'
            }`}
          >
            {showRose ? 'compass on' : 'compass off'}
          </button>
        )}
      </div>

      <div className={plans.length > 1 ? 'grid gap-px bg-ink-700 sm:grid-cols-2' : ''}>
        {plans.map((src, i) => (
          <div key={src} className="relative bg-ink-900">
            <SmartImage
              src={src}
              alt={`Floor plan ${i + 1} of ${listing.address}`}
              className="aspect-[4/3]"
              imgClassName="object-contain bg-white"
            />

            {onRemove && (
              <button
                onClick={() => onRemove(i)}
                disabled={busy}
                title="Remove this plan"
                className="absolute left-3 top-3 rounded-md border border-ink-700 bg-ink-950/80 px-2 py-0.5
                           font-mono text-[10px] text-ink-400 transition hover:border-bad-500/50
                           hover:text-bad-400 disabled:opacity-40"
              >
                remove
              </button>
            )}

            {canOrient && showRose && (
              <>
                {/* The rose sits over the drawing, turned to match. */}
                <svg
                  viewBox="0 0 100 100"
                  className="pointer-events-none absolute right-3 top-3 h-20 w-20 drop-shadow"
                  aria-hidden
                >
                  <circle cx="50" cy="50" r="34" fill="rgba(11,14,23,.82)" stroke="rgba(125,211,252,.5)" strokeWidth="1.5" />
                  <g transform={`rotate(${-rotation!} 50 50)`}>
                    <path d="M50 14 L56 46 L50 42 L44 46 Z" fill="#fb7185" />
                    <path d="M50 86 L44 54 L50 58 L56 54 Z" fill="#7dd3fc" opacity=".65" />
                    <text x="50" y="11" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fb7185">N</text>
                    <text x="50" y="97" textAnchor="middle" fontSize="9" fill="#7dd3fc" opacity=".75">S</text>
                    <text x="94" y="54" textAnchor="middle" fontSize="9" fill="#7dd3fc" opacity=".75">E</text>
                    <text x="6" y="54" textAnchor="middle" fontSize="9" fill="#7dd3fc" opacity=".75">W</text>
                  </g>
                </svg>

                {i === 0 && (
                  <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-ink-950/85 px-2.5 py-1.5">
                    <p className="font-mono text-[10px] leading-tight text-ink-300">
                      front door on the <span className="text-brand-400">{edge?.toLowerCase()}</span> of the page
                      <br />
                      faces <span className="text-brand-400">{facing?.toLowerCase()}</span>
                      {orientation?.bearingDeg !== null && orientation?.bearingDeg !== undefined
                        ? ` ${orientation.bearingDeg.toFixed(0)}°`
                        : ''}
                      <br />
                      <span className="text-ink-500">
                        so the page is turned {rotation}° from north-up
                      </span>
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {!canOrient && (
        <p className="px-4 pb-3 text-[11px] leading-relaxed text-ink-500">
          {orientation?.confidence === 'none'
            ? 'The facing direction was never measured, so the plan cannot be turned to north.'
            : 'The front door was not found on the plan, so there is nothing to rotate against.'}
        </p>
      )}
    </section>
  );
}
