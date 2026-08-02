// src/pickSelection.js — Top Picks selection: A (prefer alt cerca) + B (forzar ML claro) + F (card mixto)
// Usado por App.jsx

export const ML_CLEAR_PCT = 58;
export const ALT_CLOSE_PTS = 5;
export const MAX_PER_MARKET = 2;
export const MAX_F5 = 1;
export const MAX_SI_NO = 1;

export function buildAllMarketsForEntry(entry, trackRecord, minConfidence, rankCalibratedMarkets) {
  const a = entry.analysis;
  if (!a) return [];
  const { home, away } = entry;
  const candidates = [];

  if (a.home_win_pct != null && a.away_win_pct != null) {
    const homeFav = a.home_win_pct >= a.away_win_pct;
    const pct = Math.max(a.home_win_pct, a.away_win_pct);
    const name = homeFav ? home : away;
    candidates.push({
      market: "JC",
      confidence: pct,
      pickSummary: `${name} gana el partido (ML ${pct}%)`,
      isClearML: pct >= ML_CLEAR_PCT,
    });
  }

  if (a.first_inning?.confidence_pct != null) {
    candidates.push({
      market: "SI_NO",
      confidence: a.first_inning.confidence_pct,
      pickSummary: `${a.first_inning.scores === "SI" ? "Anotan" : "NO anotan"} en el 1er inning`,
    });
  }
  if (a.total_runs?.confidence_pct != null) {
    candidates.push({
      market: "Linea",
      confidence: a.total_runs.confidence_pct,
      pickSummary: `${a.total_runs.pick} ${a.total_runs.line} carreras totales`,
    });
  }
  if (a.home_team_runs?.confidence_pct != null) {
    candidates.push({
      market: "Solo",
      confidence: a.home_team_runs.confidence_pct,
      pickSummary: `${home}: ${a.home_team_runs.pick} ${a.home_team_runs.line} carreras`,
    });
  }
  if (a.away_team_runs?.confidence_pct != null) {
    candidates.push({
      market: "Solo",
      confidence: a.away_team_runs.confidence_pct,
      pickSummary: `${away}: ${a.away_team_runs.pick} ${a.away_team_runs.line} carreras`,
    });
  }
  if (a.first_five_innings?.confidence_pct != null) {
    const winnerName = a.first_five_innings.winner === "home" ? home : away;
    candidates.push({
      market: "H",
      confidence: a.first_five_innings.confidence_pct,
      pickSummary: `${winnerName} gana first 5 innings`,
    });
  }
  if (a.strikeouts_home?.confidence_pct != null && a.strikeouts_home?.line != null) {
    candidates.push({
      market: "K",
      confidence: a.strikeouts_home.confidence_pct,
      pickSummary: `${home} abridor: ${a.strikeouts_home.pick} ${a.strikeouts_home.line} ponches`,
    });
  }
  if (a.strikeouts_away?.confidence_pct != null && a.strikeouts_away?.line != null) {
    candidates.push({
      market: "K",
      confidence: a.strikeouts_away.confidence_pct,
      pickSummary: `${away} abridor: ${a.strikeouts_away.pick} ${a.strikeouts_away.line} ponches`,
    });
  }
  if (a.hce_total?.confidence_pct != null) {
    candidates.push({
      market: "HCE",
      confidence: a.hce_total.confidence_pct,
      pickSummary: `${a.hce_total.pick} ${a.hce_total.line} carreras+hits+errores`,
    });
  }
  if (a.run_line?.confidence_pct != null) {
    const favoredName = a.run_line.favored_team === "home" ? home : away;
    candidates.push({
      market: "RL",
      confidence: a.run_line.confidence_pct,
      pickSummary: `${favoredName} ${a.run_line.covers === "SI" ? "cubre" : "no cubre"} ${a.run_line.spread}`,
    });
  }

  const best = a.best_method;
  const alt = a.alternative_method;
  if (best?.market && alt?.market && alt.market !== best.market) {
    const bConf = Number(best.confidence_pct) || 0;
    const aConf = Number(alt.confidence_pct) || 0;
    if (bConf - aConf <= ALT_CLOSE_PTS && aConf > 0) {
      const hit = candidates.find((c) => c.market === alt.market);
      if (hit) {
        hit.confidence = Math.max(hit.confidence, aConf);
        hit.preferAlternative = true;
        hit._altBoost = 0.04;
      }
    }
  }

  let ranked = rankCalibratedMarkets(candidates, trackRecord);
  ranked = ranked.map((c) => ({
    ...c,
    calibratedScore: (c.calibratedScore || 0) + (c._altBoost || 0),
  }));
  ranked.sort((a, b) => (b.calibratedScore || 0) - (a.calibratedScore || 0));

  return ranked.filter((c) => c.confidence >= minConfidence);
}

