// api/analyze.js — Vercel Serverless Function
// Fetches real MLB stats + formula bases (server-side) + Groq AI for day-of adjustment

import { computeFormulaBases, formatBasesForPrompt } from "./compute-bases.js";
import { formatBookLinesBlock } from "./format-book-lines.js";
import { fetchPhase3Context, formatPhase3ForPrompt } from "./phase3-data.js";

const MLB_BASE = "https://statsapi.mlb.com/api/v1";
const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";

const TEAM_IDS = {
  "New York Yankees": 147, "Los Angeles Dodgers": 119, "Houston Astros": 117,
  "Atlanta Braves": 144, "Philadelphia Phillies": 143, "Texas Rangers": 140,
  "Baltimore Orioles": 110, "Minnesota Twins": 142, "Tampa Bay Rays": 139,
  "Arizona Diamondbacks": 109, "San Diego Padres": 135, "San Francisco Giants": 137,
  "Seattle Mariners": 136, "Chicago Cubs": 112, "Boston Red Sox": 111,
  "Toronto Blue Jays": 141, "New York Mets": 121, "Milwaukee Brewers": 158,
  "Cincinnati Reds": 113, "Cleveland Guardians": 114, "Detroit Tigers": 116,
  "Miami Marlins": 146, "Kansas City Royals": 118, "Chicago White Sox": 145,
  "Oakland Athletics": 133, "Athletics": 133, "Pittsburgh Pirates": 134,
  "Colorado Rockies": 115, "Washington Nationals": 120, "St. Louis Cardinals": 138,
  "Los Angeles Angels": 108,
};

async function fetchMLBStats(teamId) {
  const season = new Date().getFullYear();
  const [hittingRes, pitchingRes, rosterRes] = await Promise.all([
    fetch(`${MLB_BASE}/teams/${teamId}/stats?stats=season&group=hitting&season=${season}`),
    fetch(`${MLB_BASE}/teams/${teamId}/stats?stats=season&group=pitching&season=${season}`),
    fetch(`${MLB_BASE}/teams/${teamId}/roster?rosterType=active&season=${season}`),
  ]);
  const hitting = await hittingRes.json();
  const pitching = await pitchingRes.json();
  const roster = await rosterRes.json();
  const hStats = hitting?.stats?.[0]?.splits?.[0]?.stat || {};
  const pStats = pitching?.stats?.[0]?.splits?.[0]?.stat || {};
  return {
    avg: hStats.avg || "N/A", ops: hStats.ops || "N/A", obp: hStats.obp || "N/A", slg: hStats.slg || "N/A",
    runs: hStats.runs || "N/A", homeRuns: hStats.homeRuns || "N/A", strikeOuts: hStats.strikeOuts || "N/A", rbi: hStats.rbi || "N/A",
    era: pStats.era || "N/A", whip: pStats.whip || "N/A", strikeoutsPer9: pStats.strikeoutsPer9Inn || "N/A",
    walksPer9: pStats.walksPer9Inn || "N/A", saves: pStats.saves || "N/A", blownSaves: pStats.blownSaves || "N/A",
    rosterSize: roster?.roster?.length || "N/A",
    runsScored: hStats.runs ?? 0, runsAllowed: pStats.runs ?? 0, hits: hStats.hits ?? 0,
  };
}

async function fetchBothTeamRecords(homeId, awayId) {
  try {
    const season = new Date().getFullYear();
    const res = await fetch(`${MLB_BASE}/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason`);
    const data = await res.json();
    const allTeams = (data?.records || []).flatMap(r => r.teamRecords || []);
    const get = (id) => {
      const tr = allTeams.find(t => t.team?.id === id);
      const wins = tr?.wins ?? 0, losses = tr?.losses ?? 0;
      return { wins, losses, gamesPlayed: wins + losses };
    };
    return { home: get(homeId), away: get(awayId) };
  } catch {
    return { home: { wins: 0, losses: 0, gamesPlayed: 0 }, away: { wins: 0, losses: 0, gamesPlayed: 0 } };
  }
}

