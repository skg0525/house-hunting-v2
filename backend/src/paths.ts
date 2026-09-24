/**
 * Filesystem roots.
 *
 * Resolving with `join(import.meta.url, '..', '..')` breaks between dev and the
 * container: under tsx the module sits at `src/services/`, but compiled it sits
 * at `dist/src/services/`, so the same relative hop lands in a different place
 * and the imagery silently disappears. Anchor everything to one explicit root
 * instead, overridable for anyone running from an unusual working directory.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repo root in dev (src/ -> ..), image root in the container (dist/src/ -> ../..). */
export const APP_ROOT = process.env.APP_ROOT
  ? resolve(process.env.APP_ROOT)
  : HERE.includes(`${'dist'}/src`) || HERE.endsWith(`${'dist'}/src`)
    ? resolve(HERE, '..', '..')
    : resolve(HERE, '..');

export const PUBLIC_DIR = join(APP_ROOT, 'public');
export const ASSETS_DIR = join(PUBLIC_DIR, 'assets');

/**
 * Floor plans you saved off a listing page.
 *
 * Redfin and Zillow serve plan images from URLs that expire and that block
 * hotlinking, so the reliable path is: you screenshot or save the plan, drop it
 * on the app, and it lives here. Kept out of git — these are other people's
 * listing photos.
 */
export const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? resolve(process.env.UPLOADS_DIR)
  : join(APP_ROOT, 'uploads');
/**
 * Where your data lives: three JSON files you can open and read.
 *
 * No database, no cloud service. Forty houses and one profile is not a
 * distributed systems problem, and the whole thing should keep working with the
 * wifi off except for the two APIs that genuinely need the internet.
 */
export const STORE_DIR = process.env.STORE_DIR
  ? resolve(process.env.STORE_DIR)
  : join(APP_ROOT, '.localstore');
