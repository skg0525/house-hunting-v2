/**
 * The API.
 *
 * One user, one laptop, a few dozen houses. Everything is scoped to a single
 * profile id because there is only ever one of you, and the endpoints are shaped
 * around how you actually work: paste a batch of links in the evening, fill in
 * the numbers, drop the floor plans, then let it read and rank them.
 */
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

import { UPLOADS_DIR, STORE_DIR } from './paths.js';
import type { Listing } from './types/listing.js';
import {
  allListings, listingById, addListing, updateListing, removeListing, parsePastedUrls,
} from './services/listingStore.js';
import { assessListing, clearPerception, cacheStats, hasPerception } from './services/auditService.js';
import {
  getProfile, updateProfile, applyFeedback, resetProfile, setVerdict,
} from './services/memoryManager.js';
import { interpretFeedback } from './services/feedbackInterpreter.js';
import { geocode, pickCoords, resolveOrientation } from './services/orientation.js';
import { enrich, dataSourceStatus } from './services/neighborhood.js';
import { findFloorPlans, galleryUrls } from './services/planFinder.js';
import { remaining } from './services/rateBudget.js';
import { nearestExit } from './services/exits.js';
import { planRead } from './services/planFamilies.js';
import { perceiveProperty, UNKNOWN_PERCEPTION } from './services/geminiEvaluator.js';
import { addPlan, allPlans, removePlan, savePlanImage, scoreAllFacings } from './services/planLibrary.js';
import { fetchOpenHouses, upcomingOnly, describe as describeOpenHouse } from './services/openHouses.js';
import { fetchFacts } from './services/listingFacts.js';
import { fetchPriceHistory } from './services/priceHistory.js';
import { findOnRedfin, isReadable } from './services/crossSite.js';
import { findNearby } from './services/nearby.js';
import { assessCommute } from './services/commute.js';
import { distancesFrom } from './services/anchors.js';
import { MODEL } from './services/geminiEvaluator.js';

const app = express();
/* 8788, not 8787.
 *
 * This copy runs alongside another one on 8787, and there are no API keys in
 * this exercise so there is no .env to read a port from — a clone starts on
 * whatever this line says. Defaulting to 8787 meant a fresh checkout collided
 * with the other copy and exited before serving anything. */
const PORT = Number(process.env.PORT ?? 8788);

/** There is one of you. No auth, because this never leaves your machine. */
const USER = 'me';

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }));
app.use(express.json({ limit: '25mb' }));

/* Floor plans you dropped in are served back to the browser from here, so the
   model and the page look at the same bytes. */
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '1h' }));

/**
 * The rejects file.
 *
 * Kept because a rule-out you cannot revisit is indistinguishable from a house
 * you lost — and a shaky bearing occasionally deserves a second look.
 */
const RULED_OUT_FILE = join(STORE_DIR, 'ruled-out.json');

async function saveRuledOut(rows: unknown[]) {
  const prev = await loadRuledOut();
  const seen = new Set(prev.map((r) => (r as { url: string }).url));
  const merged = [...prev, ...rows.filter((r) => !seen.has((r as { url: string }).url))];
  await mkdir(STORE_DIR, { recursive: true });
  await writeFile(RULED_OUT_FILE, JSON.stringify(merged, null, 2));
}

async function loadRuledOut(): Promise<unknown[]> {
  try {
    return JSON.parse(await readFile(RULED_OUT_FILE, 'utf8'));
  } catch {
    return [];
  }
}

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

/** Express 5 types route params as possibly-array, possibly-absent. Ours are neither. */
const id = (req: Request) => String(req.params.id ?? '');

/* ----------------------------- health ----------------------------- */

/** What we have actually spent on the model, counted locally. */
app.get('/api/usage', wrap(async (_req, res) => {
  const { summary } = await import('./services/usage.js');
  res.json(await summary());
}));

app.get('/api/health', wrap(async (_req, res) => {
  const stats = await cacheStats();
  const { remaining } = await import('./services/rateBudget.js');
  res.json({
    ok: true,
    listingRequests: remaining(),
    model: MODEL,
    sources: dataSourceStatus(),
    cachedReadings: stats.entries,
    listings: (await allListings()).length,
  });
}));

/**
 * The fast pass over a big pile of links.
 *
 * Answers only "which of these are already out", using nothing but the address
 * — no listing page, so no rate limit, and no vision call. Cheap enough to run
 * over a hundred and forty favourites in a couple of minutes.
 */
app.post('/api/triage', wrap(async (req, res) => {
  const { triage } = await import('./services/triage.js');
  const summary = await triage(String(req.body?.text ?? ''));
  res.json(summary);
}));

/**
 * Triage a pile of links and bring the survivors in.
 *
 * Adds every keeper as a listing with its address, coordinates and measured
 * facing already filled in — the expensive reads come later, on scan. The
 * ruled-out are stored separately rather than discarded, because "why did I
 * drop that one?" is a question worth being able to answer three weeks from
 * now, and because a bad measurement should be reversible.
 */
/**
 * Which address to keep: the geocoder's or the one off the listing URL.
 *
 * Google tidies an address it recognises, which is worth having. But a house
 * too new to be in its index geocodes to the town — 123 Peaceful Grove Dr came
 * back as "Cumming, GA, USA" and that is what the card showed, so the house was
 * unidentifiable in a list of eighty-six. A formatted address that has lost the
 * street is worse than the one we started with, whatever its provenance.
 */
function bestAddress(formatted: string | undefined, guess: string | undefined): string {
  const hasStreet = (a?: string) => Boolean(a && /\d+\s+\S+\s+\S/.test(a));
  if (hasStreet(formatted)) return formatted!;
  if (hasStreet(guess)) return guess!;
  return formatted ?? guess ?? '';
}

app.post('/api/triage/import', wrap(async (req, res) => {
  const { triage } = await import('./services/triage.js');
  const summary = await triage(String(req.body?.text ?? ''));

  const existing = await allListings();
  const seenUrl = new Set(existing.map((l) => l.sourceUrl));
  /* The same house arrives twice with different tracking parameters, and from
     several open tabs. Deduplicate on the address, not the link. */
  const seenAddr = new Set(existing.map((l) => l.address.toLowerCase().replace(/[^a-z0-9]/g, '')));

  const added: string[] = [];
  const skipped: string[] = [];

  for (const r of summary.results) {
    if (r.verdict === 'out') continue;
    if (!r.address) { skipped.push(r.url); continue; }

    const key = r.address.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seenUrl.has(r.url) || seenAddr.has(key)) { skipped.push(r.address); continue; }
    seenUrl.add(r.url);
    seenAddr.add(key);

    const g = await geocode(r.address).catch(() => null);
    const l = await addListing({
      sourceUrl: r.url,
      address: r.address,
      coords: g?.coords,
      geocodeQuality: g?.locationType,
    });
    added.push(l.address);
  }

  await saveRuledOut(summary.results.filter((r) => r.verdict === 'out'));

  res.json({
    added: added.length,
    skippedAsDuplicate: skipped.length,
    ruledOut: summary.out,
    needsChecking: summary.checkYourself,
    addresses: added,
  });
}));

/** The houses the facing measurement removed, kept so the decision is auditable. */
app.get('/api/ruled-out', wrap(async (_req, res) => {
  res.json(await loadRuledOut());
}));

/** The fixed places every house is measured against. */
app.get('/api/anchors', wrap(async (_req, res) => {
  const { anchors } = await import('./services/anchors.js');
  res.json(await anchors());
}));

/* ---------------------------- listings ---------------------------- */

