/**
 * What to actually offer.
 *
 * Ask price is an opening position. Treating it as a filter threw away houses
 * he would win at his own number — which is the mistake he made on his condo and
 * has said plainly he will not repeat.
 *
 * So instead of "too expensive", this produces three numbers: where to open,
 * where he should expect to land, and the point past which he walks. All of it
 * from evidence printed on the listing page — days on market, whether the price
 * has already been cut, and how the ask compares to Redfin's own estimate.
 *
 * On that estimate: it is an automated valuation, and its published accuracy is
 * roughly a 2-3% median error on listed homes, with a long tail on unusual
 * ones. Useful as an anchor and no more. Where it sits *below* the ask, that is
 * a number the seller's own listing site is publishing against them, and it is
 * worth saying out loud in an offer.
 */
import { Listing } from '../types/listing.js';

export interface Negotiation {
  /** Where to open. */
  openAt: number;
  /**
   * Where this realistically lands — a forecast, not a goal.
   *
   * Naming matters here. Presented as "expect", a number ABOVE the walk-away
   * reads as "settle for this", which is the opposite of what it means. When
   * `reachable` is false this number is the reason to walk, not the target.
   */
  expect: number;
  /** The most he would actually pay. Past this, walk. */
  walkAway: number;
  /** What the house looks worth, independent of what they are asking. */
  anchor?: number;
  /** The arguments, in the order to make them. */
  arguments: string[];
  /** Whether the evidence suggests this can land inside his ceiling at all. */
  reachable: boolean;
  /** 0-1: how much room the evidence suggests, before his own ceiling. */
  leverage: number;
  signals: string[];
  strategy: string;
}

