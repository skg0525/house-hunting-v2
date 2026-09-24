/**
 * Browse wherever you like; the tool reads Redfin.
 *
 * Zillow is easier to search by hand and effectively impossible to read
 * automatically — it answers 403 to anything without a browser fingerprint, and
 * a session cookie does not fix that. Redfin is the opposite: harder to browse,
 * readable with care.
 *
 * So a Zillow URL is not a dead end. The address is in the path, the address
 * geocodes, and Redfin's map search will return the same property from its
 * coordinates. Paste the Zillow link, get the Redfin record.
 */
import { geocode, metresBetween } from './orientation.js';

import { spend } from './rateBudget.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

/** Strip everything that varies between the two sites' spellings. */
function normalise(street: string): string {
  return street
    .toLowerCase()
    .replace(/\b(north|south|east|west)\b/g, (m) => m[0]!)
    .replace(/\b(street|st|road|rd|drive|dr|lane|ln|court|ct|circle|cir|place|pl|way|trail|trl|parkway|pkwy|boulevard|blvd|terrace|ter|bend|bnd|walk)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export async function findOnRedfin(address: string): Promise<string | null> {
  const g = await geocode(address);
  if (!g) return null;

  /* A tight box: we are looking for one specific house, not a market. */
  const d = 0.004;
  const { lat, lng } = g.coords;
  const pts: [number, number][] = [
    [lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d],
  ];
  const q = new URLSearchParams({
    al: '1', market: 'atlanta', num_homes: '50', ord: 'redfin-recommended-asc',
    page_number: '1', poly: pts.map(([x, y]) => `${x.toFixed(6)} ${y.toFixed(6)}`).join(','),
    sf: '1,2,3,5,6,7', uipt: '1', v: '8',
  });

  spend();
  const res = await fetch(`https://www.redfin.com/stingray/api/gis?${q}`, {
    headers: {
      'User-Agent': UA, Accept: 'application/json', Referer: 'https://www.redfin.com/',
      ...(process.env.REDFIN_COOKIE ? { Cookie: process.env.REDFIN_COOKIE } : {}),
    },
  });
  if (!res.ok) return null;

  const raw = await res.text();
  const i = raw.indexOf('&&');
  if (i === -1) return null;

  let homes: any[] = [];
  try {
    const j = JSON.parse(raw.slice(i + 2));
    homes = j?.payload?.homes ?? [];
  } catch {
    return null;
  }

  const wantStreet = normalise(address.split(',')[0] ?? '');
  const val = (h: any, k: string) => (h?.[k] && typeof h[k] === 'object' ? h[k].value : h?.[k]);

  /* Match on the normalised street line, then fall back to whichever returned
     home is physically closest — within 60 metres, which is one house. */
  let best: { url: string; metres: number } | null = null;
  for (const h of homes) {
    if (!h.url) continue;
    const line = String(val(h, 'streetLine') ?? '');
    const ll = h.latLong?.value ?? h.latLong ?? {};
    const metres = Number.isFinite(ll.latitude)
      ? metresBetween(g.coords, { lat: ll.latitude, lng: ll.longitude })
      : Infinity;

    if (normalise(line) === wantStreet) return `https://www.redfin.com${h.url}`;
    if (!best || metres < best.metres) best = { url: `https://www.redfin.com${h.url}`, metres };
  }

  return best && best.metres <= 60 ? best.url : null;
}

/** Is this a site we can read directly? */
export const isReadable = (url: string) => /redfin\.com/i.test(url);
