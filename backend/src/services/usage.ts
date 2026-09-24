/**
 * How many model calls we have actually made, and what they cost.
 *
 * Written because the question "is this thing even calling Gemini?" could not
 * be answered from inside the app, and AI Studio's dashboard shows free-tier
 * usage only — a paid key can be working hard and still read zero there.
 *
 * Counted locally, on disk, so the answer does not depend on a dashboard.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { STORE_DIR } from '../paths.js';

const FILE = join(STORE_DIR, 'usage.json');

export interface CallRecord {
  at: string;
  purpose: string;
  model: string;
  ms: number;
  images: number;
  promptTokens?: number;
  outputTokens?: number;
  ok: boolean;
}

let buffer: CallRecord[] | null = null;

async function load(): Promise<CallRecord[]> {
  if (buffer) return buffer;
  try {
    buffer = JSON.parse(await readFile(FILE, 'utf8'));
  } catch {
    buffer = [];
  }
  return buffer!;
}

export async function record(r: CallRecord): Promise<void> {
  const all = await load();
  all.push(r);
  /* Keep the last few thousand. This is a running tally, not an audit log. */
  if (all.length > 4000) all.splice(0, all.length - 4000);
  try {
    await mkdir(dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(all));
  } catch { /* never fail a scan over bookkeeping */ }
}

export async function summary() {
  const all = await load();
  const since = (h: number) => Date.now() - h * 3_600_000;
  const window = (h: number) => all.filter((r) => Date.parse(r.at) >= since(h));

  const tally = (rs: CallRecord[]) => {
    const inTok = rs.reduce((s, r) => s + (r.promptTokens ?? 0), 0);
    const outTok = rs.reduce((s, r) => s + (r.outputTokens ?? 0), 0);
    const byPurpose: Record<string, number> = {};
    for (const r of rs) byPurpose[r.purpose] = (byPurpose[r.purpose] ?? 0) + 1;
    return { calls: rs.length, failed: rs.filter((r) => !r.ok).length, inTok, outTok, byPurpose };
  };

  return {
    total: tally(all),
    last24h: tally(window(24)),
    lastHour: tally(window(1)),
    firstCall: all[0]?.at,
    lastCall: all[all.length - 1]?.at,
  };
}