async function fetchHeadToHead(homeId, awayId) {
  try {
    const season = new Date().getFullYear();
    const res = await fetch(
      `${MLB_BASE}/schedule?sportId=1&season=${season}&teamId=${homeId}&opponentId=${awayId}&gameType=R`
    );
    const data = await res.json();
    const rawGames = data?.dates?.flatMap(d => d.games) || [];
    let homeWins = 0, awayWins = 0;
    const games = [];

    for (const g of rawGames) {
      const isFinal = g.status?.abstractGameState === "Final";
      const homeT = g.teams?.home;
      const awayT = g.teams?.away;
      if (!homeT?.team || !awayT?.team) continue;

      let winnerId = null;
      let winnerName = null;
      if (isFinal) {
        if (homeT.isWinner) {
          winnerId = homeT.team.id;
          winnerName = homeT.team.name;
          if (homeT.team.id === homeId) homeWins++;
          else if (homeT.team.id === awayId) awayWins++;
        } else if (awayT.isWinner) {
          winnerId = awayT.team.id;
          winnerName = awayT.team.name;
          if (awayT.team.id === homeId) homeWins++;
          else if (awayT.team.id === awayId) awayWins++;
        }
      }

      games.push({
        gamePk: g.gamePk,
        date: g.officialDate || g.gameDate?.slice?.(0, 10) || null,
        isFinal,
        status: g.status?.detailedState || g.status?.abstractGameState || "Unknown",
        away: {
          id: awayT.team.id,
          name: awayT.team.name,
          score: typeof awayT.score === "number" ? awayT.score : null,
        },
        home: {
          id: homeT.team.id,
          name: homeT.team.name,
          score: typeof homeT.score === "number" ? homeT.score : null,
        },
        winnerId,
        winnerName,
        venue: g.venue?.name || null,
      });
    }

    games.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

    return {
      homeWins,
      awayWins,
      totalGames: games.length,
      finalGames: games.filter((x) => x.isFinal).length,
      games,
      season,
    };
  } catch {
    return { homeWins: 0, awayWins: 0, totalGames: 0, finalGames: 0, games: [], season: new Date().getFullYear() };
  }
}

async function fetchUpcomingGameInfo(homeId, awayId, specificGamePk = null) {
  if (specificGamePk) {
    try {
      const res = await fetch(`${MLB_BASE}/schedule?gamePk=${specificGamePk}&hydrate=probablePitcher,team`);
      const data = await res.json();
      const match = data?.dates?.[0]?.games?.[0];
      if (match) {
        return {
          gamePk: match.gamePk, gameDate: match.gameDate, status: match.status?.detailedState,
          homeProbablePitcher: match.teams?.home?.probablePitcher || null,
          awayProbablePitcher: match.teams?.away?.probablePitcher || null,
        };
      }
    } catch { /* fall through */ }
  }
  try {
    const today = new Date();
    const startDate = today.toISOString().split("T")[0];
    const future = new Date(today); future.setDate(future.getDate() + 10);
    const endDate = future.toISOString().split("T")[0];
    const res = await fetch(`${MLB_BASE}/schedule?sportId=1&teamId=${homeId}&startDate=${startDate}&endDate=${endDate}&hydrate=probablePitcher,team`);
    const data = await res.json();
    const games = data?.dates?.flatMap(d => d.games) || [];
    const now = new Date();
    const matches = games.filter(g => {
      const h = g.teams?.home?.team?.id, a = g.teams?.away?.team?.id;
      return (h === homeId && a === awayId) || (h === awayId && a === homeId);
    });
    if (matches.length === 0) return null;
    matches.sort((a, b) => new Date(a.gameDate) - new Date(b.gameDate));
    const match = matches.find(g => new Date(g.gameDate) >= now) || matches[0];
    return {
      gamePk: match.gamePk, gameDate: match.gameDate, status: match.status?.detailedState,
      homeProbablePitcher: match.teams?.home?.probablePitcher || null,
      awayProbablePitcher: match.teams?.away?.probablePitcher || null,
    };
  } catch { return null; }
}

