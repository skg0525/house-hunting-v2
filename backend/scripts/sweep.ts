/**
 * The same work the Scan button does, from a terminal.
 *
 * This used to be a parallel implementation, which is how the two drifted: the
 * script checked open houses and re-parsed cached pages, and the button did
 * neither. Everything now lives behind the endpoints, and this only drives
 * them and prints progress — so there is one code path and one behaviour.
 */
import 'dotenv/config';

const API = `http://localhost:${process.env.PORT ?? 8787}`;
const j = async (p: string, i?: RequestInit) => (await fetch(`${API}${p}`, i)).json() as Promise<any>;

const res = await fetch(`${API}/api/scan${process.argv.includes('--force') ? '?force=true' : ''}`);
const reader = res.body!.getReader();
const dec = new TextDecoder();
let buf = '';
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  const parts = buf.split('\n\n');
  buf = parts.pop() ?? '';
  for (const p of parts) {
    const m = p.match(/"done":(\d+),"total":(\d+)/);
    if (m && Number(m[1]) % 10 === 0) console.log(`  ${m[1]}/${m[2]}`);
  }
}

const all: any[] = await j('/api/listings');
const health = await j('/api/health');
console.log(`\n  ${all.length} listings`);
console.log(`    photos       ${all.filter((l) => l.images?.exterior).length}`);
console.log(`    plans        ${all.filter((l) => l.images?.floorPlan).length}`);
console.log(`    open houses  ${all.filter((l) => l.openHouses?.length).length}`);
console.log(`    budget       ${health.listingRequests?.usedToday}/${health.listingRequests?.limits?.perDay} today\n`);
