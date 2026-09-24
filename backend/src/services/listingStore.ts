/**
 * The houses you are considering.
 *
 * Intake is deliberately manual. You browse Redfin or Zillow the way you
 * already do, favourite what catches your eye, and later paste those links in
 * here in a batch. No inbox scraping, no crawler, no terms-of-service problem —
 * just the list you built yourself, handed over when you are at your desk.
 *
 * Stored as one JSON file. Forty houses is a small number and this has to
 * survive you closing the laptop, not a fleet of servers.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Listing } from '../types/listing.js';
import { STORE_DIR } from '../paths.js';

const FILE = join(STORE_DIR, 'listings.json');

let cache: Listing[] | null = null;

async function load(): Promise<Listing[]> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(FILE, 'utf8')) as Listing[];
  } catch {
    cache = [];
  }
  return cache;
}

async function persist(all: Listing[]): Promise<void> {
  cache = all;
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(all, null, 2));
}

export async function allListings(): Promise<Listing[]> {
  return [...(await load())];
}

export async function listingById(id: string): Promise<Listing | undefined> {
  return (await load()).find((l) => l.id === id);
}

/* ------------------------------------------------------------------ *
 * Parsing what you paste
 * ------------------------------------------------------------------ */

export interface ParsedUrl {
  url: string;
  site: 'redfin' | 'zillow' | 'other';
  /** Recovered from the URL slug when the site puts it there. */
  addressGuess?: string;
}

/**
 * Pull what we can out of the URLs alone.
 *
 * Redfin and Zillow both encode the street address in the path, which is enough
 * to geocode and therefore enough to work out which way the house faces. Price,
 * beds and lot size are not in the URL, so the app asks you for those — which is
 * a fair trade for not running a scraper against their servers.
 *
 *   redfin.com/GA/Atlanta/1234-Elm-St-30306/home/12345678
 *   zillow.com/homedetails/1234-Elm-St-Atlanta-GA-30306/12345_zpid/
 */
