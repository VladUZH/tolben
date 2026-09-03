// Which sentence gets the model's single slot next. Lower runs first.
//
// Two keys, visibility first: on screen, then below the screen (readers scroll down),
// then above — the margins are prefetch, not peers. Within each position, sentences the
// clarity gate fires on come before sentences it clears, so the likely suggestions land
// first and the unlikely ones are checked last rather than never. Skipping them outright
// silenced the model's entire grammar band — agreement, articles, question forms carry
// none of the gate's clarity constructions, and on a real page that was six of the
// eight suggestions.
//
// Reading order breaks ties inside every band. The arithmetic assumes documents shorter
// than GATED_DEMOTION characters (500M), which markdown notes comfortably are.

import { checkGate } from "../src/gate.mjs";

const POSITION_TIER = 1_000_000_000;
const GATED_DEMOTION = POSITION_TIER / 2;

export function sentenceRank(sentence, visible, gateAware) {
  const demotion = gateAware && checkGate(sentence.text) === null ? GATED_DEMOTION : 0;
  if (sentence.start < visible.to && sentence.end > visible.from) {
    return demotion + sentence.start;
  }
  if (sentence.start >= visible.to) {
    return POSITION_TIER + demotion + (sentence.start - visible.to);
  }
  return 2 * POSITION_TIER + demotion + (visible.from - sentence.end);
}
