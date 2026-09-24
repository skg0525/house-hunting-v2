'use client';

import { useState } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';
import { getApiBase } from '@/lib/api';

/**
 * Every property image goes through here.
 *
 * Sources are mixed — an aerial pulled live from Static Maps, a floor plan you
 * saved off a listing page and dropped in. Either can be missing or dead, and a
 * bare <img> would render that as an unexplained grey box. Three explicit
 * states instead: loading, loaded, or broken with a reason.
 */
export function SmartImage({
  src, alt, className = '', imgClassName = '', empty = 'No image yet.',
}: {
  src?: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  empty?: string;
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  // A bare filename is a plan you uploaded; the backend serves it.
  const url = !src ? null
    : /^https?:\/\//.test(src) ? src
    : `${getApiBase()}/uploads/${src}`;

  if (!url) {
    return (
      <div className={`flex items-center justify-center bg-ink-800 text-ink-500 ${className}`}>
        <div className="flex flex-col items-center gap-1.5 p-3 text-center">
          <ImageOff size={20} />
          <span className="text-[11px] leading-snug">{empty}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-ink-800 ${className}`}>
      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="animate-spin text-ink-600" size={20} />
        </div>
      )}
      {state === 'error' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3 text-center text-ink-400">
          <ImageOff size={20} />
          <span className="text-[11px] leading-snug">That image would not load.</span>
        </div>
      ) : (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
          className={`h-full w-full object-cover transition-opacity duration-500 ${
            state === 'ok' ? 'opacity-100' : 'opacity-0'
          } ${imgClassName}`}
        />
      )}
    </div>
  );
}