export function assessNegotiation(
  l: Listing, ceiling: number, usualRoom: number,
  /** The Vastu reading, only for what it says about the pool of other buyers. */
  vastu?: { readings: { element: string; actual: string; verdict: string }[] },
): Negotiation | null {
  if (!l.price || l.price <= 0) return null;

  const signals: string[] = [];
  /* Baseline: what a normal, unremarkable listing gives up. Everything below
     adds to it on evidence, so the starting point is deliberately modest. */
  let room = 0.03;

  const dom = l.daysOnMarket;
  if (dom !== undefined) {
    if (dom >= 90) { room += 0.07; signals.push(`${dom} days on market — long past the point where a seller stops expecting their number`); }
    else if (dom >= 60) { room += 0.05; signals.push(`${dom} days on market — the seller is carrying this and knows it`); }
    else if (dom >= 30) { room += 0.03; signals.push(`${dom} days on market — past the first burst of interest`); }
    else signals.push(`Only ${dom} days on market — still fresh, expect them to hold firm`);
  }

  const history = l.priceHistory;

  /* Repeated cuts are a stronger signal than one big one: a seller who has cut
     twice has twice failed to find a buyer at their own number. */
  if (history && history.cutCount >= 2) {
    room += 0.03;
    signals.push(
      `${history.cutCount} separate price cuts. Each one is a month they did not sell, and ` +
      `a seller who has cut twice has twice been told their number is wrong.`,
    );
  }
  if (history?.daysSinceFirstListed && history.daysSinceFirstListed > 150) {
    room += 0.02;
    signals.push(
      `On and off the market for ${Math.round(history.daysSinceFirstListed / 30)} months in total, ` +
      `not just the ${dom ?? '?'} days this listing shows.`,
    );
  }

  if (l.originalPrice && l.originalPrice > l.price) {
    const cutPct = ((l.originalPrice - l.price) / l.originalPrice) * 100;

    /* A big cut cuts both ways and it is dishonest to report only the half that
       flatters the buyer. It proves the seller will move — they already have.
       It also means the current number is closer to what the house is actually
       worth, so there is less left underneath it. Scaled, and both halves said
       out loud. */
    room += cutPct >= 10 ? 0.05 : cutPct >= 5 ? 0.035 : 0.02;
    signals.push(
      `Already cut ${cutPct.toFixed(1)}% from $${l.originalPrice.toLocaleString()} to ` +
      `$${l.price.toLocaleString()}. That is proof they will move — they have moved once ` +
      `already, and sellers who cut once rarely stop at one.`,
    );
    if (cutPct >= 10) {
      signals.push(
        `But a cut that size also means today's price is closer to what the house is ` +
        `really worth than the original ask was. Do not expect the same discount twice ` +
        `off the new number.`,
      );
    }
  }

  if (l.redfinEstimate) {
    const gap = ((l.price - l.redfinEstimate) / l.redfinEstimate) * 100;
    if (gap > 4) {
      room += 0.03;
      signals.push(
        `Asking ${gap.toFixed(1)}% above Redfin's own $${l.redfinEstimate.toLocaleString()} estimate — ` +
        `their site publishing a number against them is worth quoting in the offer`,
      );
    } else if (gap < -4) {
      room -= 0.02;
      signals.push(`Priced ${Math.abs(gap).toFixed(1)}% below Redfin's estimate — sharp, expect competition`);
    } else {
      signals.push(`Within a few percent of Redfin's estimate — priced about right`);
    }
  }

  /* New construction behaves differently and it is worth being explicit,
     because reading a builder's "no" on price as a no overall leaves real money
     on the table. */
  const newBuild = l.yearBuilt >= new Date().getFullYear();
  if (newBuild) {
    signals.push(
      'New construction. Builders resist cutting price because every discount resets ' +
      'the comps for the homes they have left to sell. They will give the same money ' +
      'as closing costs, a rate buydown, or free options instead — ask for that, not a lower number.',
    );
  }

  room = Math.max(0.02, Math.min(0.18, room));

  /* ---------------------------------------------------------------------
   * Price off VALUE, not off ask.
   *
   * The first version of this computed every figure as a percentage off the
   * asking price, which is circular — raise the ask and every number rises with
   * it, which is exactly the trap a seller sets. It produced "open at $688,875,
   * walk away at $825,617" on a house asking $825,000: a walk-away above the ask
   * is not a number, it is a bug wearing a dollar sign.
   *
   * So an independent valuation is the anchor when one exists, and the leverage
   * only says how far BELOW that valuation the evidence supports pushing. Half
   * the leverage, because leverage tells you a seller will move, not that they
   * will move all the way.
   * --------------------------------------------------------------------- */
  /* Two independent valuations beat one. Where both exist, the midpoint is the
     anchor and their agreement (or disagreement) is itself an argument. */
  const estimates = [l.redfinEstimate, l.zestimate].filter((v): v is number => Boolean(v && v > 0));
  const anchor = estimates.length
    ? Math.round(estimates.reduce((a, b) => a + b, 0) / estimates.length)
    : l.price;

  const expect = Math.min(
    Math.round(anchor * (1 - room * 0.5)),
    Math.round(l.price * (1 - 0.02)),   // never above a token cut off ask
  );

  /* Open below where you expect to land, with room to be negotiated up to it —
     but not so low it reads as unserious and ends the conversation. Six percent
     is a gap a seller answers; twenty is one they ignore. */
  const openAt = Math.round(expect * 0.94);

  /* The most worth paying: the valuation itself when the evidence says they
     must move, a touch over it when it does not. Never above the ask, because
     nobody bids over on a house that has sat for months. */
  const walkAway = Math.min(
    ceiling,
    Math.round(anchor * (room >= 0.08 ? 1.0 : 1.02)),
    l.price,
  );
  const reachable = expect <= ceiling;

  /* Builders behave differently, but "builders do not cut price" is too strong
     when this one demonstrably has. The precise claim: a builder will cut the
     asking price of a house that is not selling, and then resists cutting
     further for one buyer, because a recorded low sale price becomes the comp
     every remaining house in the community is appraised against. Concessions do
     not show up in that comp. So the last stretch comes as incentives. */
  const alreadyCut = Boolean(l.originalPrice && l.originalPrice > l.price);

  const strategy = newBuild
    ? (alreadyCut
        ? `They have already cut the list price once, so the number moves — but the last ` +
          `stretch to your figure will come as incentives, not another price cut. A recorded ` +
          `low sale becomes the comp for every house they have left in the community; ` +
          `closing costs and a rate buydown do not. Open at $${openAt.toLocaleString()} on ` +
          `price, then ask for the rest in concessions with a dollar figure attached.`
        : `Open at $${openAt.toLocaleString()}, and expect movement as incentives rather than ` +
          `price. A recorded low sale becomes the comp for every house they have left, so ` +
          `they will pay in closing costs and rate buydowns instead. Ask for those by name ` +
          `with a dollar figure.`)
    : expect <= ceiling
      ? `Open at $${openAt.toLocaleString()} and expect to land near $${expect.toLocaleString()}, which is inside your $${ceiling.toLocaleString()} ceiling.`
      : `Open at $${openAt.toLocaleString()}. The evidence supports about ${(room * 100).toFixed(0)}% off, which lands near ` +
        `$${expect.toLocaleString()} — still $${(expect - ceiling).toLocaleString()} above your ceiling. ` +
        `So this only works if the seller is unusually motivated. Your walk-away is ` +
        `$${ceiling.toLocaleString()}, and it is worth deciding that now rather than at the table.`;

  /* The case to make, in the order to make it. Numbers he can say out loud
     rather than a score he has to defend. */
  const args: string[] = [];
  if (estimates.length === 2) {
    const [a, b] = estimates as [number, number];
    const spread = Math.abs(a - b) / anchor;
    args.push(
      spread <= 0.04
        ? `Redfin says $${a.toLocaleString()} and Zillow says $${b.toLocaleString()} — two ` +
          `independent models within ${(spread * 100).toFixed(1)}% of each other. That agreement is ` +
          `hard to argue with, and it sits $${(l.price - anchor).toLocaleString()} below the ask.`
        : `Redfin says $${a.toLocaleString()} and Zillow says $${b.toLocaleString()} — they disagree ` +
          `by ${(spread * 100).toFixed(0)}%, which usually means something unusual about the house. ` +
          `Worth understanding what before you bid.`,
    );
  }

  if (l.redfinEstimate && l.redfinEstimate < l.price && estimates.length < 2)
    args.push(
      `Their own site values it at $${l.redfinEstimate.toLocaleString()} — ` +
      `$${(l.price - l.redfinEstimate).toLocaleString()} ` +
      `below what they are asking. That is Redfin's number about a Redfin listing, not mine.`,
    );
  if (dom !== undefined && dom >= 45)
    args.push(
      `${dom} days on the market. Comparable homes here move in half that. Every further month ` +
      `costs them mortgage, taxes and insurance on a house they have already left.`,
    );
  if (l.originalPrice && l.originalPrice > l.price)
    args.push(
      `They have already come down from $${l.originalPrice.toLocaleString()}. The first price ` +
      `was wrong and they know it — the question is only how much further.`,
    );
  if (newBuild)
    args.push(
      `Ask for concessions rather than price: closing costs, a rate buydown, options thrown in. ` +
      `A low recorded sale price damages every house they have left to sell; a concession does not. ` +
      `Same money to you, much cheaper for them to say yes to.`,
    );
  args.push(
    `Be ready to walk at $${walkAway.toLocaleString()}` +
    (l.redfinEstimate
      ? ` — its assessed value. Past that you are paying for their move, not the house.`
      : '.'),
  );

  /* Vastu as leverage, which is the practical use of it here.
   *
   * North Fulton and Forsyth have a real South Asian buyer pool — some tracts
   * on this list are sixteen to twenty-four percent. A meaningful share of
   * those buyers will not make an offer on a house with the placements the
   * tradition warns about, and plenty of agents out here know it. That is not
   * a belief about the house; it is an observable fact about its demand curve,
   * and a smaller pool of buyers is worth money at the table.
   *
   * It cuts both ways and the note says so. The same defect he is discounting
   * for will be there when he sells.
   */
  const sa = l.neighborhood?.southAsianPct;
  const defects = (vastu?.readings ?? []).filter(
    (r) => r.verdict === 'unfavourable' && r.actual !== 'Unknown',
  );
  if (defects.length && (sa ?? 0) >= 6) {
    args.push(
      `${defects.map((d) => `${d.element.toLowerCase()} in the ${d.actual.toLowerCase()}`).join(', ')} — ` +
      `placements the tradition warns about, in a tract that is ${sa!.toFixed(0)}% South Asian. ` +
      `A slice of the buyers for this street will not bid on it at all, and the listing agent ` +
      `has probably already watched that happen. Worth naming, gently, as a reason the house ` +
      `is still available. Be honest with yourself about the other side of it: the same thing ` +
      `will be true on the day you sell.`,
    );
  }

  return { openAt, expect, walkAway, anchor, reachable, arguments: args, leverage: room, signals, strategy };
}