app.get('/api/listings', wrap(async (req, res) => {
  const includeGone = req.query.includeArchived === 'true';
  /* Past open houses are stripped on the way out. Storing them is fine; showing
     them is not, because a date that has already gone is actively misleading. */
  const listings = await allListings();
  /* Sold and off-market houses stay in the file but out of the list. They are
     not choices any more, and leaving them in makes a shortlist that cannot be
     acted on. */
  res.json(
    listings
      .filter((l) => includeGone || !l.archivedAt)
      .map((l) => ({ ...l, openHouses: upcomingOnly(l.openHouses) })),
  );
}));

/**
 * Paste a wall of Redfin/Zillow links.
 *
 * Returns what it could work out from each URL without fetching anything from
 * those sites — the address is in the path, and the address is enough to place
 * the house and measure which way it faces. Price, beds and lot size are not in
 * the URL, so they come back blank for you to fill in. That is the honest cost
 * of not running a scraper against someone else's servers.
 */
app.post('/api/listings/paste', wrap(async (req, res) => {
  const parsed = parsePastedUrls(String(req.body?.text ?? ''));
  if (!parsed.length) return res.status(400).json({ error: 'No links found in that text.' });

  const existing = await allListings();
  const known = new Set(existing.map((l) => l.sourceUrl));

  const results = await Promise.all(parsed.map(async (p) => {
    if (known.has(p.url)) return { ...p, status: 'duplicate' as const };

    // Geocoding is the one lookup worth doing now: without coordinates we
    // cannot measure the facing direction, which is the whole hard rule.
    const g = p.addressGuess ? await geocode(p.addressGuess).catch(() => null) : null;

    return {
      ...p,
      status: 'new' as const,
      address: bestAddress(g?.formatted, p.addressGuess),
      coords: g?.coords,
      geocodeQuality: g?.locationType,
    };
  }));

  res.json({ results });
}));

app.post('/api/listings', wrap(async (req, res) => {
  const body = req.body ?? {};
  if (!body.sourceUrl || !body.address)
    return res.status(400).json({ error: 'sourceUrl and address are both required.' });

  let coords = body.coords;
  let geocodeQuality = body.geocodeQuality;
  if (!coords) {
    const g = await geocode(body.address).catch(() => null);
    coords = g?.coords;
    geocodeQuality = g?.locationType;
  }

  /* A Zillow link is not a dead end: browse there, read here. Zillow answers
     403 to everything automated, so the equivalent Redfin record is looked up
     from the address and stored as the readable source. */
  let readableUrl: string | undefined;
  if (!isReadable(body.sourceUrl)) {
    readableUrl = (await findOnRedfin(body.address).catch(() => null)) ?? undefined;
  }

  const listing = await addListing({
    ...body, coords, geocodeQuality,
    readableUrl,
  });

  /* Look everything up right now. The alternative — a button the user has to
     find and press per house — left freshly pasted houses scoring on nothing. */
  const enriched = await enrichListing(listing.id).catch(() => null);
  res.status(201).json(enriched && !('error' in enriched) ? enriched : listing);
}));

/**
 * Your notes on a house, saved on their own.
 *
 * A separate endpoint from the general patch so that nothing else can carry
 * them by accident, and so saving a note never triggers a re-read.
 */
app.put('/api/listings/:id/notes', wrap(async (req, res) => {
  const updated = await updateListing(id(req), {
    myNotes: String(req.body?.notes ?? ''),
  });
  if (!updated) return res.status(404).json({ error: 'No such listing.' });
  res.json({ myNotes: updated.myNotes, myNotesUpdatedAt: updated.myNotesUpdatedAt });
}));

app.patch('/api/listings/:id', wrap(async (req, res) => {
  const updated = await updateListing(id(req), req.body ?? {});
  if (!updated) return res.status(404).json({ error: 'No such listing.' });

  /* A changed address means a different house, so the cached reading no longer
     describes it. Better to pay for another look than to rank a house on the
     last one's floor plan. */
  if (req.body?.address || req.body?.images) await clearPerception(id(req));
  res.json(updated);
}));

app.delete('/api/listings/:id', wrap(async (req, res) => {
  const gone = await removeListing(id(req));
  await clearPerception(id(req));
  res.json({ removed: gone });
}));

/**
 * Attach a floor plan you saved off the listing page.
 *
 * Sent as a base64 data URL from the browser. Redfin and Zillow serve plan
 * images from URLs that expire and refuse hotlinks, so the file has to live
 * locally — you screenshot it, drop it on the card, and it stays.
 */
app.post('/api/listings/:id/plan', wrap(async (req, res) => {
  const listing = await listingById(id(req));
  if (!listing) return res.status(404).json({ error: 'No such listing.' });

  const dataUrl = String(req.body?.dataUrl ?? '');
  const m = dataUrl.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/);
  if (!m) return res.status(400).json({ error: 'Expected a PNG, JPEG or WebP image.' });

  const buf = Buffer.from(m[3]!, 'base64');
  if (buf.byteLength > 12 * 1024 * 1024)
    return res.status(413).json({ error: 'That image is over 12 MB.' });

  const name = `${listing.id}-plan-${randomUUID().slice(0, 6)}${m[2]! === 'png' ? '.png' : '.jpg'}`;
  await mkdir(UPLOADS_DIR, { recursive: true });
  await writeFile(join(UPLOADS_DIR, name), buf);

  /* Add, don't replace.
   *
   * Most of these houses publish a plan per storey, and the guest suite is
   * usually on the one that is not the main floor. Uploading the second page
   * used to throw the first away, so the reading got worse the more work you
   * did. The reader already takes up to five plans — it was only the upload
   * that insisted on one.
   *
   * `?replace=true` is the escape hatch for when you dropped in the wrong
   * image, and starts again from empty. */
  const replace = req.query.replace === 'true';
  const existing = replace
    ? []
    : [listing.images.floorPlan, ...(listing.images.floorPlanExtra ?? [])].filter(Boolean) as string[];
  const all = [...existing, name];

  const updated = await updateListing(listing.id, {
    images: { ...listing.images, floorPlan: all[0]!, floorPlanExtra: all.slice(1) },
  });
  await clearPerception(listing.id);   // there is something new to read
  res.json(updated);
}));

/** Take one uploaded plan back off, for when the wrong image went on. */
app.delete('/api/listings/:id/plan/:index', wrap(async (req, res) => {
  const listing = await listingById(id(req));
  if (!listing) return res.status(404).json({ error: 'No such listing.' });

  const all = [listing.images.floorPlan, ...(listing.images.floorPlanExtra ?? [])]
    .filter(Boolean) as string[];
  const i = Number(req.params.index);
  if (!Number.isInteger(i) || i < 0 || i >= all.length)
    return res.status(400).json({ error: 'No plan at that position.' });

  all.splice(i, 1);
  const updated = await updateListing(listing.id, {
    images: { ...listing.images, floorPlan: all[0], floorPlanExtra: all.slice(1) },
  });
  await clearPerception(listing.id);
  res.json(updated);
}));

/**
 * Go and find the floor plan in the listing's own gallery.
 *
 * Saves the open-the-listing, scroll-to-the-last-photos, save-the-image,
 * drag-it-in loop, times forty houses.
 */