async function fetchPitcherStats(pitcherId) {
  if (!pitcherId) return null;
  try {
    const season = new Date().getFullYear();
    const res = await fetch(`${MLB_BASE}/people/${pitcherId}/stats?stats=season&group=pitching&season=${season}`);
    const data = await res.json();
    const stat = data?.stats?.[0]?.splits?.[0]?.stat || {};
    return {
      era: stat.era || "N/A", whip: stat.whip || "N/A", strikeoutsPer9: stat.strikeoutsPer9Inn || "N/A",
      walksPer9: stat.walksPer9Inn || "N/A", wins: stat.wins ?? "N/A", losses: stat.losses ?? "N/A",
      inningsPitched: stat.inningsPitched || "N/A", battingAvgAgainst: stat.avg || "N/A",
    };
  } catch { return null; }
}

async function fetchLineupIfAvailable(gamePk) {
  if (!gamePk) return null;
  try {
    const res = await fetch(`${MLB_BASE}/game/${gamePk}/boxscore`);
    const data = await res.json();
    const extractLineup = (teamData) => {
      const battingOrder = teamData?.battingOrder || [];
      if (!battingOrder.length) return null;
      const players = teamData?.players || {};
      return battingOrder.slice(0, 9).map(pid => players[`ID${pid}`]?.person?.fullName || null).filter(Boolean);
    };
    const homeLineup = extractLineup(data?.teams?.home);
    const awayLineup = extractLineup(data?.teams?.away);
    if (!homeLineup && !awayLineup) return null;
    return { home: homeLineup, away: awayLineup };
  } catch { return null; }
}

async function fetchWeather(gamePk) {
  if (!gamePk) return null;
  try {
    const res = await fetch(`${MLB_BASE}/game/${gamePk}/feed/live`);
    const data = await res.json();
    const weather = data?.gameData?.weather;
    if (!weather || !weather.condition) return null;
    return { condition: weather.condition || null, temp: weather.temp || null, wind: weather.wind || null };
  } catch { return null; }
}

async function fetchBullpenFatigue(teamId) {
  try {
    const today = new Date();
    const startDate = new Date(today); startDate.setDate(startDate.getDate() - 3);
    const fmt = (d) => d.toISOString().split("T")[0];
    const scheduleRes = await fetch(`${MLB_BASE}/schedule?sportId=1&teamId=${teamId}&startDate=${fmt(startDate)}&endDate=${fmt(today)}&gameType=R`);
    const scheduleData = await scheduleRes.json();
    const recentGames = (scheduleData?.dates?.flatMap(d => d.games) || []).filter(g => g.status?.abstractGameState === "Final");
    if (recentGames.length === 0) return { gamesLastThreeDays: 0, relieversUsedRecently: 0, note: "Sin juegos recientes registrados" };
    const usedPitcherIds = new Set();
    await Promise.all(recentGames.slice(0, 3).map(async (g) => {
      try {
        const boxRes = await fetch(`${MLB_BASE}/game/${g.gamePk}/boxscore`);
        const boxData = await boxRes.json();
        const isHome = g.teams?.home?.team?.id === teamId;
        const teamBox = isHome ? boxData?.teams?.home : boxData?.teams?.away;
        (teamBox?.pitchers || []).slice(1).forEach(pid => usedPitcherIds.add(pid));
      } catch { /* skip */ }
    }));
    return {
      gamesLastThreeDays: recentGames.length,
      relieversUsedRecently: usedPitcherIds.size,
      note: usedPitcherIds.size >= 5 ? "Bullpen con uso intenso en los últimos 3 días, posible fatiga" : "Bullpen con carga de trabajo normal en los últimos 3 días",
    };
  } catch { return null; }
}

async function fetchInjuryContext(teamId) {
  try {
    const season = new Date().getFullYear();
    const [activeRes, fullRosterRes] = await Promise.all([
      fetch(`${MLB_BASE}/teams/${teamId}/roster?rosterType=active&season=${season}`),
      fetch(`${MLB_BASE}/teams/${teamId}/roster?rosterType=40Man&season=${season}`),
    ]);
    const activeData = await activeRes.json();
    const fullData = await fullRosterRes.json();
    const activeIds = new Set((activeData?.roster || []).map(p => p.person?.id));
    return (fullData?.roster || [])
      .filter(p => !activeIds.has(p.person?.id) && p.status?.description)
      .map(p => ({ name: p.person?.fullName, position: p.position?.abbreviation, status: p.status?.description }))
      .filter(p => p.status && p.status.toLowerCase().includes("injured"))
      .slice(0, 8);
  } catch { return []; }
}

