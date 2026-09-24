/**
 * Is the Roads API reachable on this key, and does it answer sensibly?
 *
 * Enabling the API on the project is not enough — the key carries its own
 * restriction list, and Roads has to be on it. The failure is a 403 with
 * API_KEY_SERVICE_BLOCKED, which reads like an outage and is a checkbox.
 *
 *   npm --prefix backend run check:roads
 */
import 'dotenv/config';
import { resolveOrientation } from '../src/services/orientation.js';

const KEY = process.env.GOOGLE_MAPS_API_KEY ?? '';
const SAMPLES: [string, number, number][] = [
  ['4540 Manning Dr', 34.272474, -84.216468],
  ['4550 Manning Dr', 34.272124, -84.216374],
  ['4530 Manning Dr', 34.272817, -84.216634],
  ['1190 Krobot Way', 34.1252037, -84.264787],
];

const CARD = ['North','North-East','East','South-East','South','South-West','West','North-West'];

async function main() {
  const res = await fetch(
    `https://roads.googleapis.com/v1/nearestRoads?points=34.27,-84.21&key=${KEY}`,
  );
  const probe: any = await res.json();

  if (probe?.error) {
    console.log('\n  Roads API is NOT usable on this key.\n');
    console.log(`    ${probe.error.status}: ${probe.error.message}`);
    console.log('\n  If that says API_KEY_SERVICE_BLOCKED, the API is enabled on the');
    console.log('  project but missing from the KEY\'s own restriction list:');
    console.log('    Cloud Console -> APIs & Services -> Credentials -> your key');
    console.log('    -> API restrictions -> add "Roads API" -> Save.');
    console.log('  It can take a few minutes to take effect.\n');
    process.exit(1);
  }

  console.log('\n  Roads API is reachable. Facing, measured from the road network:\n');
  for (const [name, lat, lng] of SAMPLES) {
    const o = await resolveOrientation(name, { lat, lng }, 'ROOFTOP');
    const how = o.method.includes('road network') ? 'road network'
              : o.method.includes('Street View camera') ? 'street view'
              : o.method.includes('road map') ? 'MAP PICTURE (fallback)'
              : 'none';
    console.log(`    ${name.padEnd(20)} ${String(o.entranceDirection).padEnd(12)} via ${how}`);
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