app.post('/api/listings/:id/find-plan', wrap(async (req, res) => {
  const listing = await listingById(id(req));
  if (!listing) return res.status(404).json({ error: 'No such listing.' });

  const found = await findFloorPlans(listing.readableUrl ?? listing.sourceUrl);

  /* Record why, so the UI can tell "this listing has no plan" from "we were
     blocked before we could look". */
  await updateListing(listing.id, {
    images: {
      ...listing.images,
      planSearch: { at: new Date().toISOString(), outcome: found.outcome === 'found' ? 'none-in-listing' : found.outcome, note: found.note },
    },
  });

  /* Save the photos regardless — they are what the list shows. */
  if (found.gallery.length) {
    await updateListing(listing.id, {
      images: {
        ...listing.images,
        exterior: found.exteriorUrl ?? listing.images.exterior,
        gallery: found.gallery,
        kitchenPhotos: found.kitchenUrls,
      },
    });
  }

  if (!found.urls.length && !found.kitchenUrls.length)
    return res.status(404).json({
      error: found.note || 'No floor plan found in that gallery.',
      outcome: found.outcome,
      scanned: found.scanned,
    });

  /* The first plan in gallery order is the main floor, which is where every
     question being asked lives. Upper storeys are kept to look at, not read. */
  const updated = await updateListing(listing.id, {
    images: {
      ...listing.images,
      floorPlan: found.urls[0],
      floorPlanExtra: found.urls.slice(1),
      kitchenPhotos: found.kitchenUrls,
      exterior: found.exteriorUrl ?? listing.images.exterior,
      gallery: found.gallery,
    },
  });
  await clearPerception(listing.id);
  res.json({
    listing: updated,
    found: found.urls,
    kitchen: found.kitchenUrls,
    scanned: found.scanned,
    note: found.note,
  });
}));

/**
 * Re-check the open house schedule for one house.
 *
 * On demand rather than on a timer, because these dates go stale within days
 * and a stale one is worse than none — you plan a Saturday around it.
 */