async function callGroqWithFailover(payload) {
  const primaryKey = process.env.GROQ_API_KEY;
  const secondaryKey = process.env.GROQ_API_KEY_2;
  const attempt = async (apiKey) => {
    const res = await fetch(GROQ_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return { res, data };
  };
  const first = await attempt(primaryKey);
  const isRateLimited = first.res.status === 429 || first.data?.error?.code === "rate_limit_exceeded";
  if (isRateLimited && secondaryKey) {
    console.log("Groq primary key rate-limited — retrying with secondary key");
    return { ...(await attempt(secondaryKey)), usedFailover: true };
  }
  return { ...first, usedFailover: false };
}

function enforceObjectiveBestMethod(analysis, home, away) {
  const candidates = [];
  if (analysis.first_inning?.confidence_pct != null) {
    candidates.push({ market: "SI_NO", side: "combined", line: null, pick: analysis.first_inning.scores, spread: null, confidence_pct: analysis.first_inning.confidence_pct, pick_summary: `${analysis.first_inning.scores === "SI" ? "Anotan" : "NO anotan"} en el 1er inning`, reasoning: analysis.first_inning.reasoning, team_or_side: "Ambos equipos" });
  }
  if (analysis.total_runs?.confidence_pct != null) {
    candidates.push({ market: "Linea", side: "combined", line: analysis.total_runs.line, pick: analysis.total_runs.pick, spread: null, confidence_pct: analysis.total_runs.confidence_pct, pick_summary: `${analysis.total_runs.pick} ${analysis.total_runs.line} carreras totales`, reasoning: analysis.total_runs.reasoning, team_or_side: "Ambos equipos" });
  }
  if (analysis.home_team_runs?.confidence_pct != null) {
    candidates.push({ market: "Solo", side: "home", line: analysis.home_team_runs.line, pick: analysis.home_team_runs.pick, spread: null, confidence_pct: analysis.home_team_runs.confidence_pct, pick_summary: `${home}: ${analysis.home_team_runs.pick} ${analysis.home_team_runs.line} carreras`, reasoning: analysis.home_team_runs.reasoning, team_or_side: home });
  }
  if (analysis.away_team_runs?.confidence_pct != null) {
    candidates.push({ market: "Solo", side: "away", line: analysis.away_team_runs.line, pick: analysis.away_team_runs.pick, spread: null, confidence_pct: analysis.away_team_runs.confidence_pct, pick_summary: `${away}: ${analysis.away_team_runs.pick} ${analysis.away_team_runs.line} carreras`, reasoning: analysis.away_team_runs.reasoning, team_or_side: away });
  }
  if (analysis.first_five_innings?.confidence_pct != null) {
    const winnerName = analysis.first_five_innings.winner === "home" ? home : away;
    candidates.push({ market: "H", side: analysis.first_five_innings.winner, line: null, pick: null, spread: null, confidence_pct: analysis.first_five_innings.confidence_pct, pick_summary: `${winnerName} gana first 5 innings`, reasoning: analysis.first_five_innings.reasoning, team_or_side: winnerName });
  }
  if (analysis.strikeouts_home?.confidence_pct != null && analysis.strikeouts_home?.line != null) {
    candidates.push({ market: "K", side: "home", line: analysis.strikeouts_home.line, pick: analysis.strikeouts_home.pick, spread: null, confidence_pct: analysis.strikeouts_home.confidence_pct, pick_summary: `${home} abridor: ${analysis.strikeouts_home.pick} ${analysis.strikeouts_home.line} ponches`, reasoning: analysis.strikeouts_home.reasoning, team_or_side: home });
  }
  if (analysis.strikeouts_away?.confidence_pct != null && analysis.strikeouts_away?.line != null) {
    candidates.push({ market: "K", side: "away", line: analysis.strikeouts_away.line, pick: analysis.strikeouts_away.pick, spread: null, confidence_pct: analysis.strikeouts_away.confidence_pct, pick_summary: `${away} abridor: ${analysis.strikeouts_away.pick} ${analysis.strikeouts_away.line} ponches`, reasoning: analysis.strikeouts_away.reasoning, team_or_side: away });
  }
  if (analysis.hce_total?.confidence_pct != null) {
    candidates.push({ market: "HCE", side: "combined", line: analysis.hce_total.line, pick: analysis.hce_total.pick, spread: null, confidence_pct: analysis.hce_total.confidence_pct, pick_summary: `${analysis.hce_total.pick} ${analysis.hce_total.line} carreras+hits+errores`, reasoning: analysis.hce_total.reasoning, team_or_side: "Ambos equipos" });
  }
  if (analysis.run_line?.confidence_pct != null) {
    const favoredName = analysis.run_line.favored_team === "home" ? home : away;
    candidates.push({ market: "RL", side: analysis.run_line.favored_team, line: null, pick: analysis.run_line.covers, spread: analysis.run_line.spread, confidence_pct: analysis.run_line.confidence_pct, pick_summary: `${favoredName} ${analysis.run_line.covers === "SI" ? "cubre" : "no cubre"} ${analysis.run_line.spread}`, reasoning: analysis.run_line.reasoning, team_or_side: favoredName });
  }
  if (candidates.length === 0) return analysis;
  candidates.sort((a, b) => b.confidence_pct - a.confidence_pct);
  const [top, second] = candidates;
  analysis.best_method = { market: top.market, side: top.side, team_or_side: top.team_or_side, line: top.line, pick: top.pick, spread: top.spread, pick_summary: top.pick_summary, confidence_pct: top.confidence_pct, reasoning: top.reasoning };
  if (second) analysis.alternative_method = { market: second.market, side: second.side, team_or_side: second.team_or_side, line: second.line, pick: second.pick, spread: second.spread, pick_summary: second.pick_summary, confidence_pct: second.confidence_pct, reasoning: second.reasoning };
  return analysis;
}

function enforceMoneylineCoherence(analysis, home, away) {
  const homeWinPct = analysis.home_win_pct, awayWinPct = analysis.away_win_pct;
  if (homeWinPct == null || awayWinPct == null) return analysis;
  const moneylineFavorite = homeWinPct >= awayWinPct ? "home" : "away";
  const moneylineMargin = Math.abs(homeWinPct - awayWinPct);
  const adjustments = [];
  if (moneylineMargin >= 4) {
    if (analysis.run_line?.favored_team && analysis.run_line.favored_team !== moneylineFavorite) {
      analysis.run_line.favored_team = moneylineFavorite;
      analysis.run_line.reasoning = `${analysis.run_line.reasoning} [Ajustado por coherencia: el favorito del Run Line se alineó con el favorito del Moneyline].`;
      adjustments.push("run_line");
    }
    if (analysis.first_five_innings?.winner && analysis.first_five_innings.winner !== moneylineFavorite && analysis.first_five_innings.confidence_pct > 55) {
      analysis.first_five_innings.winner = moneylineFavorite;
      analysis.first_five_innings.reasoning = `${analysis.first_five_innings.reasoning} [Ajustado por coherencia: el ganador de First 5 se alineó con el favorito del Moneyline].`;
      adjustments.push("first_five_innings");
    }
    const homeRuns = parseFloat(analysis.home_team_runs?.line);
    const awayRuns = parseFloat(analysis.away_team_runs?.line);
    if (!isNaN(homeRuns) && !isNaN(awayRuns)) {
      const favoredProjectsFewerRuns = moneylineFavorite === "home" ? homeRuns < awayRuns : awayRuns < homeRuns;
      if (favoredProjectsFewerRuns && Math.abs(homeRuns - awayRuns) >= 0.5) {
        const higher = Math.max(homeRuns, awayRuns), lower = Math.min(homeRuns, awayRuns);
        if (moneylineFavorite === "home") { analysis.home_team_runs.line = higher; analysis.away_team_runs.line = lower; }
        else { analysis.away_team_runs.line = higher; analysis.home_team_runs.line = lower; }
        adjustments.push("team_runs_projection");
      }
    }
  }
  if (adjustments.length > 0) analysis.coherence_adjusted = adjustments;
  return analysis;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { home, away, gamePk: requestedGamePk, bookLines = null } = req.body;
  if (!home || !away) return res.status(400).json({ error: "home and away teams are required" });
  const homeId = TEAM_IDS[home], awayId = TEAM_IDS[away];
  if (!homeId || !awayId) return res.status(400).json({ error: "Invalid team name" });

  try {
    const [homeStats, awayStats, h2h, gameInfo, records] = await Promise.all([
      fetchMLBStats(homeId), fetchMLBStats(awayId), fetchHeadToHead(homeId, awayId),
      fetchUpcomingGameInfo(homeId, awayId, requestedGamePk), fetchBothTeamRecords(homeId, awayId),
    ]);
    const homeRecord = records.home, awayRecord = records.away;

    let homePitcher = null, awayPitcher = null, lineup = null, weather = null;
    const [hp, ap, lu, wx, homeFatigue, awayFatigue, homeInjuries, awayInjuries] = await Promise.all([
      gameInfo ? fetchPitcherStats(gameInfo.homeProbablePitcher?.id) : null,
      gameInfo ? fetchPitcherStats(gameInfo.awayProbablePitcher?.id) : null,
      gameInfo ? fetchLineupIfAvailable(gameInfo.gamePk) : null,
      gameInfo ? fetchWeather(gameInfo.gamePk) : null,
      fetchBullpenFatigue(homeId), fetchBullpenFatigue(awayId),
      fetchInjuryContext(homeId), fetchInjuryContext(awayId),
    ]);
    if (gameInfo) {
      homePitcher = hp ? { name: gameInfo.homeProbablePitcher?.fullName, ...hp } : null;
      awayPitcher = ap ? { name: gameInfo.awayProbablePitcher?.fullName, ...ap } : null;
      lineup = lu; weather = wx;
    }

    // Phase 3: park + L10 form + pitcher rest (parallel, compact prompt block)
    const phase3 = await fetchPhase3Context({
      homeId, awayId,
      homePitcherId: gameInfo?.homeProbablePitcher?.id || null,
      awayPitcherId: gameInfo?.awayProbablePitcher?.id || null,
    });
    const phase3Block = formatPhase3ForPrompt(phase3, home, away);

    const formulaBases = computeFormulaBases({ homeStats, awayStats, homeRecord, awayRecord, homePitcher, awayPitcher });
    const basesBlock = formatBasesForPrompt(formulaBases, home, away);

    const pitcherBlock = (homePitcher || awayPitcher) ? `
ABRIDORES PROBABLES:
- ${home}: ${homePitcher ? `${homePitcher.name} — ERA ${homePitcher.era} | WHIP ${homePitcher.whip} | K/9 ${homePitcher.strikeoutsPer9} | BB/9 ${homePitcher.walksPer9} | ${homePitcher.wins}-${homePitcher.losses}` : "No confirmado"}
- ${away}: ${awayPitcher ? `${awayPitcher.name} — ERA ${awayPitcher.era} | WHIP ${awayPitcher.whip} | K/9 ${awayPitcher.strikeoutsPer9} | BB/9 ${awayPitcher.walksPer9} | ${awayPitcher.wins}-${awayPitcher.losses}` : "No confirmado"}
Da MÁS PESO a estos abridores que al staff general.
` : `
NOTA: Abridores no confirmados. Usa staff general y baja confianza en mercados de pitcheo.
`;

    const lineupBlock = lineup ? `
ALINEACIÓN CONFIRMADA:
- ${home}: ${lineup.home ? lineup.home.join(", ") : "N/A"}
- ${away}: ${lineup.away ? lineup.away.join(", ") : "N/A"}
` : `NOTA: Alineación aún no publicada.
`;

    const weatherBlock = weather
      ? `CLIMA: ${weather.condition}${weather.temp ? `, ${weather.temp}°F` : ""}${weather.wind ? `, viento: ${weather.wind}` : ""}
`
      : `NOTA: Clima no disponible.
`;

    const fatigueBlock = `BULLPEN (últimos 3 días): ${home} ${homeFatigue?.relieversUsedRecently ?? "N/A"} relevistas (${homeFatigue?.note || "sin datos"}) | ${away} ${awayFatigue?.relieversUsedRecently ?? "N/A"} relevistas (${awayFatigue?.note || "sin datos"})
`;

    const injuryBlock = (homeInjuries.length > 0 || awayInjuries.length > 0)
      ? `LESIONADOS: ${home}: ${homeInjuries.length > 0 ? homeInjuries.map(p => `${p.name} (${p.position})`).join(", ") : "ninguno"} | ${away}: ${awayInjuries.length > 0 ? awayInjuries.map(p => `${p.name} (${p.position})`).join(", ") : "ninguno"}
`
      : "";

    const bookBlock = formatBookLinesBlock(bookLines, home, away);

    const prompt = `Eres analista experto de MLB. Partido: ${away} (V) vs ${home} (L).

${basesBlock}

DATOS TEMPORADA ${new Date().getFullYear()}:
${home} — AVG ${homeStats.avg} OPS ${homeStats.ops} OBP ${homeStats.obp} | Carreras ${homeStats.runs} HR ${homeStats.homeRuns} | ERA ${homeStats.era} WHIP ${homeStats.whip} K/9 ${homeStats.strikeoutsPer9} | SV ${homeStats.saves}/${homeStats.blownSaves}
${away} — AVG ${awayStats.avg} OPS ${awayStats.ops} OBP ${awayStats.obp} | Carreras ${awayStats.runs} HR ${awayStats.homeRuns} | ERA ${awayStats.era} WHIP ${awayStats.whip} K/9 ${awayStats.strikeoutsPer9} | SV ${awayStats.saves}/${awayStats.blownSaves}
H2H: ${home} ${h2h.homeWins}W - ${h2h.awayWins}W ${away} (${h2h.totalGames} juegos)
${pitcherBlock}${lineupBlock}${weatherBlock}${fatigueBlock}${injuryBlock}${phase3Block}${bookBlock}
Responde SOLO JSON válido (sin markdown):
{
  "home_win_pct": <entero, parte de Moneyline base y ajusta ±3 a ±8 pts solo con contexto de HOY>,
  "away_win_pct": <entero, suma 100 con home_win_pct>,
  "first_inning": { "scores": "SI|NO", "confidence_pct": <0-100>, "reasoning": "<1 oración>" },
  "total_runs": { "line": <decimal desde base o línea de banca>, "pick": "OVER|UNDER", "confidence_pct": <0-100>, "reasoning": "<1 oración>" },
  "home_team_runs": { "line": <decimal>, "pick": "OVER|UNDER", "confidence_pct": <0-100>, "reasoning": "<1 oración>" },
  "away_team_runs": { "line": <decimal>, "pick": "OVER|UNDER", "confidence_pct": <0-100>, "reasoning": "<1 oración>" },
  "first_five_innings": { "winner": "home|away", "confidence_pct": <0-100>, "reasoning": "<1 oración>" },
  "strikeouts_home": { "line": <decimal|null>, "pick": "OVER|UNDER|null", "confidence_pct": <0-100|null>, "reasoning": "<1 oración>" },
  "strikeouts_away": { "line": <decimal|null>, "pick": "OVER|UNDER|null", "confidence_pct": <0-100|null>, "reasoning": "<1 oración>" },
  "hce_total": { "line": <decimal>, "pick": "OVER|UNDER", "confidence_pct": <0-100>, "reasoning": "<1 oración>" },
  "run_line": { "favored_team": "home|away", "spread": "<-1.5|-2.5>", "covers": "SI|NO", "confidence_pct": <0-100>, "reasoning": "<1 oración>" },
  "best_method": { "market": "JC|H|K|Solo|SI_NO|HCE|Linea|RL", "side": "home|away|combined", "team_or_side": "<nombre|Ambos equipos>", "line": <num|null>, "pick": "<OVER|UNDER|SI|NO|null>", "spread": <num|null>, "pick_summary": "<máx 12 palabras>", "confidence_pct": <igual al campo fuente>, "reasoning": "<1-2 oraciones>" },
  "alternative_method": { "market": "<distinto a best_method>", "side": "...", "team_or_side": "...", "line": <num|null>, "pick": "...", "spread": <num|null>, "pick_summary": "...", "confidence_pct": <igual al 2º mejor>, "reasoning": "<1 oración>" },
  "pitching_edge": "<1 oración>",
  "bullpen_risk": "<1 oración>",
  "batting_edge": "<1 oración>",
  "h2h_note": "<1 oración>",
  "data_confidence_note": "<1 oración>",
  "analyst_take": "<2 oraciones>"
}

REGLAS:
- home_win_pct + away_win_pct = 100.
- Parte SIEMPRE de las bases matemáticas; ajusta con contexto de HOY (abridores, clima, lesiones, alineación, parque, forma L10, rest del pitcher, líneas de banca).
- Genera primero los 8 mercados con confidence_pct realistas y diferenciados; best_method = el de mayor %; alternative = el 2º (mercado distinto).
- Si no hay abridor confirmado, strikeouts_*.line/pick/confidence_pct = null y no elijas K.
- Coherencia: el favorito del Moneyline debe alinearse con RL, F5 y proyecciones de carreras salvo razón específica.
- Parque ofensivo (PF≥103) → totales/HCE más altos; parque pitcher (PF≤97) → totales más bajos.
- Forma L10 caliente/fría puede mover ±2 a ±5 pts vs temporada.
- Rest corto (≤3d) del abridor → cautela en K y F5; rest largo (≥7d) → posible oxidación o frescura.
- Si hay LÍNEAS DE LA BANCA, usa esas líneas exactas en total_runs/home/away/hce/strikeouts .line; pick OVER/UNDER respecto a ellas. Value si proyección difiere ≥0.5.`;

    const { res: groqRes, data: groqData, usedFailover } = await callGroqWithFailover({
      model: "openai/gpt-oss-120b",
      max_tokens: 2900,
      temperature: 0.3,
      messages: [
        { role: "system", content: "Analista experto MLB. Priorizas contexto del día (abridores, parque, forma L10, rest, líneas de banca) sobre promedios de temporada. JSON válido únicamente, sin markdown." },
        { role: "user", content: prompt },
      ],
    });

    if (usedFailover) console.log("Analysis completed using secondary Groq key");

    if (!groqRes.ok || groqData.error) {
      const groqErrorMsg = groqData.error?.message || `Groq respondió con estado ${groqRes.status}`;
      console.error("Groq API error:", groqErrorMsg);
      return res.status(502).json({ error: `Error de Groq AI: ${groqErrorMsg}`, details: groqData.error?.type || "unknown" });
    }

    const text = groqData.choices?.[0]?.message?.content || "";
    const clean = text.replace(/```json|```/g, "").trim();
    let analysis;
    try {
      analysis = JSON.parse(clean);
    } catch (parseErr) {
      console.error("JSON parse failed. Raw (first 500):", clean.slice(0, 500));
      return res.status(502).json({ error: "La IA devolvió una respuesta incompleta o mal formada. Intenta de nuevo.", details: parseErr.message });
    }

    analysis = enforceMoneylineCoherence(analysis, home, away);
    analysis = enforceObjectiveBestMethod(analysis, home, away);

    return res.status(200).json({
      analysis,
      formulaBases,
      realStats: { home: { name: home, ...homeStats }, away: { name: away, ...awayStats }, h2h },
      gameContext: {
        homePitcher, awayPitcher, lineup, weather,
        bullpenFatigue: { home: homeFatigue, away: awayFatigue },
        injuries: { home: homeInjuries, away: awayInjuries },
        gameDate: gameInfo?.gameDate || null,
        gamePk: gameInfo?.gamePk || null,
        phase3,
      },
      bookLinesUsed: bookLines || null,
      phase3,
    });
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: "Error al obtener stats o generar análisis", details: err.message });
  }
}
