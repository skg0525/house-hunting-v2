'use client';

import { useEffect, useRef, useState } from 'react';
import type { Assessment, Listing } from '@/types/listing';
import type { Anchor } from '@/lib/api';

/**
 * Where these houses actually are.
 *
 * A ranked list answers "which is best" and says nothing about "how far out am
 * I moving" — which is the question behind wanting to still get into the city
 * sometimes. Seeing sixty pins spread north of Atlanta, with Midtown and the
 * office and two landmarks among them, answers it in a second.
 *
 * Leaflet from a CDN over OpenStreetMap tiles: no API key, no per-view cost,
 * and nothing sent to Google about which houses are being looked at.
 */

const L_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
const L_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';

function loadLeaflet(): Promise<any> {
  const w = window as unknown as { L?: unknown };
  if (w.L) return Promise.resolve(w.L);

  return new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${L_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = L_CSS;
      document.head.appendChild(link);
    }
    const s = document.createElement('script');
    s.src = L_JS;
    s.onload = () => resolve((window as unknown as { L: unknown }).L);
    s.onerror = () => reject(new Error('Could not load the map library'));
    document.head.appendChild(s);
  });
}

const colourFor = (a?: Assessment) =>
  !a ? '#6b7590'
  : a.ruledOut ? '#f43f5e'
  : a.matchScore >= 78 ? '#22c55e'
  : a.matchScore >= 70 ? '#38bdf8'
  : a.matchScore >= 60 ? '#fbbf24'
  : '#6b7590';

export function HouseMap({
  rows, anchors, activeId, onSelect, compact = false,
}: {
  rows: { listing: Listing; a?: Assessment }[];
  anchors: Anchor[];
  activeId?: string;
  onSelect: (id: string) => void;
  /** Shorter, and centred on the selected house rather than fitted to all. */
  compact?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const layer = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    loadLeaflet()
      .then((L: any) => {
        if (dead || !el.current || map.current) return;
        map.current = L.map(el.current, { scrollWheelZoom: true, attributionControl: false })
          .setView([34.05, -84.25], 10);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18,
        }).addTo(map.current);
        layer.current = L.layerGroup().addTo(map.current);
      })
      .catch((e) => setError((e as Error).message));
    return () => { dead = true; };
  }, []);

  useEffect(() => {
    const L = (window as unknown as { L?: any }).L;
    if (!L || !map.current || !layer.current) return;

    const points: [number, number][] = [];

    /* Landmarks first, so house pins sit above them. */
    for (const a of anchors) {
      if (!a.coords) continue;
      points.push([a.coords.lat, a.coords.lng]);
      L.marker([a.coords.lat, a.coords.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div style="background:#0b0e17;border:1px solid #f59e0b;color:#fbbf24;
                   font:600 10px ui-monospace,monospace;padding:2px 6px;border-radius:4px;
                   white-space:nowrap;transform:translate(-50%,-50%)">${a.label}</div>`,
        }),
      }).addTo(layer.current);
    }

    for (const { listing, a } of rows) {
      if (!listing.coords) continue;
      points.push([listing.coords.lat, listing.coords.lng]);
      const active = listing.id === activeId;
      L.circleMarker([listing.coords.lat, listing.coords.lng], {
        radius: active ? 10 : 6,
        color: active ? '#ffffff' : colourFor(a),
        weight: active ? 3 : 1.5,
        fillColor: colourFor(a),
        fillOpacity: 0.85,
      })
        .bindTooltip(
          `${listing.address.split(',')[0]}<br>` +
          `${listing.price ? `$${(listing.price / 1000).toFixed(0)}k` : '—'}` +
          `${a ? ` · ${a.matchScore}/100` : ''}`,
          { direction: 'top' },
        )
        .on('click', () => onSelect(listing.id))
        .addTo(layer.current);
    }

    /* Full view fits everything; the in-detail map centres on the house being
       read, with the rest around it for context. */
    const here = rows.find((r) => r.listing.id === activeId)?.listing.coords;
    if (compact && here) {
      map.current.setView([here.lat, here.lng], 12);
    } else if (points.length) {
      map.current.fitBounds(points, { padding: [30, 30], maxZoom: 12 });
    }
  }, [rows, anchors, activeId, onSelect, compact]);

  if (error) {
    return (
      <div className="rounded-2xl border border-ink-700 bg-ink-850 p-6 text-center text-[13px] text-ink-400">
        {error}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-ink-700">
      <div ref={el} className={`w-full bg-ink-900 ${compact ? 'h-[300px]' : 'h-[560px]'}`} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink-700 bg-ink-850 px-4 py-2 font-mono text-[10.5px] text-ink-500">
        <span><span style={{ color: '#22c55e' }}>●</span> 78+</span>
        <span><span style={{ color: '#38bdf8' }}>●</span> 70–77</span>
        <span><span style={{ color: '#fbbf24' }}>●</span> 60–69</span>
        <span><span style={{ color: '#f43f5e' }}>●</span> ruled out</span>
        <span className="ml-auto">click a pin to open the house</span>
      </div>
    </div>
  );
}
