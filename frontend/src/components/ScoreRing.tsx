'use client';

import { useEffect, useState } from 'react';

const tone = (s: number) =>
  s >= 85 ? { stroke: 'var(--color-good-400)', text: 'text-good-400' }
  : s >= 70 ? { stroke: 'var(--color-brand-400)', text: 'text-brand-400' }
  : s >= 55 ? { stroke: 'var(--color-warn-400)', text: 'text-warn-400' }
  : { stroke: 'var(--color-bad-400)', text: 'text-bad-400' };

/** Animated match score. Counts up on mount so a re-rank is visible, not silent. */
export function ScoreRing({ score, size = 108, label = 'match' }: {
  score: number; size?: number; label?: string;
}) {
  const [shown, setShown] = useState(0);
  const { stroke, text } = tone(score);

  useEffect(() => {
    let raf = 0;
    const from = shown;
    const start = performance.now();
    const dur = 750;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (score - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score]);

  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke="var(--color-ink-700)" strokeWidth={8} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={stroke} strokeWidth={8} strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ - (circ * shown) / 100}
          style={{ transition: 'stroke-dashoffset 90ms linear' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-mono font-bold leading-none ${text}`}
              style={{ fontSize: size * 0.28 }}>
          {shown}
        </span>
        <span className="text-[10px] uppercase tracking-widest text-ink-400 mt-1">{label}</span>
      </div>
    </div>
  );
}
