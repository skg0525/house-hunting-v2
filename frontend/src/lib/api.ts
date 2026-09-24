import type {
  Assessment, PreferenceProfile, Listing, HealthPayload, DimensionKey, PastedResult,
} from '@/types/listing';

/**
 * Where the backend lives.
 *
 * This runs on your laptop, so localhost is the honest default. The env var is
 * there for the day you decide to put it somewhere else.
 */
/* The fallback is this copy's own port, never the other one's.
 *
 * Two copies of this app run side by side — the working house hunt on 8787 and
 * this one on 8788. A fallback pointing at 8787 means that the moment
 * .env.local fails to load, this UI silently starts writing into the other
 * copy's listings, and nothing on screen would say so. The port shown in the
 * header is read from the same constant, so what you see is what it talks to. */
export const API_BASE =
  (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8788').replace(/\/$/, '');
const apiBase = API_BASE;

export const getApiBase = () => apiBase;

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `${init?.method ?? 'GET'} ${path} → ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const getHealth = () => json<HealthPayload>('/api/health');
/**
 * Every house, including the ones that have sold or been withdrawn.
 *
 * They used to be excluded, which meant a house disappeared silently the day it
 * went under contract — and what a house actually sold for, against what it was
 * asking, is the only real evidence this market gives you about price. They are
 * kept, sunk to the bottom of the ranking, and shown under their own tab.
 */
export const getListings = () => json<Listing[]>('/api/listings?includeArchived=true');

export interface Anchor {
  key: string; label: string; address: string; note: string;
  coords?: { lat: number; lng: number };
}
export const getAnchors = () => json<Anchor[]>('/api/anchors');

/* ------------------------------ intake ------------------------------ */

export const pasteUrls = (text: string) =>
  json<{ results: PastedResult[] }>('/api/listings/paste', {
    method: 'POST', body: JSON.stringify({ text }),
  }).then((r) => r.results);

export const createListing = (listing: Partial<Listing> & { sourceUrl: string; address: string }) =>
  json<Listing>('/api/listings', { method: 'POST', body: JSON.stringify(listing) });

/* Clearing a field and omitting it are different requests: `{touredAt: null}`
   erases the date, `{}` leaves it alone. Partial<Listing> can only say the
   second, so every value here may also be null. */
export const patchListing = (
  id: string,
  patch: { [K in keyof Listing]?: Listing[K] | null },
) =>
  json<Listing>(`/api/listings/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteListing = (id: string) =>
  json<{ removed: boolean }>(`/api/listings/${id}`, { method: 'DELETE' });

/** A floor plan you saved off the listing page, as a data URL. */
/**
 * Add a floor plan. Adds to whatever is already there rather than replacing —
 * these houses publish a page per storey and the guest suite is rarely on the
 * first one. Pass replace to start again from empty.
 */
export const uploadPlan = (id: string, dataUrl: string, replace = false) =>
  json<Listing>(`/api/listings/${id}/plan${replace ? '?replace=true' : ''}`, {
    method: 'POST', body: JSON.stringify({ dataUrl }),
  });

export const removePlan = (id: string, index: number) =>
  json<Listing>(`/api/listings/${id}/plan/${index}`, { method: 'DELETE' });

/**
 * Start over on one house: forget its cached page, its reading, and what we
 * concluded about its gallery, then do the whole job again.
 */
export const refreshEverything = (id: string) =>
  json<{ listing: Listing; assessment: Assessment }>(`/api/listings/${id}/refresh-all`, {
    method: 'POST',
  });

/** Census tract, walkability and an aerial, all from the coordinates. */
export const enrichListing = (id: string) =>
  json<Listing>(`/api/listings/${id}/enrich`, { method: 'POST' });

/** Your own notes on a house. Saved alone, never carried by anything else. */
export const saveNotes = (id: string, notes: string) =>
  json<{ myNotes: string; myNotesUpdatedAt: string }>(`/api/listings/${id}/notes`, {
    method: 'PUT',
    body: JSON.stringify({ notes }),
  });

/* ----------------------------- profile ----------------------------- */

export const getProfile = () => json<PreferenceProfile>('/api/profile');

export const patchProfile = (patch: {
  weights?: Partial<Record<DimensionKey, number>>;
  nonNegotiables?: Partial<PreferenceProfile['nonNegotiables']>;
  preferences?: Partial<PreferenceProfile['preferences']>;
}) => json<PreferenceProfile>('/api/profile', { method: 'PATCH', body: JSON.stringify(patch) });

export const setVerdict = (id: string, verdict: 'rejected' | 'tooFar' | 'maybe' | 'shortlisted' | 'selfTour' | 'agentTour' | 'toured' | null) =>
  json<PreferenceProfile>(`/api/listings/${id}/verdict`, {
    method: 'POST', body: JSON.stringify({ verdict }),
  });

export interface FeedbackResponse {
  note: string;
  changes: { dimension: DimensionKey; from: number; to: number }[];
  profile: PreferenceProfile;
  degraded: boolean;
}

export const sendFeedback = (
  id: string, action: 'thumbs_up' | 'thumbs_down', critique: string,
) => json<FeedbackResponse>(`/api/listings/${id}/feedback`, {
  method: 'POST', body: JSON.stringify({ action, critique }),
});

export const refreshOpenHouses = (id: string) =>
  json<{ listing: Listing; described: string[] }>(`/api/listings/${id}/open-houses`, { method: 'POST' });

export const refreshAllOpenHouses = () =>
  json<{ checked: number; results: { id: string; address: string; described?: string[]; error?: string }[] }>(
    '/api/open-houses/refresh', { method: 'POST' },
  );

/**
 * Re-check price and status. Shortlisted houses by default, or specific ones.
 *
 * Cheap on purpose — one request per house, and only for houses being watched.
 */
export const refreshPrices = (ids?: string[]) =>
  json<{
    checked: number; changed: number;
    changes: { address: string; was?: number; now?: number; note?: string; error?: string }[];
  }>('/api/refresh', { method: 'POST', body: JSON.stringify(ids ? { ids } : {}) });

/**
 * Re-read every page we already hold. Free — nothing is fetched.
 *
 * Worth its own button because it is the cheapest useful thing here: it fills
 * in any field added since a house was last looked at, without touching a
 * listing site.
 */
export const reparse = () =>
  json<{ listings: number; updated: number; notCached: number }>('/api/reparse', {
    method: 'POST',
  });

/* ------------------------------- scan ------------------------------- */

export type ScanMode =
  /** Read anything not already read, reuse the rest. */
  | 'full'
  /** Throw away every cached reading and look again. */
  | 'force'
  /** Re-score from cached readings only. Never calls the model. */
  | 'rescore'
  /** Forget every saved page and fetch them again — the only way to learn
      about open houses that were posted since the last look. One listing-site
      request per house. */
  | 'refetch';

export interface ScanHandlers {
  onStart?: (d: { total: number; profileVersion: number }) => void;
  onAssessment?: (a: Assessment) => void;
  onProgress?: (d: { done: number; total: number }) => void;
  /** What the scan is doing before any house has been scored. */
  onPhase?: (d: { note: string }) => void;
  onFailed?: (d: { listingId: string; error: string }) => void;
  onSkipped?: (d: { listingId: string }) => void;
  onDone?: () => void;
}

/**
 * Streamed scan.
 *
 * Houses arrive one at a time as each reading resolves. On a fresh batch of
 * twenty that is the difference between a progress bar and a blank screen.
 */
export function startScan(handlers: ScanHandlers, mode: ScanMode = 'full'): () => void {
  const q = mode === 'force' ? '?force=true'
          : mode === 'rescore' ? '?cachedOnly=true'
          : mode === 'refetch' ? '?refetch=true'
          : '';
  const es = new EventSource(`${apiBase}/api/scan${q}`);

  const on = <T,>(name: string, fn?: (d: T) => void) =>
    es.addEventListener(name, (e) => fn?.(JSON.parse((e as MessageEvent).data)));

  on('start', handlers.onStart);
  on('property', handlers.onAssessment);
  on('progress', handlers.onProgress);
  on('phase', handlers.onPhase);
  on('failed', handlers.onFailed);
  on('skipped', handlers.onSkipped);
  es.addEventListener('done', () => { handlers.onDone?.(); es.close(); });
  es.onerror = () => { es.close(); handlers.onDone?.(); };

  return () => es.close();
}

export interface PlanFamily {
  lots: number;
  byFacing: { direction: string; score: number }[];
  best: { direction: string; score: number };
  houses: { id: string; address: string; price: number; facing: string; score: number; forgone: number }[];
}

/** Every drawing that has been read, scored at each facing, grouped by layout. */
export const getPlans = () => json<{ plans: PlanFamily[] }>('/api/plans').then((r) => r.plans);

/**
 * Re-score ONE house, without touching the other hundred and twenty-one.
 *
 * Every small edit — a plan uploaded, a fence answered, a verdict set — used to
 * fire a full scan. That re-read nothing from the model, because perception is
 * cached on its inputs, but it did go looking at galleries and open houses for
 * every house that wanted one, which is a listing-site request each and is how
 * a day's budget disappeared without a scan ever being pressed. It also put a
 * spinner on all hundred and twenty-two cards, which is how he noticed.
 */
export const rescoreOne = (id: string) =>
  json<Assessment>(`/api/listings/${id}/assessment?force=true`);

/**
 * Re-read one house's assessment WITHOUT forcing a re-perception.
 *
 * Switching the Vastu school changes the reading the moment the server is
 * asked — it is derived at scoring time from a cached perception, so no image
 * is re-read and nothing is re-spent. What it does not do is reach into the
 * assessments already sitting in React state, which is why toggling the school
 * appeared to do nothing at all: the numbers had changed on the server and the
 * page was still showing the copies it fetched at load.
 *
 * `rescoreOne` would work but carries `force=true`, which throws away the
 * perception and re-rolls the plan read — three model calls a house, and a
 * different answer at the end of it. Exactly what must not happen for a
 * setting that only re-labels a bathroom.
 */
export const refetchAssessment = (id: string) =>
  json<Assessment>(`/api/listings/${id}/assessment`);