app.post('/api/listings/:id/open-houses', wrap(async (req, res) => {
  const listing = await listingById(id(req));
  if (!listing) return res.status(404).json({ error: 'No such listing.' });

  try {
    const openHouses = await fetchOpenHouses(listing.readableUrl ?? listing.sourceUrl);
    const updated = await updateListing(listing.id, {
      openHouses,
      openHousesCheckedAt: new Date().toISOString(),
    });
    res.json({ listing: updated, openHouses, described: openHouses.map(describeOpenHouse) });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
}));

/* Refresh every shortlisted house at once — the weekend-planning question. */
app.post('/api/open-houses/refresh', wrap(async (_req, res) => {
  const [listings, profile] = await Promise.all([allListings(), getProfile(USER)]);
  const shortlisted = listings.filter(
    (l) => ['shortlisted', 'selfTour', 'agentTour'].includes(profile.propertyFeedback?.[l.id] ?? ''),
  );

  const results = await Promise.all(shortlisted.map(async (l) => {
    try {
      const openHouses = await fetchOpenHouses(l.readableUrl ?? l.sourceUrl);
      await updateListing(l.id, { openHouses, openHousesCheckedAt: new Date().toISOString() });
      return { id: l.id, address: l.address, openHouses, described: openHouses.map(describeOpenHouse) };
    } catch (err) {
      return { id: l.id, address: l.address, error: (err as Error).message };
    }
  }));

  res.json({ checked: shortlisted.length, results });
}));

/**
 * Re-check price and status for specific houses.
 *
 * The only things about a listing that actually change: the price, whether it
 * has gone pending or sold, and when the next open house is. Everything else —
 * the plan, the lot, the year, which way it faces — is fixed, so re-reading a
 * whole listing to find a price drop is a request spent to learn one number.
 *
 * Pass `ids` for specific houses, or nothing to check everything shortlisted.
 */
app.post('/api/refresh', wrap(async (req, res) => {
  const [all, profile] = await Promise.all([allListings(), getProfile(USER)]);
  const ids: string[] | undefined = Array.isArray(req.body?.ids) ? req.body.ids : undefined;

  const targets = ids
    ? all.filter((l) => ids.includes(l.id))
    : all.filter((l) => ['shortlisted', 'selfTour', 'agentTour'].includes(profile.propertyFeedback?.[l.id] ?? ''));

  if (!targets.length)
    return res.status(400).json({
      error: ids
        ? 'None of those ids exist.'
        : 'Nothing is shortlisted, so there is nothing to watch. Shortlist a few houses, or pass ids.',
    });

  const changes: unknown[] = [];
  for (const l of targets) {
    try {
      const f = await fetchFacts(l.readableUrl ?? l.sourceUrl, { fresh: true });
      const before = { price: l.price, daysOnMarket: l.daysOnMarket };
      const patch: Record<string, unknown> = {};

      /* Off the market means out of the running. */
      if (f.status === 'sold' || f.status === 'off market') {
        await updateListing(l.id, { status: f.status, archivedAt: new Date().toISOString() });
        changes.push({ id: l.id, address: l.address, note: `Now ${f.status} — archived.` });
        continue;
      }
      if (f.status) patch.status = f.status;

      if (f.price && f.price !== l.price) patch.price = f.price;
      if (f.daysOnMarket !== undefined) patch.daysOnMarket = f.daysOnMarket;
      if (f.redfinEstimate) patch.redfinEstimate = f.redfinEstimate;

      /* The badges, from the page this endpoint just fetched.
         Refresh did not touch them at all, which is how 5090 Bellehurst Ln
         kept advertising "OPEN TODAY, 3PM TO 5PM" on its detail page through
         every refresh while its parsed open houses were correctly empty. The
         one endpoint whose whole job is "what changed today" was the one that
         never looked at the row most likely to have changed.
         Assigned, not filled: an empty list is Redfin taking the badge down. */
      if (f.sashes) patch.sashes = f.sashes;
      if (f.hoursOnMarket !== undefined) patch.hoursOnMarket = f.hoursOnMarket;
      if (f.has3dTour !== undefined) patch.has3dTour = f.has3dTour;
      if (f.isHot !== undefined) patch.isHot = f.isHot;

      /* Open houses are the other thing that actually changes, and the one you
         plan a weekend around. They are not in the page HTML at all — Redfin
         serves them from a separate endpoint — so this is one more request, and
         it is worth it for a house you are watching. */
      const openHouses = await fetchOpenHouses(l.readableUrl ?? l.sourceUrl).catch(() => []);
      patch.openHouses = openHouses;
      patch.openHousesCheckedAt = new Date().toISOString();

      /* Re-read the photo URLs whenever the listing moved.
       *
       * Redfin rotates the trailing revision digit on every photo when a
       * listing is touched — `7795370_1_6.jpg` becomes `_1_7` — and the old URL
       * starts returning 404. So the one operation most likely to invalidate
       * the images was the one that never refreshed them: this endpoint watched
       * for exactly the price and status changes that trigger the rotation, and
       * then wrote the new price beside a gallery of dead links.
       *
       * Seven houses were showing grey squares when he asked, and three of them
       * had changed in the sweep that morning — 6130 Bentley Commons the day it
       * cut $29,900, 4715 Westgate the day it came back from pending.
       *
       * It is free: `fetchFacts` above was called with `{ fresh: true }`, so the
       * page is already in the cache and `findFloorPlans` reads those same
       * bytes. No second request against the listing site. */
      const moved = patch.price !== undefined || patch.status !== undefined;
      if (moved) {
        /* Parse the gallery out of the HTML. No model call.
         *
         * This used `findFloorPlans`, which was the wrong tool: it re-reads the
         * page (free — it is already cached) AND then sends a dozen images to
         * Gemini to work out which ones are floor plans (not free at all, and
         * about ten seconds a house).
         *
         * A refresh needs neither. Which photos are plans has not changed just
         * because the price did; only the URLs rotated, and `galleryUrls` reads
         * those straight out of the HTML. Calling the classifier here turned a
         * three-minute sweep into a sixteen-minute one and spent 106 vision
         * calls on a question nobody asked.
         *
         * The plan classification still runs where it belongs: once when a
         * house is added, and again on an explicit `refresh-all`. */
        const { fetchListingPage } = await import('./services/listingPage.js');
        const html = await fetchListingPage(l.readableUrl ?? l.sourceUrl).catch(() => null);
        const urls = html ? galleryUrls(html) : [];
        if (urls.length) {
          /* Keep the plan pointers by position: the gallery order is stable
             across a revision bump, it is only the URL suffix that changes. */
          const oldGallery = l.images.gallery ?? [];
          const remap = (u?: string) => {
            if (!u) return u;
            const i = oldGallery.indexOf(u);
            return i >= 0 && urls[i] ? urls[i] : u;
          };
          patch.images = {
            ...l.images,
            exterior: remap(l.images.exterior) ?? urls[0],
            gallery: urls.slice(0, oldGallery.length || 6),
            floorPlan: remap(l.images.floorPlan),
            floorPlanExtra: (l.images.floorPlanExtra ?? []).map((u) => remap(u)!),
          };
        }
      }

      if (Object.keys(patch).length) await updateListing(l.id, patch);

      const oh = (patch.openHouses as unknown[] | undefined)?.length ?? 0;
      if (oh) {
        changes.push({
          id: l.id, address: l.address,
          note: `${oh} open house${oh === 1 ? '' : 's'} coming up`,
          openHouses: patch.openHouses,
        });
      }

      if (patch.price !== undefined) {
        const delta = (patch.price as number) - before.price;
        changes.push({
          id: l.id,
          address: l.address,
          was: before.price,
          now: patch.price,
          delta,
          note: delta < 0
            ? `Dropped $${Math.abs(delta).toLocaleString()}`
            : `Up $${delta.toLocaleString()}`,
        });
      }
    } catch (err) {
      changes.push({ id: l.id, address: l.address, error: (err as Error).message });
    }
  }

  res.json({ checked: targets.length, changed: changes.length, changes });
}));

/**
 * Re-read what we already downloaded.
 *
 * Every fact on a listing comes out of one page: price, beds, year, basement,
 * the range, the badges, the status, the photos. When a new field is added —
 * hours-on-market, say — the answer is already sitting in the cached page, and
 * re-fetching sixty-two pages to extract it would be sixty-two requests spent
 * on bytes we already hold.
 *
 * So this parses from cache only. Anything not cached is skipped rather than
 * fetched, and reported, so a later pass can pick it up.
 */
async function reparseFromCache(): Promise<{ listings: number; updated: number; notCached: number }> {
  const all = await allListings();
  let updated = 0;
  let notCached = 0;

  for (const l of all) {
    const url = l.readableUrl ?? l.sourceUrl;
    let facts;
    try {
      /* fetchFacts goes through the cache, and a cache hit spends no budget.
         A miss would fetch — so a miss is caught and skipped instead. */
      const { hasCachedPage } = await import('./services/listingPage.js');
      if (!(await hasCachedPage(url))) { notCached += 1; continue; }
      facts = await fetchFacts(url);
    } catch {
      notCached += 1;
      continue;
    }

    const patch: Record<string, unknown> = {};

    /* The gallery is in the cached page, and pulling image URLs out of HTML is
       a pure function over bytes we already hold. Six houses had their gallery
       fetched before photos were being saved, and the "already looked" flag
       then stopped them ever coming back — when the answer was on disk the
       whole time. */
    if (!l.images?.exterior) {
      const { hasCachedPage: cached, fetchListingPage: page } = await import('./services/listingPage.js');
      if (await cached(url)) {
        const urls = galleryUrls(await page(url));
        if (urls.length) {
          patch.images = { ...l.images, exterior: urls[0], gallery: urls.slice(0, 6) };
        }
      }
    }

    /* Assign, do not fill. An EMPTY sash list is a fact — it means Redfin has
       taken the badge down — and `?.length` treated it as "nothing to say" and
       kept the old one forever. 5090 Bellehurst Ln advertised "OPEN TODAY, 3PM
       TO 5PM" on its detail page with no open house anywhere in its listing,
       because a badge from a previous weekend had nothing to overwrite it.
       These are re-read from the page every time, so the page is the truth
       including when the page says nothing. */
    if (facts.sashes) patch.sashes = facts.sashes;
    if (facts.hoursOnMarket !== undefined) patch.hoursOnMarket = facts.hoursOnMarket;
    if (facts.has3dTour !== undefined) patch.has3dTour = facts.has3dTour;
    if (facts.isHot !== undefined) patch.isHot = facts.isHot;
    if (facts.isNewConstruction !== undefined) patch.isNewConstruction = facts.isNewConstruction;
    if (facts.status) {
      patch.status = facts.status;
      if (facts.status === 'sold' || facts.status === 'off market') {
        patch.archivedAt = new Date().toISOString();
      }
    }
    /* Derived from the page every time rather than only filling a blank — an
       early 'unknown' would otherwise stick forever once written. */
    if (facts.sewer) {
      patch.sewer = facts.sewer;
      patch.sewerEvidence = facts.sewerEvidence;
    }

    /* Walk Score and school rating come off the page, so a re-parse must be
       able to correct them. Leaving them out of this list is what let one lot
       keep a Walk Score of 60 while the page it was read from said 1. */
    if (facts.walkScore !== undefined || facts.schoolRating !== undefined) {
      patch.neighborhood = {
        ...l.neighborhood,
        ...(facts.walkScore !== undefined ? { walkScore: facts.walkScore } : {}),
        ...(facts.schoolRating !== undefined ? { schoolRating: facts.schoolRating } : {}),
      };
    }
    /* Install years for roof, HVAC, water heater and windows, read out of the
       seller's own remarks. Same rule as the sewer and the Walk Score: derived
       from the page, so a re-parse has to be able to correct it — and the
       reason 163 of 164 houses were being scored on their birthday alone is
       that nothing had ever written this field at all. */
    if (facts.systems && Object.keys(facts.systems).length)
      patch.systems = { ...(l.systems ?? {}), ...facts.systems };
    if (facts.systemsClaimed?.length) patch.systemsClaimed = facts.systemsClaimed;

    /* 55+ is read off the description every time rather than filled once. A
       seller can edit the remarks, and this is the fact that deletes the house —
       it has to be able to change its mind in both directions. */
    if (facts.ageRestricted !== undefined) {
      patch.ageRestricted = facts.ageRestricted;
      patch.ageRestrictedEvidence = facts.ageRestrictedEvidence;
    }


    if (facts.readiness) patch.readiness = facts.readiness;
    if (facts.completionEstimate) patch.completionEstimate = facts.completionEstimate;

    /* Facts that only fill a blank, so nothing typed by hand is overwritten. */
    for (const [k, v] of Object.entries({
      price: facts.price, beds: facts.beds, baths: facts.baths, sqft: facts.sqft,
      lotSizeAcres: facts.lotSizeAcres, yearBuilt: facts.yearBuilt,
      hoaMonthly: facts.hoaMonthly, daysOnMarket: facts.daysOnMarket,
      redfinEstimate: facts.redfinEstimate, basement: facts.basement,
      cooktopFuel: facts.cooktopFuel,
    })) {
      const had = (l as unknown as Record<string, unknown>)[k];
      if (v !== undefined && (had === undefined || had === 0 || had === '')) patch[k] = v;
    }

    if (Object.keys(patch).length) {
      await updateListing(l.id, patch);
      updated += 1;
    }
  }

  return { listings: all.length, updated, notCached };
}

app.post('/api/reparse', wrap(async (_req, res) => {
  res.json({ ...(await reparseFromCache()), requestsSpent: 0 });
}));

/**
 * Start again on one house.
 *
 * Forgets its cached page, its reading, and its settled "no plan here" verdict,
 * then does the whole job fresh. For when a listing has plainly changed — new
 * photos, a price cut, a plan finally uploaded — or when you simply do not
 * believe what it is telling you.
 *
 * Deliberately per-house. Forcing all sixty-two costs a fetch each and there is
 * rarely a reason; forcing the one in front of you costs three or four.
 */
app.post('/api/listings/:id/refresh-all', wrap(async (req, res) => {
  const listing = await listingById(id(req));
  if (!listing) return res.status(404).json({ error: 'No such listing.' });

  const { forgetCachedPage } = await import('./services/listingPage.js');
  await forgetCachedPage(listing.readableUrl ?? listing.sourceUrl);
  await clearPerception(listing.id);

  /* Clear the flag that says "we looked, there is no plan" — the whole point of
     this is to stop trusting what we concluded last time. */
  await updateListing(listing.id, {
    images: { ...listing.images, planSearch: undefined },
  });

  const found = await findFloorPlans(listing.readableUrl ?? listing.sourceUrl).catch(() => null);
  if (found?.gallery.length) {
    const fresh = (await listingById(listing.id))!;
    await updateListing(listing.id, {
      images: {
        ...fresh.images,
        exterior: found.exteriorUrl ?? fresh.images.exterior,
        gallery: found.gallery,
        kitchenPhotos: found.kitchenUrls,
        ...(found.urls.length
          ? { floorPlan: found.urls[0], floorPlanExtra: found.urls.slice(1) }
          : {}),
        planSearch: {
          at: new Date().toISOString(),
          outcome: found.outcome === 'found' ? 'none-in-listing' : found.outcome,
          note: found.note,
        },
      },
    });
  }

  const out = await enrichListing(listing.id);
  if ('error' in out) return res.status(422).json(out);

  const profile = await getProfile(USER);
  const assessment = await assessListing(out, profile, { force: true, deep: true });
  res.json({ listing: out, assessment });
}));

/* ---------------------------- enrichment ---------------------------- */

/**
 * Everything a set of coordinates can tell us: tract demographics, and a
 * satellite tile to read the yard from.
 *
 * Runs automatically when a house is added. Making this a button meant a newly
 * pasted house sat there with no aerial and no census data, scoring on almost
 * nothing and looking broken — which is exactly how it looked.
 */
async function enrichListing(
  listingId: string,
  opts?: { googleOnly?: boolean },
): Promise<Listing | { error: string }> {
  const listing = await listingById(listingId);
  if (!listing) return { error: 'No such listing.' };
  const profile = await getProfile(USER);

  /* Re-geocode whenever we do not already have a rooftop fix. An address first
     placed by the free fallback should be upgraded once a Maps key exists,
     rather than carrying a street-centreline point forever. */
  let coords = listing.coords;
  let geocodeQuality = listing.geocodeQuality;
  let coordsSource = listing.coordsSource;

  if (!coords || geocodeQuality !== 'ROOFTOP') {
    const g = await geocode(listing.address).catch(() => null);

    /* The listing site's own coordinates, free from the cached page, as a
       second opinion — Google does not know streets platted last year. */
    /* Only from a page already on disk — this must never trigger a fetch. */
    const { hasCachedPage } = await import('./services/listingPage.js');
    const pageUrl = listing.readableUrl ?? listing.sourceUrl;
    const pageCoords = (await hasCachedPage(pageUrl).catch(() => false))
      ? await fetchFacts(pageUrl).then((f) => f.coords).catch(() => undefined)
      : undefined;

    /* A point several different houses claim is a fallback, not an address.
     *
     * Counted over what the PAGES say as well as what is stored, because
     * checking only the stored values made the answer depend on the order the
     * houses happened to be enriched in: 4855 Wayt Farm Overlook took the point
     * first, so nothing had claimed it yet and it looked unique; 4895 and 5015
     * arrived later, saw it taken, and correctly refused it. All three pages
     * report the same coordinate — it is the community's point, not any of the
     * three houses — so all three should have refused it.
     *
     * Page coordinates come from cached bytes only, so this costs nothing. */
    const others = await allListings();
    const { hasCachedPage: cached2 } = await import('./services/listingPage.js');
    const seen = new Map<string, number>();
    const bump = (c?: { lat: number; lng: number }) => {
      if (!c) return;
      const k = `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    };
    for (const o of others) {
      if (o.id === listing.id) continue;
      bump(o.coords);
      const ou = o.readableUrl ?? o.sourceUrl;
      if (await cached2(ou).catch(() => false)) {
        bump(await fetchFacts(ou).then((f) => f.coords).catch(() => undefined));
      }
    }
    const suspect = (c: { lat: number; lng: number }) =>
      (seen.get(`${c.lat.toFixed(5)},${c.lng.toFixed(5)}`) ?? 0) >= 1;

    const picked = pickCoords(
      g ? { coords: g.coords, quality: g.locationType } : null, pageCoords, suspect,
    );
    if (picked.coords) {
      coords = picked.coords;
      geocodeQuality = g?.locationType;
      coordsSource = picked.source;
    } else if (coords) {
      /* Nothing better was found and there is an old point on file. Keep it so
         the house stays on the map, but say plainly that it is not trusted —
         silently carrying on with a town centroid is how 4835 Rosarian Dr got
         scored five miles from itself for a week. */
      coordsSource = 'could not be placed — this point is the centre of town, not the house';
    }
  }

  if (!coords) return { error: 'Could not place that address on the map.' };

  /* Everything a set of coordinates or a listing URL can tell us, in one go.
     Splitting these across buttons meant a freshly added house sat there
     scoring on almost nothing. */
  /* Google-only mode.
   *
   * Everything Google sells is metered by money, which is cheap, and nothing
   * else. Everything a listing site gives us is metered by their patience,
   * which is not. So a wide first pass can cover every house using satellite,
   * census, places and routes, and the scarce listing-site budget gets spent
   * afterwards on whichever houses that pass says are worth it. */
  const googleOnly = opts?.googleOnly === true;

  const [looked, nearby, commute, anchorMiles] = await Promise.all([
    enrich({ ...listing, coords }),
    findNearby(coords).catch(() => null),
    assessCommute(listing, profile.preferences.workAddress).catch(() => null),
    distancesFrom(coords).catch(() => null),
  ]);

  const facts = googleOnly ? null
    : await fetchFacts(listing.readableUrl ?? listing.sourceUrl).catch(() => null);
  const history = googleOnly ? null
    : await fetchPriceHistory(listing.readableUrl ?? listing.sourceUrl).catch(() => null);

  /* Photos, on the same page fetch the facts just used.
   *
   * This was the gap that made a freshly pasted house look broken: facts,
   * census, commute and both satellite tiles all landed, so the house scored
   * and ranked — but `images` only ever got the two aerials written back, and
   * the exterior, the gallery and the floor plan were left to `refresh-all`,
   * a button on a house he had no reason to press yet. Twelve houses went in
   * and every one of them showed a satellite square where a photo belongs.
   *
   * It is nearly free: `findFloorPlans` reads through `fetchListingPage`, the
   * same cached bytes `fetchFacts` pulled a line above, so no second request
   * is spent against the listing site. Only the plan classification costs
   * anything, which is why it runs once — when there is no gallery on file —
   * rather than on every re-enrich. `refresh-all` remains the way to make it
   * look again on purpose. */
  const wantsPhotos = !googleOnly && !(listing.images.gallery ?? []).length;
  const found = wantsPhotos
    ? await findFloorPlans(listing.readableUrl ?? listing.sourceUrl).catch(() => null)
    : null;

  /* Spreading the lookup straight over the stored record wipes anything it did
     not find: Walk Score has no key configured, so it returns
     `walkScore: undefined`, and that overwrote the number typed off the Redfin
     page. An absent value must not beat a known one. */
  const neighborhood: Record<string, unknown> & { schoolRating?: number; walkScore?: number } =
    { ...listing.neighborhood };
  for (const [k, v] of Object.entries(looked)) {
    if (v !== undefined && v !== null) (neighborhood as Record<string, unknown>)[k] = v;
  }

  /* Two framings of the same lot.
     scale=2 returns 1280x1280 for the same billed request — a plain 640 tile
     was called "too small to identify fencing", which is the one thing it is
     asked to look for. But zoom 20 crops out the surroundings, so the wide
     shot carries the context: what the lot backs onto, and how close the
     neighbours are. */
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const tile = (zoom: number) =>
    `https://maps.googleapis.com/maps/api/staticmap?center=${coords.lat},${coords.lng}` +
    `&zoom=${zoom}&size=640x640&scale=2&maptype=satellite&key=${key}`;
  const aerial = key ? tile(20) : listing.images.aerial;
  const aerialWide = key ? tile(17) : listing.images.aerialWide;

  /* Scraped facts fill blanks only. Anything already entered by hand wins —
     he has stood in these houses and the parser has not. */
  const filled: Record<string, unknown> = {};
  if (facts) {
    /* These belong inside `neighborhood`, not at the top level, so they are
       merged there rather than written as stray root fields that nothing reads. */
    /* Refreshed from the page every time, not written once and frozen.
     *
     * These are derived numbers, not things he typed, and fill-blank-only left
     * 123 Peaceful Grove Dr carrying a Walk Score of 60 from an early scrape
     * while the page — and the identical lot next door — said 1. Same lesson as
     * the septic flag: a value read off a page has to be re-read off the page. */
    if (facts.schoolRating !== undefined) neighborhood.schoolRating = facts.schoolRating;
    if (facts.walkScore !== undefined) neighborhood.walkScore = facts.walkScore;

    for (const [k, v] of Object.entries(facts)) {
      if (v === undefined) continue;
      if (['description', 'cooktopEvidence', 'schoolRating', 'walkScore'].includes(k)) continue;
      const existing = (listing as unknown as Record<string, unknown>)[k];
      if (existing === undefined || existing === 0 || existing === '') filled[k] = v;
    }
    if (facts.cooktopEvidence && !listing.cooktopEvidence) filled.cooktopEvidence = facts.cooktopEvidence;

    /* Install years overwrite rather than fill a blank.
       They are read off the page every time, like the status and the school
       rating, and a seller who adds "new roof 2025" to the remarks mid-listing
       should be believed on the re-read rather than ignored because the field
       was already empty-but-present. */
    if (facts.systems && Object.keys(facts.systems).length)
      filled.systems = { ...(listing.systems ?? {}), ...facts.systems };
    if (facts.systemsClaimed?.length) filled.systemsClaimed = facts.systemsClaimed;

    /* 55+ is read off the description every time rather than filled once. A
       seller can edit the remarks, and this is the fact that deletes the house —
       it has to be able to change its mind in both directions. */
    if (facts.ageRestricted !== undefined) {
      filled.ageRestricted = facts.ageRestricted;
      filled.ageRestrictedEvidence = facts.ageRestrictedEvidence;
    }


    /* Status overwrites rather than filling a blank — it is the one fact whose
       whole purpose is to change. */
    if (facts.status) {
      filled.status = facts.status;
      if (facts.status === 'sold' || facts.status === 'off market') {
        filled.archivedAt = new Date().toISOString();
      }
    }
  }

  const updated = await updateListing(listing.id, {
    ...filled,
    coords,
    geocodeQuality,
    coordsSource,
    /* Which GA-400 exit this hangs off — how he actually navigates. */
    exit: nearestExit(coords),
    neighborhood,
    priceHistory: history ?? listing.priceHistory,
    /* The published first-list price beats anything typed by hand — it is the
       number the seller themselves put on the house. */
    originalPrice: history?.firstListPrice ?? listing.originalPrice,
    anchors: anchorMiles ?? listing.anchors,
    commute: commute?.available
      ? {
          legs: commute.legs,
          miles: commute.miles,
          worstMinutes: commute.worstMinutes,
          trafficModelled: commute.trafficModelled,
          badDayMinutes: commute.badDayMinutes,
          note: commute.note,
        }
      : listing.commute,
    nearby: nearby?.available
      ? { places: nearby.places, nearestParkMetres: nearby.nearestParkMetres, note: nearby.note }
      : listing.nearby,
    images: {
      ...listing.images,
      aerial,
      aerialWide,
      ...(found?.gallery.length
        ? {
            exterior: found.exteriorUrl ?? listing.images.exterior,
            gallery: found.gallery,
            kitchenPhotos: found.kitchenUrls,
            ...(found.urls.length
              ? { floorPlan: found.urls[0], floorPlanExtra: found.urls.slice(1) }
              : {}),
            planSearch: {
              at: new Date().toISOString(),
              outcome: found.outcome === 'found' ? 'none-in-listing' : found.outcome,
              note: found.note,
            },
          }
        : {}),
    },
  });
  return updated ?? { error: 'Listing vanished mid-update.' };
}

app.post('/api/listings/:id/enrich', wrap(async (req, res) => {
  const out = await enrichListing(id(req), { googleOnly: req.query.googleOnly === 'true' });
  if ('error' in out) return res.status(422).json(out);
  res.json(out);
}));

/** Just the compass question, on its own, for when you want to check one fast. */
app.get('/api/listings/:id/facing', wrap(async (req, res) => {
  const listing = await listingById(id(req));
  if (!listing) return res.status(404).json({ error: 'No such listing.' });
  res.json(await resolveOrientation(listing.address, listing.coords, listing.geocodeQuality));
}));

/* ------------------------- the builder plan book ------------------------- */

/**
 * Add a builder's floor plan, read it, and score it at every facing.
 *
 * Not a house — a drawing. Pulte's Continental exists on lots all over Forsyth
 * facing every direction, and reading it once says something about all of them,
 * including the lots not yet listed. The images arrive as data URLs because
 * these viewers draw the plan client-side: there is no image file to fetch, so
 * it gets rasterised in the browser and posted here.
 */
app.post('/api/plan-library', wrap(async (req, res) => {
  const { builder, name, community, sqft, sourceUrl, images, reading } = req.body ?? {};
  if (!builder || !name) return res.status(400).json({ error: 'builder and name are required.' });
  if (!Array.isArray(images) && !reading)
    return res.status(400).json({ error: 'Either plan images or a reading is required.' });

  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24);
  const saved: string[] = [];
  for (const dataUrl of (images ?? []).slice(0, 5)) saved.push(await savePlanImage(String(dataUrl), slug));

  /* A reading supplied directly, for plans that live inside a builder's own
     interactive viewer.
   *
   * Those draw the plan in the browser from vector data, so there is no image
   * file to fetch and no way to post one back from an https page to a local
   * http server. The drawing still has to be read by something with eyes — it
   * just does not have to be read by this process. What matters is that the
   * numbers come from the actual drawing and are recorded as such. */
  if (reading) {
    const perception = {
      ...UNKNOWN_PERCEPTION,
      ...reading,
      planPositions: { ...UNKNOWN_PERCEPTION.planPositions, ...(reading.planPositions ?? {}) },
    } as typeof UNKNOWN_PERCEPTION;
    const scored = scoreAllFacings(perception, reading.childBedroomOptions ?? []);
    return res.json({
      plan: await addPlan({
        builder: String(builder), name: String(name),
        community: community ? String(community) : undefined,
        sqft: sqft ? Number(sqft) : undefined,
        sourceUrl: sourceUrl ? String(sourceUrl) : undefined,
        images: saved,
        perception,
        entranceEdge: perception.entranceEdgeOnPlan,
        byFacing: scored.byFacing,
        best: scored.best,
      }),
    });
  }

  /* The reader wants a Listing. A plan is not one, so it gets a stub carrying
     nothing but the drawings — no aerial, no address, no price. Everything the
     reader says about the yard will be unknown, which is correct: a plan does
     not have a garden. */
  const stub = {
    id: `plan-${slug}`,
    address: `${builder} ${name}${community ? ` at ${community}` : ''}`,
    images: { floorPlan: saved[0], floorPlanExtra: saved.slice(1) },
  } as unknown as Parameters<typeof perceiveProperty>[0];

  const vision = await perceiveProperty(stub);
  const { byFacing, best } = scoreAllFacings(vision.perception);

  const plan = await addPlan({
    builder: String(builder),
    name: String(name),
    community: community ? String(community) : undefined,
    sqft: sqft ? Number(sqft) : undefined,
    sourceUrl: sourceUrl ? String(sourceUrl) : undefined,
    images: saved,
    perception: vision.perception,
    entranceEdge: vision.perception.entranceEdgeOnPlan,
    byFacing,
    best,
  });

  res.json({ plan, degraded: vision.degraded, model: vision.model });
}));

app.get('/api/plan-library', wrap(async (_req, res) => res.json({ plans: await allPlans() })));

app.delete('/api/plan-library/:id', wrap(async (req, res) => {
  const gone = await removePlan(String(req.params.id));
  if (!gone) return res.status(404).json({ error: 'No such plan.' });
  res.json({ ok: true });
}));

/**
 * The plan library.
 *
 * Every house whose drawing has been read, scored at each facing it could have
 * had, and grouped by layout so the repeats are visible. Free — no model call,
 * no listing-site request; it is arithmetic over readings already cached.
 */
app.get('/api/plans', wrap(async (_req, res) => {
  const [listings, profile] = await Promise.all([allListings(), getProfile(USER)]);

  const read = await Promise.all(listings.map(async (l) => {
    const a = await assessListing(l, profile, { cachedOnly: true }).catch(() => null);
    if (!a) return null;
    const plan = planRead(a.perception, a.orientation, a.evidence.planRead);
    return plan ? { listing: l, plan, facing: a.orientation.entranceDirection } : null;
  }));

  const rows = read.filter(Boolean) as NonNullable<typeof read[number]>[];

  /* One entry per drawing, with every lot carrying it. */
  const families = new Map<string, typeof rows>();
  for (const r of rows) families.set(r.plan.key, [...(families.get(r.plan.key) ?? []), r]);

  res.json({
    plans: [...families.values()]
      .map((g) => ({
        lots: g.length,
        byFacing: g[0]!.plan.byFacing,
        best: g[0]!.plan.best,
        houses: g
          .map((r) => ({
            id: r.listing.id,
            address: r.listing.address,
            price: r.listing.price,
            facing: r.facing,
            score: r.plan.current ?? 0,
            forgone: r.plan.forgone ?? 0,
          }))
          .sort((a, b) => b.score - a.score),
      }))
      .sort((a, b) => b.lots - a.lots || b.best.score - a.best.score),
  });
}));

/**
 * No automatic scanning.
 *
 * A worker was added here that topped up incomplete houses every few minutes.
 * It was removed on his instruction, and he was right: the Scan menu offers
 * four jobs at four stated prices, and the whole point of naming the price is
 * that he decides when to pay it. Something spending his listing-site budget on
 * a timer, in the background, on an account that matters, is the opposite of
 * that — however careful its margins.
 *
 * What survives is the part that only reports: `/api/incomplete` says what is
 * still missing and how much budget is left, so "did it work?" has an answer
 * without anything being spent to produce it.
 */

/** What is still missing, so the UI can say so instead of looking broken. */
app.get('/api/incomplete', wrap(async (_req, res) => {
  const stale = (await allListings())
    .filter((l) => !l.archivedAt && (!l.price || !l.sqft || !l.images?.exterior))
    .map((l) => ({ id: l.id, address: l.address, addedAt: l.addedAt }));
  res.json({ waiting: stale.length, listings: stale, budget: remaining() });
}));

/* ------------------------------ scan ------------------------------ */

/**
 * Read and rank everything, streamed.
 *
 * Server-sent events rather than one big response, because the first scan of a
 * new batch takes a few seconds per house and watching them land one at a time
 * is the difference between "working" and "hung".
 */
app.get('/api/scan', wrap(async (req, res) => {
  const force = req.query.force === 'true';
  const cachedOnly = req.query.cachedOnly === 'true';

  /* Throw away the saved copy of every listing page first.
   *
   * Everything else in a scan reads pages off disk, which is what keeps the
   * request count near zero — but it also means open house dates are only as
   * fresh as the last time a page was actually fetched, and a Saturday that has
   * been and gone is worse than no date at all. This is the button for "the
   * weekend is over, go and look again": one request per house, and the budget
   * refuses rather than delays if that is too many for today. */
  if (req.query.refetch === 'true') {
    const { forgetCachedPage } = await import('./services/listingPage.js');
    for (const l of await allListings()) {
      await forgetCachedPage(l.readableUrl ?? l.sourceUrl).catch(() => null);
    }
  }

  /* Anything that never got its lookups gets them now.
   *
   * Enrichment on create runs seven or eight API calls and can outlive the
   * browser request that started it. Two houses added through the UI ended up
   * stored with a price of 0, no coordinates and no plan — scoring on nothing
   * and looking broken. Repairing them here means a half-added house cannot
   * stay half-added, whatever happened to the original request. */
  /* Open the stream before doing any work.
   *
   * The repair phase below used to run first, which meant the browser held an
   * unanswered request for however long it took and the spinner had nothing to
   * show. If anything restarted the API during it — a file save, another
   * `npm run dev` grabbing the port — the request died having sent nothing, and
   * the scan looked like it had quietly given up after "only the Google bits".
   * Headers first, so there is always something on the wire to watch. */
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  if (!cachedOnly) {
    send('phase', { note: 'Re-reading pages already on disk' });

    /* Re-read every cached page first. Free — the bytes are already on disk —
       and it fills in any field added since a listing was last looked at,
       which is how status sat at 2 of 62 while everything else was complete. */
    await reparseFromCache().catch(() => null);

    /* Then fetch only for houses actually missing something. Re-enriching a
       complete house spends API calls and, on the listing sites, patience. */
    const stale = (await allListings()).filter(
      (l) => !l.coords || !l.price || !l.yearBuilt || !l.neighborhood?.diversityIndex,
    );
    if (stale.length) send('phase', { note: `Filling gaps on ${stale.length} house(s)` });
    for (const l of stale) await enrichListing(l.id).catch(() => null);
  }

  const [unsorted, profile] = await Promise.all([allListings(), getProfile(USER)]);

  /* Half-finished houses go first.
   *
   * A scan can run out of budget part way — that is the whole point of the
   * budget — and when it does, whatever it had not reached stays empty. Going
   * in stored order meant a hundred and twenty-seven houses that already had
   * everything were refreshed before the four added a minute ago were even
   * looked at, and the four he actually cared about were the ones that missed
   * out. Need decides the order now. */
  const incomplete = (l: typeof unsorted[number]) =>
    !l.price || !l.sqft || !l.images?.exterior ? 0 : 1;
  const listings = [...unsorted].sort((a, b) => incomplete(a) - incomplete(b));

  send('start', { total: listings.length, profileVersion: profile.version });

  /* A small pool, not Promise.all. Firing forty vision calls at once earns a
     wall of 503s from a model that was perfectly happy to answer four at a
     time, and the retries then cost more than the patience would have. */
  const CONCURRENCY = 4;
  let cursor = 0;
  let done = 0;

  const worker = async () => {
    while (cursor < listings.length) {
      const listing = listings[cursor++]!;
      try {
        /* Go looking at the gallery when looking can still help.
         *
         * Three states, three answers. A gallery read in full that contained no
         * plan is a settled question and must not be re-asked every scan — that
         * is what gets us rate-limited. A BLOCKED read should be retried,
         * because nothing was learned. A house never looked at gets looked at.
         *
         * The condition used to be "no floor plan", which meant a house whose
         * gallery had been read for a plan never came back for its PHOTO — so
         * the list showed blanks for houses that had been fetched already. */
        const search = listing.images.planSearch;
        const settledNoPlan = search?.outcome === 'none-in-listing';
        const missingPhoto = !listing.images.exterior;
        const missingPlan = !listing.images.floorPlan && !settledNoPlan;
        const worthLooking = missingPlan || (missingPhoto && !settledNoPlan);

        if (!cachedOnly && worthLooking) {
          const found = await findFloorPlans(listing.readableUrl ?? listing.sourceUrl).catch(() => null);

          /* Photos are saved whether or not a floor plan turned up.
           *
           * These were nested inside the "found a plan" branch, so a house with
           * a perfectly good gallery and no floor plan — which is most of them —
           * had its front photo fetched, looked at, and thrown away. Fourteen of
           * sixty-two had a picture, and they were exactly the fourteen that
           * happened to publish a plan. */
          if (found?.gallery.length) {
            listing.images.exterior = found.exteriorUrl ?? listing.images.exterior;
            listing.images.gallery = found.gallery;
            listing.images.kitchenPhotos = found.kitchenUrls;
          }

          if (found?.urls.length) {
            listing.images.floorPlan = found.urls[0];
            listing.images.floorPlanExtra = found.urls.slice(1);

            /* There is something new to read, so the old reading is wrong.
               Without this the scan attached a plan and then scored the house
               from a cached perception taken when it had none. */
            await clearPerception(listing.id);
          }
          if (found) {
            listing.images.planSearch = {
              at: new Date().toISOString(),
              outcome: found.outcome === 'found' ? 'none-in-listing' : found.outcome,
              note: found.note,
            };
            await updateListing(listing.id, { images: { ...listing.images } });
          }
        }

        /* Open houses come out of the cached page, so this is free and can run
           every scan. It was behind its own button, which meant the dates were
           only ever as fresh as the last time someone thought to press it. */
        if (!cachedOnly) {
          const openHouses = await fetchOpenHouses(listing.readableUrl ?? listing.sourceUrl)
            .catch(() => null);
          if (openHouses) {
            listing.openHouses = openHouses;
            await updateListing(listing.id, {
              openHouses,
              openHousesCheckedAt: new Date().toISOString(),
            });
          }
        }

        const assessment = await assessListing(listing, profile, { force, cachedOnly });
        if (assessment) send('property', assessment);
        else send('skipped', { listingId: listing.id });
      } catch (err) {
        const msg = (err as Error).message;
        send('failed', { listingId: listing.id, error: msg });
        /* A budget refusal is not a per-house failure, it is the end of the
           run. Say so once and stop, instead of grinding through the rest
           reporting the same thing a hundred times. */
        if ((err as Error).name === 'BudgetExhausted') {
          send('budget', { note: msg, reached: done, total: listings.length });
          cursor = listings.length;
        }
      }
      send('progress', { done: ++done, total: listings.length });
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, listings.length) }, worker));
  send('done', { total: listings.length });
  res.end();
}));

