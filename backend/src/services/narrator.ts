/**
 * Pros, concerns, and the one-paragraph verdict.
 *
 * Deliberately NOT a second model call. Every sentence is built either from the
 * dimension scores or from the evidence strings Gemini already produced while
 * looking at the images, so the words can never drift away from the numbers
 * sitting next to them. A scan stays one model call deep.
 */
import { Listing, Perception, Orientation, EvidenceBase, DimensionScore } from '../types/listing.js';
import { PreferenceProfile } from '../types/preferences.js';

export function buildNarrative(
  listing: Listing,
  perception: Perception,
  evidence: EvidenceBase,
  orientation: Orientation,
  dimensions: DimensionScore[],
  matchScore: number,
  ruledOut: string | null,
  profile: PreferenceProfile,
) {
  const scored = dimensions.filter((d) => d.available);
  const byImportance = [...scored].sort((a, b) => b.score * b.weight - a.score * a.weight);

  const pros: string[] = [];
  const cons: string[] = [];

  for (const d of byImportance) {
    const line = `${d.label}: ${d.reason}`;
    if (d.verdict === 'ideal') pros.push(line);
    else if (d.verdict === 'acceptable' && d.weight >= 0.85) pros.push(line);
    else if (d.verdict === 'concern' || d.verdict === 'dealbreaker') cons.push(line);
  }

  // The things a Redfin filter cannot tell you, in the model's own words —
  // and only when there was actually something to read.
  if (evidence.planRead) {
    if (perception.mainFloorBedroom && perception.mainFloorFullBath)
      pros.push(`Read off the plan: ${perception.mainFloorSuiteEvidence}`);
    else
      cons.push(`Read off the plan: ${perception.mainFloorSuiteEvidence}`);
  }

  if (evidence.aerialRead) {
    const good = perception.yardFenced === 'Yes' && perception.yardUsableSize !== 'Cramped';
    (good ? pros : cons).push(`From the aerial: ${perception.yardEvidence}`);
  }

  const street = listing.address.split(',')[0];

  if (ruledOut) {
    return {
      pros: pros.slice(0, 4),
      cons: cons.slice(0, 6),
      summary: `${street} is out. ${ruledOut} Nothing else about the house changes that, which is the point of calling it non-negotiable.`,
    };
  }

  const best = byImportance[0];
  const worst = [...scored].sort((a, b) => a.score - b.score)[0];
  const unknown = dimensions.filter((d) => !d.available);

  const headline =
    matchScore >= 85 ? 'Strong fit. Go see it this week.'
    : matchScore >= 70 ? 'Worth a visit, with one thing to check in person.'
    : matchScore >= 55 ? 'Compromises on something you said mattered.'
    : 'Probably a skip.';

  /* Yard and walkability are the pair that pull against each other, so when they
     disagree sharply, say so out loud instead of letting the average bury it. */
  const yard = scored.find((d) => d.key === 'yard');
  const walk = scored.find((d) => d.key === 'walkability');
  const tension =
    yard && walk && Math.abs(yard.score - walk.score) >= 30
      ? yard.score > walk.score
        ? ' The yard is the good half here and the walkability is the price you pay for it.'
        : ' You could run from this front door, but the backyard is the compromise.'
      : '';

  const gaps = unknown.length
    ? ` Still missing ${unknown.map((d) => d.label.toLowerCase()).join(' and ')}, so this score is provisional.`
    : '';

  const learned = profile.learnedNotes.length
    ? ` Applying ${profile.learnedNotes.length} thing${profile.learnedNotes.length === 1 ? '' : 's'} you have told me before.`
    : '';

  const facing = orientation.confidence === 'none'
    ? 'Facing direction unknown.'
    : `Front faces ${orientation.entranceDirection.toLowerCase()}` +
      (orientation.confidence === 'high' ? '.' : ` (${orientation.confidence} confidence).`);

  const summary =
    `${headline} ${street} scores ${matchScore}/100. ${facing} ` +
    (best && worst
      ? `Best on ${best.label.toLowerCase()} (${best.score}), weakest on ${worst.label.toLowerCase()} (${worst.score}).`
      : '') +
    tension + gaps + learned;

  return { pros: pros.slice(0, 6), cons: cons.slice(0, 6), summary };
}
