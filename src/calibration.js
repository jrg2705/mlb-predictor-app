// src/calibration.js — Convert Track Record into actionable pick quality rules.

export const MARKET_LABELS = {
  H: "First 5 Innings",
  SI_NO: "1er Inning SI/NO",
  JC: "Juego Completo",
  K: "Ponches",
  Linea: "Total Carreras",
  HCE: "Carreras+Hits+Errores",
  Solo: "Carreras Individuales",
  RL: "Run Line",
};

export const MIN_SAMPLES = 25;
export const MIN_HIT_RATE = 0.54;
export const AVOID_HIT_RATE = 0.48;

const PRIOR_WEIGHT = {
  H: 1.12,
  SI_NO: 1.05,
  JC: 1.08, // subido: el usuario ve mucho acierto en ML del análisis completo
  K: 0.95,
  Linea: 0.92,
  HCE: 0.9,
  Solo: 0.88,
  RL: 0.55,
};

export function marketHitRate(trackRecord, market) {
  const row = trackRecord?.byMarket?.[market];
  if (!row || !row.total) return null;
  return row.correct / row.total;
}

export function marketSamples(trackRecord, market) {
  return trackRecord?.byMarket?.[market]?.total || 0;
}

export function effectiveRate(trackRecord, market) {
  const n = marketSamples(trackRecord, market);
  const emp = marketHitRate(trackRecord, market);
  const prior = 0.5 + (PRIOR_WEIGHT[market] - 1) * 0.15;
  if (emp == null || n === 0) return prior;
  const w = Math.min(1, n / MIN_SAMPLES);
  return w * emp + (1 - w) * prior;
}

export function calibratedScore(market, confidencePct, trackRecord) {
  const conf = (Number(confidencePct) || 0) / 100;
  const rate = effectiveRate(trackRecord, market);
  const priorBoost = PRIOR_WEIGHT[market] || 1;
  return rate * 0.65 + conf * 0.25 + (priorBoost - 1) * 0.1;
}

export function isMarketAvoided(trackRecord, market) {
  const n = marketSamples(trackRecord, market);
  const emp = marketHitRate(trackRecord, market);
  if (n >= MIN_SAMPLES && emp != null && emp < AVOID_HIT_RATE) return true;
  if (market === "RL" && (emp == null || emp < 0.5 || n < MIN_SAMPLES)) return true;
  return false;
}

export function isMarketPreferred(trackRecord, market) {
  const n = marketSamples(trackRecord, market);
  const emp = marketHitRate(trackRecord, market);
  if (n >= MIN_SAMPLES && emp != null && emp >= MIN_HIT_RATE) return true;
  if (market === "H" || market === "SI_NO" || market === "JC") return true;
  return false;
}

export function rankCalibratedMarkets(candidates, trackRecord, { allowAvoided = false } = {}) {
  if (!Array.isArray(candidates)) return [];
  let list = candidates.map((c) => ({
    ...c,
    calibratedScore: calibratedScore(c.market, c.confidence ?? c.confidence_pct, trackRecord),
    avoided: isMarketAvoided(trackRecord, c.market),
    preferred: isMarketPreferred(trackRecord, c.market),
  }));
  if (!allowAvoided) list = list.filter((c) => !c.avoided);
  list.sort((a, b) => b.calibratedScore - a.calibratedScore);
  return list;
}

export function getCalibrationSummary(trackRecord) {
  const markets = Object.keys(MARKET_LABELS);
  const rows = markets
    .map((m) => {
      const n = marketSamples(trackRecord, m);
      const emp = marketHitRate(trackRecord, m);
      return {
        market: m,
        label: MARKET_LABELS[m],
        samples: n,
        hitRate: emp,
        hitPct: emp != null ? Math.round(emp * 100) : null,
        effectivePct: Math.round(effectiveRate(trackRecord, m) * 100),
        avoided: isMarketAvoided(trackRecord, m),
        preferred: isMarketPreferred(trackRecord, m),
      };
    })
    .sort((a, b) => (b.hitRate ?? 0) - (a.hitRate ?? 0));

  const prefer = rows.filter((r) => r.preferred && !r.avoided).map((r) => r.label);
  const avoid = rows.filter((r) => r.avoided).map((r) => r.label);

  const total = trackRecord?.total || 0;
  const correct = trackRecord?.correct || 0;
  const overallPct = total > 0 ? Math.round((correct / total) * 100) : null;

  const bands = trackRecord?.byBand || {};
  let bandNote =
    "La confianza declarada aún no predice bien el acierto: prioriza mercado histórico, no solo el %.";
  const midHigh = bands["65-74"];
  if (midHigh?.total >= 30) {
    const p = Math.round((midHigh.correct / midHigh.total) * 100);
    if (p < 50) {
      bandNote = `Banda 65–74% acierta solo ~${p}% en tu historial: no trates ese % como "fuerte".`;
    }
  }

  const advice = [];
  if (prefer.length) advice.push(`Prioriza: ${prefer.slice(0, 4).join(", ")}.`);
  if (avoid.length) advice.push(`Evita o minimiza: ${avoid.join(", ")}.`);
  advice.push("Card mixto: 1 ML claro (≥58%) + 1 F5/SI_NO + resto; no solo un mercado.");
  advice.push("Rank #2 suele acertar más que #1: prioriza alternativa cuando esté cerca o ≥55%.");
  advice.push(bandNote);

  return {
    overallPct,
    total,
    correct,
    rows,
    preferLabels: prefer,
    avoidLabels: avoid,
    advice,
    forExpert: rows.map((r) => ({
      market: r.market,
      hitPct: r.hitPct,
      samples: r.samples,
      avoid: r.avoided,
      prefer: r.preferred,
    })),
  };
}