app.get('/api/listings/:id/assessment', wrap(async (req, res) => {
  const listing = await listingById(id(req));
  if (!listing) return res.status(404).json({ error: 'No such listing.' });
  const profile = await getProfile(USER);
  const force = req.query.force === 'true';
  res.json(await assessListing(listing, profile, { force }));
}));

/* ----------------------------- profile ----------------------------- */

app.get('/api/profile', wrap(async (_req, res) => res.json(await getProfile(USER))));

app.patch('/api/profile', wrap(async (req, res) => {
  /* Say no to what is not understood, rather than accepting it and doing
     nothing. A silent no-op that answers 200 is the worst of both. */
  const allowed = ['weights', 'nonNegotiables', 'preferences', 'propertyFeedback'];
  const unknown = Object.keys(req.body ?? {}).filter((k) => !allowed.includes(k));
  if (unknown.length)
    return res.status(400).json({
      error: `This endpoint does not know how to set: ${unknown.join(', ')}. ` +
             `It understands ${allowed.join(', ')}.`,
    });
  res.json(await updateProfile(USER, req.body ?? {}));
}));

app.post('/api/profile/reset', wrap(async (_req, res) => res.json(await resetProfile(USER))));

/** "Not for us" / "shortlist this", with no explanation required. */
app.post('/api/listings/:id/verdict', wrap(async (req, res) => {
  const v = req.body?.verdict ?? null;
  if (v !== null && !['rejected', 'tooFar', 'maybe', 'shortlisted', 'selfTour', 'agentTour', 'toured'].includes(v))
    return res.status(400).json({ error: 'verdict must be rejected, shortlisted, toured or null.' });
  res.json(await setVerdict(USER, id(req), v));
}));

