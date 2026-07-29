// api/compute-bases.js — Builds compact formula base numbers for the analyze prompt.
// All math runs server-side (0 LLM tokens). The model only adjusts with day-of context.

import {
  calculateMoneyline,
  calculateTotalRuns,
  calculateRunLine,
  calculateIndividualRuns,
  calculateFirstFiveInnings,
  calculateHCE,
  calculateFirstInningNRFI,
} from "./formulas.js";

/**
 * @param {object} opts
 * @param {object} opts.homeStats - from fetchMLBStats
 * @param {object} opts.awayStats
 * @param {object} opts.homeRecord - { wins, losses, gamesPlayed }
 * @param {object} opts.awayRecord
 * @param {object|null} opts.homePitcher
 * @param {object|null} opts.awayPitcher
 */
export function computeFormulaBases({
  homeStats,
  awayStats,
  homeRecord,
  awayRecord,
  homePitcher,
  awayPitcher,
}) {
  const ml = calculateMoneyline({
    homeWins: homeRecord.wins,
    homeLosses: homeRecord.losses,
    awayWins: awayRecord.wins,
    awayLosses: awayRecord.losses,
    homeRunsScored: homeStats.runsScored,
    homeRunsAllowed: homeStats.runsAllowed,
    awayRunsScored: awayStats.runsScored,
    awayRunsAllowed: awayStats.runsAllowed,
  });

  const total = calculateTotalRuns({
    homeRunsScored: homeStats.runsScored,
    homeGamesPlayed: homeRecord.gamesPlayed,
    homeRunsAllowed: homeStats.runsAllowed,
    awayRunsScored: awayStats.runsScored,
    awayGamesPlayed: awayRecord.gamesPlayed,
    awayRunsAllowed: awayStats.runsAllowed,
  });

  const homeSolo = calculateIndividualRuns({
    projectedRuns: total.projected_home_runs,
  });
  const awaySolo = calculateIndividualRuns({
    projectedRuns: total.projected_away_runs,
  });

  const rl = calculateRunLine({
    homeWinPct: ml.home_win_pct,
    awayWinPct: ml.away_win_pct,
    projectedHomeRuns: total.projected_home_runs,
    projectedAwayRuns: total.projected_away_runs,
  });

  const f5 = calculateFirstFiveInnings({
    homeWinPct: ml.home_win_pct,
    awayWinPct: ml.away_win_pct,
    projectedHomeRuns: total.projected_home_runs,
    projectedAwayRuns: total.projected_away_runs,
  });

  const hce = calculateHCE({
    totalProjectedRuns: total.projected_home_runs + total.projected_away_runs,
    homeAvg: parseFloat(homeStats.avg) || null,
    awayAvg: parseFloat(awayStats.avg) || null,
    homeGamesPlayed: homeRecord.gamesPlayed,
    awayGamesPlayed: awayRecord.gamesPlayed,
    homeHits: homeStats.hits,
    awayHits: awayStats.hits,
  });

  const parsePitcherNum = (v) => {
    if (v == null || v === "N/A") return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };

  const nrfi = calculateFirstInningNRFI({
    homeStarterWhip: parsePitcherNum(homePitcher?.whip),
    awayStarterWhip: parsePitcherNum(awayPitcher?.whip),
    homeStarterEra: parsePitcherNum(homePitcher?.era),
    awayStarterEra: parsePitcherNum(awayPitcher?.era),
    homeObp: parseFloat(homeStats.obp) || null,
    awayObp: parseFloat(awayStats.obp) || null,
  });

  return {
    moneyline: ml,
    totalRuns: total,
    homeSolo,
    awaySolo,
    runLine: rl,
    firstFive: f5,
    hce,
    nrfi,
  };
}

/**
 * Compact text block to inject into the LLM prompt (keeps token cost low).
 */
export function formatBasesForPrompt(bases, home, away) {
  const ml = bases.moneyline;
  const t = bases.totalRuns;
  const rl = bases.runLine;
  const f5 = bases.firstFive;
  const favored = rl.favored_side === "home" ? home : away;
  const nrfiPct = bases.nrfi.nrfi_probability_pct;

  return `BASE ESTADÍSTICA (cálculo matemático Log5/Pythagorean — úsala como punto de partida; solo ajusta ±3 a ±8 pts con contexto de HOY: abridores, clima, lesiones, alineación):
- Moneyline base: ${home} ${ml.home_win_pct}% | ${away} ${ml.away_win_pct}%
- Total carreras proyectado: ${t.projected_home_runs} (local) + ${t.projected_away_runs} (vis) = línea base ${t.line}
- Solo ${home}: línea base ${bases.homeSolo.line} | Solo ${away}: línea base ${bases.awaySolo.line}
- Run Line base: favorito ${favored}, spread ${rl.spread}, cover ~${rl.cover_probability_pct}%
- First 5 base: ${home} ${f5.home_f5_win_pct}% | ${away} ${f5.away_f5_win_pct}% (proy. F5 runs ${f5.projected_home_f5_runs}-${f5.projected_away_f5_runs})
- HCE línea base: ${bases.hce.line}
- NRFI (NO anotan 1er inn) base: ${nrfiPct}% → SI anotan ~${100 - nrfiPct}%`;
}
