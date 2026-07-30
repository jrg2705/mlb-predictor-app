// src/strongPicks.js — Confidence threshold for "picks fuertes"
// Goal: prefer fewer, higher-confidence picks over volume.

export const DEFAULT_MIN_CONFIDENCE = 68;

export const CONFIDENCE_OPTIONS = [
  { value: 55, label: "55%+ (más volumen)" },
  { value: 60, label: "60%+" },
  { value: 65, label: "65%+" },
  { value: 68, label: "68%+ (recomendado)" },
  { value: 70, label: "70%+" },
  { value: 75, label: "75%+ (solo élite)" },
];

/** Keep only markets at or above the threshold. */
export function filterStrongMarkets(markets, minConfidence = DEFAULT_MIN_CONFIDENCE) {
  if (!Array.isArray(markets)) return [];
  return markets.filter((m) => {
    const pct = m.confidence ?? m.confidence_pct ?? 0;
    return pct >= minConfidence;
  });
}

/** True when a single confidence % qualifies as strong. */
export function isStrongPick(pct, minConfidence = DEFAULT_MIN_CONFIDENCE) {
  return pct != null && Number(pct) >= minConfidence;
}

/** Count how many markets across today's analyses meet the threshold. */
export function countStrongAcrossGames(entries, buildAllMarkets, minConfidence) {
  if (!Array.isArray(entries)) return 0;
  let n = 0;
  for (const entry of entries) {
    const markets = buildAllMarkets(entry) || [];
    n += markets.filter((m) => (m.confidence ?? 0) >= minConfidence).length;
  }
  return n;
}
