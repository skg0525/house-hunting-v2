/**
 * What the app remembers about you between sessions.
 *
 * One JSON file on your own disk. The submitted version of this project put
 * this in Firestore because it ran on Cloud Run for judges; you are running it
 * on your laptop while you look for a house, so a file is the right answer.
 * Nothing to provision, nothing to pay for, and you can read it yourself.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { PreferenceProfile, DimensionKey, defaultProfile } from '../types/preferences.js';
import { STORE_DIR } from '../paths.js';

const FILE = join(STORE_DIR, 'memory.json');

async function readAll(): Promise<Record<string, PreferenceProfile>> {
  try {
    return JSON.parse(await readFile(FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function writeAll(all: Record<string, PreferenceProfile>) {
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(all, null, 2));
}

/**
 * Fill in anything a stored profile is missing.
 *
 * The shape of this file changes as the tool changes. Merging over the current
 * defaults means an old profile keeps everything you taught it and quietly
 * gains whatever is new, instead of throwing on a field that did not exist when
 * it was written.
 */
/**
 * Settings that were once hard requirements and no longer are.
 *
 * A stored profile written before a rule was softened keeps enforcing it
 * forever, because merging stored-over-defaults is the whole point of the
 * merge. `mainFloorBedroomRequired: true` survived that way and kept capping a
 * house at 55 long after the rule became a preference. Retired keys are cleared
 * on read rather than left to haunt the ranking.
 */
const RETIRED_PREFERENCES = ['mainFloorBedroomRequired', 'mainFloorFullBathRequired'] as const;

function withDefaults(stored: Partial<PreferenceProfile>, userId: string): PreferenceProfile {
  const base = defaultProfile(userId);
  const prefs = { ...base.preferences, ...(stored.preferences ?? {}) };
  for (const k of RETIRED_PREFERENCES) (prefs as Record<string, unknown>)[k] = false;
  return {
    ...base,
    ...stored,
    weights: { ...base.weights, ...(stored.weights ?? {}) },
    nonNegotiables: { ...base.nonNegotiables, ...(stored.nonNegotiables ?? {}) },
    preferences: prefs,
    propertyFeedback: stored.propertyFeedback ?? {},
    learnedNotes: stored.learnedNotes ?? [],
  };
}

export async function getProfile(userId: string): Promise<PreferenceProfile> {
  const all = await readAll();
  if (!all[userId]) {
    all[userId] = defaultProfile(userId);
    await writeAll(all);
  }
  return withDefaults(all[userId]!, userId);
}

async function saveProfile(profile: PreferenceProfile): Promise<PreferenceProfile> {
  profile.updatedAt = new Date().toISOString();
  profile.version += 1;
  const all = await readAll();
  all[profile.userId] = profile;
  await writeAll(all);
  return profile;
}

export async function updateProfile(
  userId: string,
  patch: {
    weights?: Partial<Record<DimensionKey, number>>;
    nonNegotiables?: Partial<PreferenceProfile['nonNegotiables']>;
    preferences?: Partial<PreferenceProfile['preferences']>;
    propertyFeedback?: PreferenceProfile['propertyFeedback'];
  },
): Promise<PreferenceProfile> {
  const profile = await getProfile(userId);
  if (patch.weights) {
    for (const [k, v] of Object.entries(patch.weights)) {
      if (typeof v === 'number') profile.weights[k as DimensionKey] = Math.max(0, Math.min(1, v));
    }
  }
  if (patch.nonNegotiables) Object.assign(profile.nonNegotiables, patch.nonNegotiables);
  if (patch.preferences) Object.assign(profile.preferences, patch.preferences);
  /* Verdicts in bulk. This was missing, so a PATCH carrying propertyFeedback
     returned 200 OK and changed nothing — seven houses were marked, the request
     succeeded, and the marks were never written. A field an endpoint does not
     understand has to be an error, not a shrug. */
  if (patch.propertyFeedback) Object.assign(profile.propertyFeedback, patch.propertyFeedback);
  return saveProfile(profile);
}

/** Your call on one specific house. Kept separate from what you like in general. */
export async function setVerdict(
  userId: string,
  listingId: string,
  verdict: 'rejected' | 'tooFar' | 'maybe' | 'shortlisted' | 'selfTour' | 'agentTour' | 'toured' | null,
): Promise<PreferenceProfile> {
  const profile = await getProfile(userId);
  if (!profile.propertyFeedback) profile.propertyFeedback = {};
  if (verdict === null) delete profile.propertyFeedback[listingId];
  else profile.propertyFeedback[listingId] = verdict;
  return saveProfile(profile);
}

export interface AppliedFeedback {
  profile: PreferenceProfile;
  changes: { dimension: DimensionKey; from: number; to: number }[];
  note: string;
}

/**
 * Turn something you typed into an actual change.
 *
 * Two separate effects, and keeping them separate is the whole lesson from the
 * first version of this app:
 *
 *   1. A verdict on THIS house. "Not for us" has to remove this house from
 *      contention. It cannot be expressed as a weight, because a weight moves
 *      an average across eight dimensions by about a point — and if the house
 *      happens to score well on the dimension you just raised, rejecting it
 *      moves it UP the list. Which is exactly what it did, until it didn't.
 *
 *   2. A weight change for FUTURE houses. That is the general lesson, and it is
 *      the only thing that should generalise.
 */
export async function applyFeedback(
  userId: string,
  listingId: string,
  action: 'thumbs_up' | 'thumbs_down',
  adjustments: { dimension: DimensionKey; delta: number }[],
  note: string,
): Promise<AppliedFeedback> {
  const profile = await getProfile(userId);
  const changes: AppliedFeedback['changes'] = [];

  if (!profile.propertyFeedback) profile.propertyFeedback = {};
  profile.propertyFeedback[listingId] =
    action === 'thumbs_down' ? 'rejected' : 'shortlisted';

  for (const { dimension, delta } of adjustments) {
    const from = profile.weights[dimension];
    if (from === undefined) continue;
    const to = Math.max(0.05, Math.min(1, Math.round((from + delta) * 100) / 100));
    if (to !== from) {
      profile.weights[dimension] = to;
      changes.push({ dimension, from, to });
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  profile.learnedNotes.unshift(
    `[${stamp}] ${action === 'thumbs_up' ? 'liked' : 'passed'} ${listingId}: ${note}`,
  );
  profile.learnedNotes = profile.learnedNotes.slice(0, 40);

  return { profile: await saveProfile(profile), changes, note };
}

export async function resetProfile(userId: string): Promise<PreferenceProfile> {
  const fresh = defaultProfile(userId);
  fresh.version = 0;
  return saveProfile(fresh);
}
