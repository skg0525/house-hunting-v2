/**
 * Find the floor plan in a listing's photo gallery.
 *
 * Redfin's floor plans are not labelled. They are numbered photos sitting in
 * the gallery alongside the kitchen and the back deck, with nothing in the URL,
 * the alt text or the page data to say which is which — I went looking. The
 * only way to tell a floor plan from a photograph of a room is to look at it.
 *
 * Which is fine, because looking at images is the one thing this app already
 * does. One cheap vision call over the gallery identifies them.
 *
 * This does fetch the listing page. It reads one page he already has open in
 * another tab, at his own request, for his own house search. It is not a
 * crawler and nothing is republished.
 */
import { Type, ThinkingLevel } from '@google/genai';
import { callWithFallback } from './geminiEvaluator.js';

import { fetchListingPage, RateLimited } from './listingPage.js';


/**
 * Pull the gallery image URLs for this listing only.
 *
 * A Redfin page also embeds photos of nearby homes and open houses, so the
 * listing's own MLS id has to be part of the match or you end up reading
 * someone else's kitchen.
 */
export function galleryUrls(html: string): string[] {
  /* The MLS number identifies the subject's photos and separates them from the
     nearby-homes cards. New construction often has no MLS number at all — two
     listings came back "no gallery images" from pages carrying 34 and 46 of
     them — so fall back to whichever photo id appears most often, which is the
     subject's, since its gallery is the only one shown in full. */
  /* Photo ids are not always numeric.
   *
   * Resale listings key on the MLS number. New construction keys on a
   * hexadecimal id — 3AD25D428323 — and two houses reported "no gallery
   * images" from pages carrying 34 and 46 of them, because the pattern only
   * matched digits. */
  const ID = '[0-9A-Fa-f]{6,}';

  let key = html.match(/MLS#\s*(\d{6,})/)?.[1]
    ?? html.match(new RegExp(`ssl\\.cdn-redfin\\.com/photo/\\d+/bigphoto/\\w+/(${ID})_`))?.[1];

  if (!key) {
    /* No MLS number: take whichever photo id dominates the page. The subject's
       gallery is the only one shown in full, so it wins by a wide margin. */
    const counts = new Map<string, number>();
    const finder = new RegExp(`ssl\\.cdn-redfin\\.com/photo/\\d+/\\w+/\\w+/(?:gen\\w+\\.)?(${ID})_`, 'g');
    for (const m of html.matchAll(finder)) {
      counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    /* Only trust a clear winner — a page where every id appears twice is a list
       of other people's houses, not a gallery. */
    if (best && best[1] >= 4) key = best[0];
  }

  if (!key) return [];

  const re = new RegExp(
    `https://ssl\\.cdn-redfin\\.com/photo/[^"'\\\\ )]*?${key}[^"'\\\\ )]*?\\.jpg`,
    'g',
  );
  const all = [...new Set(html.match(re) ?? [])];

  /* Several sizes of the same photo are embedded. Keep one per photo index and
     prefer `bigphoto` — a floor plan's printed room dimensions are the whole
     point and they are unreadable at thumbnail size. */
  /* The photo index is the first number after the id; the trailing segment is
     a size or variant code and can be a letter — "_1_B.jpg" is photo one. */
  const best = new Map<number, string>();
  for (const url of all) {
    const idx = Number(url.match(/_(\d+)_[0-9A-Za-z]+\.jpg$/)?.[1] ?? -1);
    if (idx < 0) continue;
    const current = best.get(idx);
    if (!current || (!/bigphoto/.test(current) && /bigphoto/.test(url))) best.set(idx, url);
  }
  return [...best.entries()].sort((a, b) => a[0] - b[0]).map(([, u]) => u);
}

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    floorPlanIndexes: { type: Type.ARRAY, items: { type: Type.NUMBER } },
    kitchenIndexes: { type: Type.ARRAY, items: { type: Type.NUMBER } },
    note: { type: Type.STRING },
  },
  required: ['floorPlanIndexes', 'kitchenIndexes', 'note'],
};

const PROMPT = `
You are shown numbered images from one house listing. Each is preceded by a line
saying "IMAGE n".

Report the numbers of the images that are ARCHITECTURAL FLOOR PLANS: overhead
line drawings of a storey showing walls, doorways and labelled rooms. They are
usually black and white and often carry printed room dimensions.

A floor plan is NOT a photograph of a room, an exterior shot, an aerial or
satellite photo, a plat or lot survey, a neighbourhood map, or a 3D rendering.

A listing usually has one plan per storey. Return every one you find, in the
order shown. Return an empty list if there are none — that is a normal answer
and much better than nominating a photograph.

Separately, report in kitchenIndexes the numbers of up to THREE photographs of
the KITCHEN — real photographs, not plans. Prefer wide shots that show the whole
room and how it connects to the space beside it, over close-ups of a tap. Empty
list if the kitchen is not photographed.
`.trim();