function canTakeMarket(market, marketCounts) {
  const n = marketCounts[market] || 0;
  if (market === "H" && n >= MAX_F5) return false;
  if (market === "SI_NO" && n >= MAX_SI_NO) return false;
  if (n >= MAX_PER_MARKET) return false;
  return true;
}

export function buildTopPicks(todayAnalyzed, count, trackRecord, minConfidence, rankCalibratedMarkets, METHOD_LABELS) {
  const eligible = todayAnalyzed.filter((e) => e.analysis?.best_method || e.analysis?.home_win_pct != null);
  if (eligible.length === 0) return [];

  const shuffled = [...eligible];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const marketCounts = {};
  const usedGames = new Set();
  const picks = [];

  const pushPick = (entry, usable, flags = {}) => {
    if (!usable || picks.length >= count) return false;
    const key = `${entry.home}|${entry.away}`;
    if (usedGames.has(key)) return false;
    if (!canTakeMarket(usable.market, marketCounts)) return false;

    marketCounts[usable.market] = (marketCounts[usable.market] || 0) + 1;
    usedGames.add(key);
    picks.push({
      entry,
      market: usable.market,
      marketLabel: METHOD_LABELS[usable.market] || usable.market,
      pickSummary: usable.pickSummary,
      confidence: usable.confidence,
      usedAlternative: !!usable.preferAlternative || !!flags.usedAlternative,
      overCap: !!flags.overCap,
      slot: flags.slot || "calibrated",
    });
    return true;
  };

  const mlCandidates = [];
  for (const entry of shuffled) {
    const all = buildAllMarketsForEntry(entry, trackRecord, minConfidence, rankCalibratedMarkets);
    const jc = all.find((m) => m.market === "JC" && m.isClearML);
    if (jc) mlCandidates.push({ entry, jc, score: jc.confidence });
  }
  mlCandidates.sort((a, b) => b.score - a.score);

  if (count >= 2 && mlCandidates.length > 0) {
    pushPick(mlCandidates[0].entry, mlCandidates[0].jc, { slot: "clear_ml" });
  }

  if (picks.length < count) {
    const prefCandidates = [];
    for (const entry of shuffled) {
      const key = `${entry.home}|${entry.away}`;
      if (usedGames.has(key)) continue;
      const all = buildAllMarketsForEntry(entry, trackRecord, minConfidence, rankCalibratedMarkets);
      const pref = all.find((m) => (m.market === "H" || m.market === "SI_NO") && canTakeMarket(m.market, marketCounts));
      if (pref) prefCandidates.push({ entry, pref, score: pref.calibratedScore || pref.confidence });
    }
    prefCandidates.sort((a, b) => b.score - a.score);
    if (prefCandidates.length > 0) {
      pushPick(prefCandidates[0].entry, prefCandidates[0].pref, { slot: "preferred" });
    }
  }

  for (const entry of shuffled) {
    if (picks.length >= count) break;
    const key = `${entry.home}|${entry.away}`;
    if (usedGames.has(key)) continue;

    const all = buildAllMarketsForEntry(entry, trackRecord, minConfidence, rankCalibratedMarkets);
    const usable = all.find((m) => canTakeMarket(m.market, marketCounts));
    if (usable) {
      pushPick(entry, usable, { usedAlternative: !!usable.preferAlternative, slot: "calibrated" });
    }
  }

  if (picks.length < count) {
    for (const entry of shuffled) {
      if (picks.length >= count) break;
      const key = `${entry.home}|${entry.away}`;
      if (usedGames.has(key)) continue;
      const all = buildAllMarketsForEntry(entry, trackRecord, minConfidence, rankCalibratedMarkets);
      const top = all[0];
      if (!top) continue;
      marketCounts[top.market] = (marketCounts[top.market] || 0) + 1;
      usedGames.add(key);
      picks.push({
        entry,
        market: top.market,
        marketLabel: METHOD_LABELS[top.market] || top.market,
        pickSummary: top.pickSummary,
        confidence: top.confidence,
        usedAlternative: false,
        overCap: true,
        slot: "overcap",
      });
    }
  }

  return picks;
}