/**
 * Teach it something, in your own words.
 *
 * Two effects, kept apart on purpose: your verdict on this house, and the
 * general lesson for houses you have not seen. Conflating them is how the first
 * version ended up promoting a house because you rejected it.
 */
app.post('/api/listings/:id/feedback', wrap(async (req, res) => {
  const listing = await listingById(id(req));
  if (!listing) return res.status(404).json({ error: 'No such listing.' });

  const action = req.body?.action === 'thumbs_up' ? 'thumbs_up' : 'thumbs_down';
  const critique = String(req.body?.critique ?? '').slice(0, 1000);

  const interpretation = critique
    ? await interpretFeedback(action, critique, `${listing.address}, $${listing.price.toLocaleString()}`)
    : { adjustments: [], note: action === 'thumbs_up' ? 'Shortlisted.' : 'Marked as not for you.', degraded: false };

  const applied = await applyFeedback(
    USER, listing.id, action, interpretation.adjustments, interpretation.note,
  );

  res.json({ ...applied, degraded: interpretation.degraded });
}));

/* ------------------------------------------------------------------ */

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[api]', err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  const s = dataSourceStatus();
  console.log(`\n  House Hunting V2 — running at http://localhost:${PORT}`);
  console.log(`  vision:  ${s.gemini ? MODEL : 'GEMINI_API_KEY not set — scans will degrade'}`);
  console.log(`  maps:    ${s.maps ? 'on' : 'GOOGLE_MAPS_API_KEY not set — no facing direction'}`);
  console.log(`  census:  ${s.census ? 'on' : 'CENSUS_API_KEY not set — no neighbourhood mix'}`);
  console.log(`  walk:    ${s.walkScore ? 'on' : 'WALKSCORE_API_KEY not set — no walk score'}\n`);
});