async function grab(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
        Referer: 'https://www.redfin.com/',
      },
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
    if (!type.startsWith('image/')) return null;
    return { data: Buffer.from(await res.arrayBuffer()).toString('base64'), mimeType: type };
  } catch {
    return null;
  }
}

export interface FoundPlans {
  urls: string[];
  kitchenUrls: string[];
  /** Photo one, which on a listing is nearly always the front of the house. */
  exteriorUrl?: string;
  /** A few more, for the detail page. */
  gallery: string[];
  note: string;
  scanned: number;
  outcome: 'found' | 'none-in-listing' | 'blocked' | 'error';
}

export async function findFloorPlans(listingUrl: string): Promise<FoundPlans> {
  let html: string;
  try {
    html = await fetchListingPage(listingUrl);
  } catch (err) {
    return {
      urls: [], kitchenUrls: [], gallery: [], scanned: 0,
      outcome: err instanceof RateLimited ? 'blocked' : 'error',
      note: (err as Error).message,
    };
  }

  const urls = galleryUrls(html);
  if (!urls.length)
    return {
      urls: [], kitchenUrls: [], gallery: [], scanned: 0, outcome: 'error',
      note: 'The page loaded but no gallery images could be found in it.',
    };

  /* Both ends, because the two things wanted live at opposite ends of a
     gallery: kitchens are photographed early, floor plans are appended last.
     Taking the front alone found three kitchen photos and zero plans on a
     listing that has two. */
  const HEAD = 12, TAIL = 12;
  const candidates = urls.length <= HEAD + TAIL
    ? urls
    : [...urls.slice(0, HEAD), ...urls.slice(-TAIL)];
  const images = await Promise.all(candidates.map(grab));

  const parts: any[] = [];
  const indexOf = new Map<number, string>();
  let n = 0;
  for (let i = 0; i < candidates.length; i++) {
    const img = images[i];
    if (!img) continue;
    n += 1;
    indexOf.set(n, candidates[i]!);
    parts.push({ text: `IMAGE ${n}` }, { inlineData: img });
  }
  if (!parts.length)
    return {
      urls: [], kitchenUrls: [], gallery: [], scanned: 0, outcome: 'error',
      note: 'None of the gallery images could be downloaded.',
    };

  try {
    const { text } = await callWithFallback((model) => ({
      model,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: PROMPT,
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        temperature: 0,
        maxOutputTokens: 2048,
      },
    }), { timeoutMs: 90_000, purpose: 'find floor plan in gallery', images: n });

    const parsed = JSON.parse(text);
    const pick = (list: unknown) => ((list ?? []) as number[])
      .map((i) => indexOf.get(Number(i)))
      .filter(Boolean) as string[];

    const found = pick(parsed.floorPlanIndexes);
    return {
      urls: found,
      exteriorUrl: urls[0],
      gallery: urls.slice(0, 6),
      kitchenUrls: pick(parsed.kitchenIndexes).slice(0, 3),
      note: parsed.note ?? '',
      scanned: n,
      /* The gallery was read in full and contains no plan. That is a finding,
         and it means stop waiting and go and save one by hand. */
      outcome: found.length ? 'found' : 'none-in-listing',
    };
  } catch (err) {
    /* The classifier failed. The photographs did not.
     *
     * `gallery` and `exteriorUrl` come straight out of the HTML — `galleryUrls`
     * parsed them a few lines above and needs no model at all. Returning them
     * empty here threw away work that had already succeeded, and because
     * `enrichListing` only writes images when `gallery.length` is non-zero,
     * thirteen houses were added with full facts, rooftop coordinates and not
     * one picture. The gallery parsed fine on every one of them: 29 to 61 URLs
     * each.
     *
     * So: hand back what was actually read. Only the plan classification is
     * lost, and the outcome says so, so a later `refresh-all` knows to try
     * again. */
    return {
      urls: [],
      kitchenUrls: [],
      exteriorUrl: urls[0],
      gallery: urls.slice(0, 6),
      scanned: n,
      outcome: 'error',
      note: `Photos read, but the gallery could not be classified: ${(err as Error).message}`,
    };
  }
}
