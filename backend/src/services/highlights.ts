/**
 * Things worth knowing that shouldn't move the score.
 *
 * Two kinds of fact end up here. The first is where the evidence is real but
 * the preference is not settled — a finished basement is plainly good, but how
 * good is his call, not mine, and baking a guess into the ranking would quietly
 * decide it for him. The second is where two defensible views disagree, like
 * which way a back garden should face, and the honest thing is to show both
 * and let him pick.
 *
 * A number that moves the ranking is a claim. A highlight is information.
 */
import { CardinalDirection, Listing, Orientation } from '../types/listing.js';

export interface Highlight {
  label: string;
  detail: string;
  tone: 'good' | 'neutral' | 'watch';
}

/** The back of a house faces away from its front. */
function opposite(d: CardinalDirection): CardinalDirection | null {
  const order: CardinalDirection[] = [
    'North', 'North-East', 'East', 'South-East',
    'South', 'South-West', 'West', 'North-West',
  ];
  const i = order.indexOf(d);
  return i === -1 ? null : order[(i + 4) % 8]!;
}

export function buildHighlights(l: Listing, o: Orientation): Highlight[] {
  const out: Highlight[] = [];

  /* ------------------------------ basement ------------------------------ */
  if (l.basement === 'finished') {
    out.push({
      label: 'Finished basement',
      tone: 'good',
      detail:
        `${l.basementEvidence ?? ''} This is the room you asked for — space for people to come over, ` +
        `and the obvious place to put your parents for a two-month stay without giving up a ` +
        `main-floor room for the other 700 days of the year.`.trim(),
    });
  } else if (l.basement === 'unfinished' || l.basement === 'partly finished') {
    out.push({
      label: `Basement, ${l.basement}`,
      tone: 'neutral',
      detail:
        `${l.basementEvidence ?? ''} Finishing one runs roughly $40-70 per square foot in this market, ` +
        `so a 1,200 sq ft basement is $50,000-85,000 and several months. Cheaper per square foot ` +
        `than any other way of adding space, and not the party room today.`.trim(),
    });
  } else if (l.basement === 'none') {
    out.push({
      label: 'No basement',
      tone: 'watch',
      detail: 'Slab or crawlspace. Whatever space this house has is the space it will ever have.',
    });
  }

  /* -------------------------- backyard direction -------------------------- */
  const back = o.entranceDirection === 'Unknown' ? null : opposite(o.entranceDirection);
  if (back && o.confidence !== 'none') {
    const sunny = /South/.test(back);
    const vastuFavoured = /North|East/.test(back);

    out.push({
      label: `Back garden faces ${back.toLowerCase()}`,
      tone: 'neutral',
      detail:
        (sunny
          ? 'Afternoon and winter sun in the back garden, which is when a child is actually out in it. ' +
            'Also the hottest corner of the property in a Georgia August.'
          : /North/.test(back)
            ? 'The back stays in shade for much of the day. Cooler in summer, and grass and vegetables ' +
              'both struggle with it.'
            : 'Sun for part of the day, shade for the rest.') +
        ' ' +
        (vastuFavoured
          ? 'Vastu happens to favour this: the tradition wants open space to the north and east, with ' +
            'the building mass to the south and west. So this one has both readings agreeing.'
          : 'Worth knowing that Vastu and the sun disagree here — the tradition prefers open space to ' +
            'the north and east, while the sun argues for a southerly back garden. Neither is settled, ' +
            'and neither moves the score.'),
    });
  }

  /* ------------------------- water and drains ------------------------- */

  if (l.sewer === 'septic') {
    out.push({
      label: 'Septic, not municipal sewer',
      tone: 'watch',
      detail:
        `${l.sewerEvidence ?? ''} Not a dealbreaker — plenty of good houses out here are — but ` +
        `scope the tank before you offer, $300-500. Mature tree roots breach drain fields over a ` +
        `twenty-five year life, and a replacement field is $10,000-25,000.`.trim(),
    });
  } else if (l.sewer === 'public') {
    out.push({
      label: 'Municipal sewer',
      tone: 'good',
      detail: 'On public sewer, so no tank to scope and no drain field to worry about.',
    });
  }

  /* ------------------------------ when ------------------------------ */

  /* The condo's rental window is the binding constraint now: notice could land
     any time in the next one to three months, and from that day there are 90
     days to be out. A house finishing next autumn is a rental in between. */
  if (l.readiness === 'move-in ready') {
    out.push({
      label: 'Move-in ready',
      tone: 'good',
      detail:
        'Available now, so it fits inside the 90 days you would have after the rental ' +
        'notice. Closing on an existing home runs 30-45 days, which leaves room.',
    });
  } else if (l.readiness === 'to be built') {
    out.push({
      label: 'To be built — a year away',
      tone: 'watch',
      detail:
        'This does not fit the rental window. Taking it means renting somewhere in ' +
        'between, which is only worth doing for a house that is exceptional AND in an ' +
        'area with something visibly coming — a new station, a mall, a corridor being ' +
        'rebuilt. Otherwise it costs a move and a year of rent to buy the same house.',
    });
  } else if (l.readiness === 'months') {
    out.push({
      label: l.completionEstimate ? `Completing ${l.completionEstimate}` : 'Under construction',
      tone: 'watch',
      detail:
        'Whether this works depends entirely on the completion date against your ' +
        'notice. Builders slip, so treat their estimate as the earliest rather than ' +
        'the expected — and ask for the date in writing before you commit.',
    });
  }

  /* ------------------------------- cooktop ------------------------------- */
  if (l.cooktopFuel === 'electric') {
    out.push({
      label: 'Electric range',
      tone: 'watch',
      detail:
        `${l.cooktopEvidence ?? ''} Converting is a gas line plus an appliance — a few hundred dollars ` +
        `if there is already gas in the house, a few thousand if there is not.`.trim(),
    });
  } else if (l.cooktopFuel === 'gas') {
    out.push({ label: 'Gas range', tone: 'good', detail: l.cooktopEvidence ?? '' });
  }

  /* ------------------------------ the street ------------------------------ */
  if (l.commute && !l.commute.trafficModelled) {
    out.push({
      label: `${l.commute.miles} miles to work`,
      tone: 'neutral',
      detail:
        `About ${l.commute.legs[0]?.minutes ?? l.commute.worstMinutes} minutes with the road clear. ` +
        `Google returned the same figure at 8am, 1pm and 5pm, which is not credible here, so this is ` +
        `free-flow rather than rush hour. Drive it once at five o'clock and record the real number — ` +
        `distance is the honest guide until then, and ${l.commute.miles} miles is the fact that matters.`,
    });
  }

  return out;
}
