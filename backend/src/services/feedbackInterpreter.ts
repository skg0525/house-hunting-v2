/**
 * Free text in, weight deltas out.
 *
 * "I don't want anything backing onto a main road" has to become an actual
 * change to the yard weight, or the feedback loop is theatre. Gemini does the
 * interpretation; memoryManager does the clamping and persistence.
 */
import { Type, ThinkingLevel } from '@google/genai';
import { DimensionKey, DIMENSION_LABELS } from '../types/preferences.js';
import { callWithFallback } from './geminiEvaluator.js';

/**
 * Every dimension, derived rather than listed.
 *
 * This used to be a hand-written array, and adding the kitchen dimension
 * without updating it meant the model was never offered "kitchen" as a choice.
 * Told plainly that the kitchen was too cramped, it raised the weight on
 * maintenance — the nearest thing on a list that no longer matched reality.
 * Deriving it from the labels makes that failure impossible.
 */
const KEYS = Object.keys(DIMENSION_LABELS) as DimensionKey[];

export interface Interpretation {
  adjustments: { dimension: DimensionKey; delta: number }[];
  note: string;
  degraded: boolean;
}

const SYSTEM = `
You tune one person's house-hunting preferences from their own words.

The dimensions you may adjust:
${KEYS.map((k) => `  ${k} — ${DIMENSION_LABELS[k]}`).join('\n')}

What you are NOT deciding: whether this particular house is out. That is already
recorded separately from your answer. Your only job is what this tells us about
the houses they have not seen yet.

Rules:
- A thumbs DOWN naming a specific flaw RAISES the weight of that dimension. They
  are telling you it matters more than we assumed, not less.
- A thumbs UP naming a specific strength also RAISES that dimension's weight.
- Most feedback moves ONE or TWO dimensions. Leave the rest alone.
- delta between -0.4 and +0.4.
- Vague praise or complaint with no specific cause returns an empty list. Not
  every reaction is a lesson, and inventing one corrupts the ranking.
- Two things are already fixed and are not yours to adjust: no south-facing
  front door, and the backyard must be fenced. If they mention either, just
  acknowledge it in the note and change no weights.
- "note" is one short sentence written back to them in second person, saying
  plainly what changed. e.g. "Backyard size now counts for more than walkability
  in your ranking."
`.trim();

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    adjustments: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          dimension: { type: Type.STRING, enum: KEYS },
          delta: { type: Type.NUMBER },
        },
        required: ['dimension', 'delta'],
      },
    },
    note: { type: Type.STRING },
  },
  required: ['adjustments', 'note'],
};

export async function interpretFeedback(
  action: 'thumbs_up' | 'thumbs_down',
  critique: string,
  listingContext: string,
): Promise<Interpretation> {
  try {
    // The last raw call in the codebase used to live here, so a 503 silently
    // turned the feedback loop into a no-op that echoed the critique back.
    const { text } = await callWithFallback((model) => ({
      model,
      contents: [{
        role: 'user',
        parts: [{
          text: `House under review: ${listingContext}\n` +
                `Reaction: ${action === 'thumbs_up' ? 'THUMBS UP' : 'THUMBS DOWN'}\n` +
                `Their words: "${critique}"`,
        }],
      }],
      config: {
        systemInstruction: SYSTEM,
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        temperature: 0.2,
        maxOutputTokens: 2048,
      },
    }));

    const parsed = JSON.parse(text);
    const adjustments = (parsed.adjustments ?? [])
      .filter((a: any) => KEYS.includes(a.dimension) && typeof a.delta === 'number')
      .map((a: any) => ({
        dimension: a.dimension as DimensionKey,
        delta: Math.max(-0.4, Math.min(0.4, a.delta)),
      }));

    return {
      adjustments,
      note: parsed.note || 'Noted for next time.',
      degraded: false,
    };
  } catch (err) {
    console.warn('[feedback] interpretation failed:', (err as Error).message);
    // Still record the critique verbatim — losing the buyer's words is worse
    // than losing the weight change.
    return { adjustments: [], note: critique.slice(0, 200), degraded: true };
  }
}
