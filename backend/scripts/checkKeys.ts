/**
 * Which keys actually work, tested against the real APIs.
 *
 * The Google Cloud console is genuinely confusing about this. Enabling an API
 * and having a key are separate steps, a key belongs to exactly one project,
 * and the console's project picker does not always switch when you think it
 * did — so a page can show "Enabled" for a project your key does not live in.
 *
 * Rather than reason about any of that, this asks each API directly and reports
 * what came back. Run it whenever something looks off.
 */
import 'dotenv/config';

const GEMINI = process.env.GEMINI_API_KEY ?? '';
const MAPS = process.env.GOOGLE_MAPS_API_KEY ?? '';
const CENSUS = process.env.CENSUS_API_KEY ?? '';
const WALK = process.env.WALKSCORE_API_KEY ?? '';

const ok = (m: string) => console.log(`  \x1b[32mOK\x1b[0m    ${m}`);
const bad = (m: string) => console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`);
const skip = (m: string) => console.log(`  \x1b[90m--\x1b[0m    ${m}`);

/** A real Atlanta address, so a positive result means it genuinely worked. */
const ADDR = '1234 Peachtree St NE, Atlanta, GA 30309';

async function main() {
  console.log('\nGEMINI  — reads the floor plans and aerials');
  if (!GEMINI) bad('GEMINI_API_KEY is empty in backend/.env');
  else {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${GEMINI}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'say ok' }] }] }) },
    );
    const j: any = await r.json();
    if (j.error) bad(`${j.error.status}: ${String(j.error.message).slice(0, 120)}`);
    else ok('the key works and the model answered');
  }

  console.log('\nGOOGLE MAPS — the south-facing rule depends on all three of these');
  if (!MAPS) {
    bad('GOOGLE_MAPS_API_KEY is empty in backend/.env');
    console.log('        Enabling the APIs is not enough. Create a key:');
    console.log('        Cloud console -> APIs & Services -> Credentials -> Create credentials -> API key');
  } else {
    // 1. Geocoding — turns an address into coordinates.
    const g: any = await (await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(ADDR)}&key=${MAPS}`,
    )).json();
    if (g.status === 'OK') ok(`Geocoding API — placed the test address (${g.results[0].geometry.location_type})`);
    else bad(`Geocoding API — ${g.status}: ${String(g.error_message ?? '').slice(0, 140)}`);

    const at = g.status === 'OK' ? g.results[0].geometry.location : { lat: 33.7845, lng: -84.3832 };

    // 2. Street View metadata — this is the actual measurement, and Google
    //    bills metadata requests at zero.
    const sv: any = await (await fetch(
      `https://maps.googleapis.com/maps/api/streetview/metadata?location=${at.lat},${at.lng}&radius=50&key=${MAPS}`,
    )).json();
    if (sv.status === 'OK') ok('Street View Static API — found a panorama (this is the bearing measurement)');
    else if (sv.status === 'ZERO_RESULTS') ok('Street View Static API — reachable, no pano at the test point');
    else bad(`Street View Static API — ${sv.status}: ${String(sv.error_message ?? '').slice(0, 140)}`);

    // 3. Places (New) — what is within a stroller walk.
    const pl = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': MAPS,
                 'X-Goog-FieldMask': 'places.displayName' },
      body: JSON.stringify({ includedTypes: ['park'], maxResultCount: 1,
        locationRestriction: { circle: { center: { latitude: at.lat, longitude: at.lng }, radius: 1500 } } }),
    });
    const plj: any = await pl.json();
    if (plj.error) bad(`Places API (New) — ${String(plj.error.message).slice(0, 130)}`);
    else ok('Places API (New) — parks and errands within walking distance');

    // 4. Routes — the commute, measured in traffic.
    const rt = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': MAPS,
                 'X-Goog-FieldMask': 'routes.duration' },
      body: JSON.stringify({ origin: { address: ADDR }, destination: { address: process.env.WORK_ADDRESS ?? 'Alpharetta, GA' },
        travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE' }),
    });
    const rtj: any = await rt.json();
    if (rtj.error) bad(`Routes API — ${String(rtj.error.message).slice(0, 130)}`);
    else ok('Routes API — traffic-aware commute');

    // 5. Static Maps — the satellite tile the yard is read from. Returns an
    //    image on success, so check the content type rather than JSON.
    const sm = await fetch(
      `https://maps.googleapis.com/maps/api/staticmap?center=${at.lat},${at.lng}&zoom=19&size=200x200&maptype=satellite&key=${MAPS}`,
    );
    const ct = sm.headers.get('content-type') ?? '';
    if (ct.startsWith('image/')) ok('Maps Static API — returned a satellite image');
    else bad(`Maps Static API — ${(await sm.text()).slice(0, 140)}`);
  }

  console.log('\nCENSUS — neighbourhood mix');
  if (!CENSUS) skip('CENSUS_API_KEY empty — the mix dimension stays blank');
  else {
    const c = await fetch(
      `https://api.census.gov/data/2023/acs/acs5?get=B03002_001E&for=tract:011656&in=state:13%20county:121&key=${CENSUS}`,
    );
    const t = await c.text();
    if (c.ok && t.trim().startsWith('[')) ok('the key works');
    else bad(t.slice(0, 140));
  }

  /* Whether the listing sites are currently answering us, and whether a
     signed-in cookie is in play. Both are worth knowing before a scan. */
  console.log('\nLISTING SITES — can we still read pages?');
  try {
    const { fetchListingPage } = await import('../src/services/listingPage.js');
    await fetchListingPage('https://www.redfin.com/GA/Johns-Creek/300-Crown-Vetch-Ln-30005/home/24737023');
    /* An empty env var is not a cookie. Reporting "using your signed-in cookie"
       when the slot is blank is the same class of lie as every other one this
       codebase has had to remove. */
    const cookie = (process.env.REDFIN_COOKIE ?? '').trim();
    ok('Redfin is answering' + (cookie.length > 20 ? ' (with your signed-in cookie)' : ' (anonymous — no cookie needed)'));
  } catch (err) {
    const m = (err as Error).message;
    if (/rate-limiting/i.test(m)) {
      bad('Redfin is rate-limiting us right now.');
      console.log('        Wait an hour, or paste your browser cookie into REDFIN_COOKIE in backend/.env.');
      console.log('        Cached pages are still readable, so a scan will use those.');
    } else bad(`Redfin — ${m.slice(0, 120)}`);
  }

  console.log('\nWALK SCORE — optional');
  if (!WALK) skip('WALKSCORE_API_KEY empty — type the number off the Redfin page instead');
  else {
    const w: any = await (await fetch(
      `https://api.walkscore.com/score?format=json&address=${encodeURIComponent(ADDR)}&lat=33.7845&lon=-84.3832&wsapikey=${WALK}`,
    )).json();
    if (w.status === 1) ok(`the key works (test address scored ${w.walkscore})`);
    else bad(`status ${w.status} — ${w.description ?? 'see walkscore.com/professional/api'}`);
  }
  console.log();
}

main();