export function parsePastedUrls(raw: string): ParsedUrl[] {
  const urls = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));

  const seen = new Set<string>();
  const out: ParsedUrl[] = [];

  /* The same house arrives many times over.
   *
   * Redfin's emails append utm_source, riftinfo and a base64 blob, so one
   * property copied from three different emails is three different strings and
   * nothing but the path is shared. Duplicates are found on the path — the
   * state, city, street and property id — with the query thrown away. */
  const identity = (u: string) => {
    try {
      const { hostname, pathname } = new URL(u);
      return `${hostname.replace(/^www\./, '')}${pathname.replace(/\/+$/, '').toLowerCase()}`;
    } catch {
      return u;
    }
  };

  for (const url of urls) {
    const key = identity(url);
    if (seen.has(key)) continue;
    seen.add(key);

    let site: ParsedUrl['site'] = 'other';
    let addressGuess: string | undefined;

    try {
      const { hostname, pathname } = new URL(url);

      if (hostname.includes('redfin.')) {
        site = 'redfin';
        // /GA/Atlanta/1234-Elm-St-30306/home/123 -> street, city, zip
        const seg = pathname.split('/').filter(Boolean);
        const state = seg[0], city = seg[1], slug = seg[2];
        if (state && city && slug) {
          const zip = slug.match(/-(\d{5})$/)?.[1];
          const street = slug.replace(/-\d{5}$/, '').replace(/-/g, ' ');
          addressGuess = [street, city.replace(/-/g, ' '), state, zip].filter(Boolean).join(', ');
        }
      } else if (hostname.includes('zillow.')) {
        site = 'zillow';
        // /homedetails/1234-Elm-St-Atlanta-GA-30306/12345_zpid/
        const slug = pathname.split('/').filter(Boolean)[1];
        if (slug) addressGuess = slug.replace(/-/g, ' ');
      }
    } catch {
      /* Not a URL we can read. It still goes in the list; you fill the rest. */
    }

    out.push({ url, site, addressGuess });
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

export type NewListing = Partial<Listing> & { sourceUrl: string; address: string };

export async function addListing(input: NewListing): Promise<Listing> {
  const all = await load();

  // Pasting the same link twice is a normal thing to do across two sessions.
  const existing = all.find((l) => l.sourceUrl === input.sourceUrl);
  if (existing) return existing;

  const listing: Listing = {
    id: randomUUID().slice(0, 8),
    sourceUrl: input.sourceUrl,
    readableUrl: input.readableUrl,
    address: input.address,
    price: input.price ?? 0,
    beds: input.beds ?? 0,
    baths: input.baths ?? 0,
    sqft: input.sqft ?? 0,
    lotSizeAcres: input.lotSizeAcres ?? 0,
    yearBuilt: input.yearBuilt ?? 0,
    propertyType: input.propertyType ?? 'Single Family',
    hoaMonthly: input.hoaMonthly ?? 0,
    coords: input.coords,
    images: input.images ?? {},
    neighborhood: input.neighborhood,
    commuteMinutes: input.commuteMinutes,
    daysOnMarket: input.daysOnMarket,
    commute: input.commute,
    anchors: input.anchors,
    observedPeakMinutes: input.observedPeakMinutes,
    geocodeQuality: input.geocodeQuality,
    fencePermitted: input.fencePermitted,
    observed: input.observed,
    systems: input.systems,
    redfinEstimate: input.redfinEstimate,
    zestimate: input.zestimate,
    cooktopFuel: input.cooktopFuel,
    cooktopEvidence: input.cooktopEvidence,
    basement: input.basement,
    readiness: input.readiness,
    isNewConstruction: input.isNewConstruction,
    sashes: input.sashes,
    hoursOnMarket: input.hoursOnMarket,
    has3dTour: input.has3dTour,
    isHot: input.isHot,
    status: input.status,
    archivedAt: input.archivedAt,
    completionEstimate: input.completionEstimate,
    basementEvidence: input.basementEvidence,
    observedFacing: input.observedFacing,
    facadeScore: input.facadeScore,
    bedroomSizes: input.bedroomSizes,
    referredBy: input.referredBy,
    ageRestricted: input.ageRestricted,
    ageRestrictedEvidence: input.ageRestrictedEvidence,
    exit: input.exit,
    sewer: input.sewer,
    sewerEvidence: input.sewerEvidence,
    nearby: input.nearby,
    openHouses: input.openHouses,
    openHousesCheckedAt: input.openHousesCheckedAt,
    originalPrice: input.originalPrice,
    priceHistory: input.priceHistory,
    notes: input.notes,
    myNotes: input.myNotes,
    myNotesUpdatedAt: input.myNotesUpdatedAt,
    addedAt: new Date().toISOString(),
  };

  all.push(listing);
  await persist(all);
  return listing;
}

export async function updateListing(id: string, patch: Partial<Listing>): Promise<Listing | undefined> {
  const all = await load();
  const i = all.findIndex((l) => l.id === id);
  if (i === -1) return undefined;
  const current = all[i]!;

  /* Your notes are yours. A patch may set them deliberately, but a patch that
     simply does not mention them must never clear them — and enrichment builds
     its patch from whatever the scrapers returned, which is nothing. */
  const myNotes = patch.myNotes !== undefined ? patch.myNotes : current.myNotes;

  /* Same protection as the notes: what he observed in person is never cleared
     by a patch that simply does not mention it, and enrichment mentions none of
     these. */
  const observed = patch.observed !== undefined
    ? { ...current.observed, ...patch.observed, at: new Date().toISOString() }
    : current.observed;

  all[i] = {
    ...current,
    ...patch,
    id: current.id,
    myNotes,
    observed,
    myNotesUpdatedAt: patch.myNotes !== undefined
      ? new Date().toISOString()
      : current.myNotesUpdatedAt,
  };
  await persist(all);
  return all[i];
}

export async function removeListing(id: string): Promise<boolean> {
  const all = await load();
  const next = all.filter((l) => l.id !== id);
  if (next.length === all.length) return false;
  await persist(next);
  return true;
}
