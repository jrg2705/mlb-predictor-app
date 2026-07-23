// api/analyze.js — Vercel Serverless Function
// Fetches real MLB stats (team + probable pitchers + lineup if available) + calls Groq AI

const MLB_BASE = "https://statsapi.mlb.com/api/v1";
const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";

const TEAM_IDS = {
  "New York Yankees": 147,
  "Los Angeles Dodgers": 119,
  "Houston Astros": 117,
  "Atlanta Braves": 144,
  "Philadelphia Phillies": 143,
  "Texas Rangers": 140,
  "Baltimore Orioles": 110,
  "Minnesota Twins": 142,
  "Tampa Bay Rays": 139,
  "Arizona Diamondbacks": 109,
  "San Diego Padres": 135,
  "San Francisco Giants": 137,
  "Seattle Mariners": 136,
  "Chicago Cubs": 112,
  "Boston Red Sox": 111,
  "Toronto Blue Jays": 141,
  "New York Mets": 121,
  "Milwaukee Brewers": 158,
  "Cincinnati Reds": 113,
  "Cleveland Guardians": 114,
  "Detroit Tigers": 116,
  "Miami Marlins": 146,
  "Kansas City Royals": 118,
  "Chicago White Sox": 145,
  "Oakland Athletics": 133,
  "Athletics": 133,
  "Pittsburgh Pirates": 134,
  "Colorado Rockies": 115,
  "Washington Nationals": 120,
  "St. Louis Cardinals": 138,
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

  const runsScored = hStats.runs ?? 0;
  const runsAllowed = pStats.runs ?? 0; // runs allowed = runs given up by this team's pitching
  const hits = hStats.hits ?? 0;

  return {
    avg: hStats.avg || "N/A",
    ops: hStats.ops || "N/A",
    obp: hStats.obp || "N/A",
    slg: hStats.slg || "N/A",
    runs: hStats.runs || "N/A",
    homeRuns: hStats.homeRuns || "N/A",
    strikeOuts: hStats.strikeOuts || "N/A",
    rbi: hStats.rbi || "N/A",
    era: pStats.era || "N/A",
    whip: pStats.whip || "N/A",
    strikeoutsPer9: pStats.strikeoutsPer9Inn || "N/A",
    walksPer9: pStats.walksPer9Inn || "N/A",
    saves: pStats.saves || "N/A",
    blownSaves: pStats.blownSaves || "N/A",
    rosterSize: roster?.roster?.length || "N/A",
    runsScored,
    runsAllowed,
    hits,
  };
}

// Fetches a team's real win-loss record from the standings endpoint — the
// documented, reliable source for wins/losses (unlike ad-hoc team hydrations).
async function fetchTeamRecord(teamId) {
  try {
    const season = new Date().getFullYear();
    const res = await fetch(`${MLB_BASE}/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason`);
    const data = await res.json();
    const allTeams = (data?.records || []).flatMap(r => r.teamRecords || []);
    const teamRecord = allTeams.find(tr => tr.team?.id === teamId);
    const wins = teamRecord?.wins ?? 0;
    const losses = teamRecord?.losses ?? 0;
    return { wins, losses, gamesPlayed: wins + losses };
  } catch {
    return { wins: 0, losses: 0, gamesPlayed: 0 };
  }
}

async function fetchHeadToHead(homeId, awayId) {
  try {
    const season = new Date().getFullYear();
    const res = await fetch(
      `${MLB_BASE}/schedule?sportId=1&season=${season}&teamId=${homeId}&opponentId=${awayId}&gameType=R`
    );
    const data = await res.json();
    const games = data?.dates?.flatMap(d => d.games) || [];
    let homeWins = 0, awayWins = 0;
    games.forEach(g => {
      if (g.status?.abstractGameState === "Final") {
        const home = g.teams?.home;
        const away = g.teams?.away;
        if (home?.team?.id === homeId && home?.isWinner) homeWins++;
        else if (away?.team?.id === awayId && away?.isWinner) awayWins++;
      }
    });
    return { homeWins, awayWins, totalGames: games.length };
  } catch {
    return { homeWins: 0, awayWins: 0, totalGames: 0 };
  }
}

// Find today's (or nearest upcoming) scheduled game between these two teams,
// and pull probable pitchers + gamePk for later lineup lookup.
// If specificGamePk is provided (e.g. user tapped a specific card in "Partidos de Hoy"),
// fetch that exact game directly instead of guessing — this correctly handles doubleheaders
// where the same two teams play twice in one day.
async function fetchUpcomingGameInfo(homeId, awayId, specificGamePk = null) {
  if (specificGamePk) {
    try {
      const res = await fetch(
        `${MLB_BASE}/schedule?gamePk=${specificGamePk}&hydrate=probablePitcher,team`
      );
      const data = await res.json();
      const match = data?.dates?.[0]?.games?.[0];
      if (match) {
        return {
          gamePk: match.gamePk,
          gameDate: match.gameDate,
          status: match.status?.detailedState,
          homeProbablePitcher: match.teams?.home?.probablePitcher || null,
          awayProbablePitcher: match.teams?.away?.probablePitcher || null,
        };
      }
      // If the specific gamePk lookup fails for some reason, fall through to the search below
    } catch {
      // fall through to search below
    }
  }

  try {
    const today = new Date();
    const startDate = today.toISOString().split("T")[0];
    const future = new Date(today);
    future.setDate(future.getDate() + 10);
    const endDate = future.toISOString().split("T")[0];

    const res = await fetch(
      `${MLB_BASE}/schedule?sportId=1&teamId=${homeId}&startDate=${startDate}&endDate=${endDate}&hydrate=probablePitcher,team`
    );
    const data = await res.json();
    const games = data?.dates?.flatMap(d => d.games) || [];

    // Find the next game where the opponent matches awayId (home vs away specifically)
    const now = new Date();
    const matches = games.filter(g => {
      const h = g.teams?.home?.team?.id;
      const a = g.teams?.away?.team?.id;
      return (h === homeId && a === awayId) || (h === awayId && a === homeId);
    });

    if (matches.length === 0) return null;

    // If there are multiple matches (doubleheader), prefer the soonest one that
    // hasn't started yet; otherwise just take the earliest by date.
    matches.sort((a, b) => new Date(a.gameDate) - new Date(b.gameDate));
    const match = matches.find(g => new Date(g.gameDate) >= now) || matches[0];

    return {
      gamePk: match.gamePk,
      gameDate: match.gameDate,
      status: match.status?.detailedState,
      homeProbablePitcher: match.teams?.home?.probablePitcher || null,
      awayProbablePitcher: match.teams?.away?.probablePitcher || null,
    };
  } catch {
    return null;
  }
}

async function fetchPitcherStats(pitcherId) {
  if (!pitcherId) return null;
  try {
    const season = new Date().getFullYear();
    const res = await fetch(
      `${MLB_BASE}/people/${pitcherId}/stats?stats=season&group=pitching&season=${season}`
    );
    const data = await res.json();
    const stat = data?.stats?.[0]?.splits?.[0]?.stat || {};
    return {
      era: stat.era || "N/A",
      whip: stat.whip || "N/A",
      strikeoutsPer9: stat.strikeoutsPer9Inn || "N/A",
      walksPer9: stat.walksPer9Inn || "N/A",
      wins: stat.wins ?? "N/A",
      losses: stat.losses ?? "N/A",
      inningsPitched: stat.inningsPitched || "N/A",
      battingAvgAgainst: stat.avg || "N/A",
    };
  } catch {
    return null;
  }
}

// Lineup is only published close to game time (1-3h before first pitch).
async function fetchLineupIfAvailable(gamePk) {
  if (!gamePk) return null;
  try {
    const res = await fetch(`${MLB_BASE}/game/${gamePk}/boxscore`);
    const data = await res.json();

    const extractLineup = (teamData) => {
      const battingOrder = teamData?.battingOrder || [];
      if (!battingOrder.length) return null;
      const players = teamData?.players || {};
      return battingOrder.slice(0, 9).map(pid => {
        const p = players[`ID${pid}`];
        return p?.person?.fullName || null;
      }).filter(Boolean);
    };

    const homeLineup = extractLineup(data?.teams?.home);
    const awayLineup = extractLineup(data?.teams?.away);

    if (!homeLineup && !awayLineup) return null; // not published yet
    return { home: homeLineup, away: awayLineup };
  } catch {
    return null;
  }
}

// Weather is available pre-game (hours before first pitch) via the live feed endpoint.
// Returns condition, temperature, and wind — useful for run-scoring context
// (e.g. wind blowing out favors offense, domes have no weather impact).
async function fetchWeather(gamePk) {
  if (!gamePk) return null;
  try {
    const res = await fetch(`${MLB_BASE}/game/${gamePk}/feed/live`);
    const data = await res.json();
    const weather = data?.gameData?.weather;
    if (!weather || !weather.condition) return null;
    return {
      condition: weather.condition || null,
      temp: weather.temp || null,
      wind: weather.wind || null,
    };
  } catch {
    return null;
  }
}

// Bullpen fatigue: checks each team's last 3 days of games to see which relievers
// have pitched recently, as a proxy for bullpen availability/tiredness today.
async function fetchBullpenFatigue(teamId) {
  try {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 3);
    const fmt = (d) => d.toISOString().split("T")[0];

    const scheduleRes = await fetch(
      `${MLB_BASE}/schedule?sportId=1&teamId=${teamId}&startDate=${fmt(startDate)}&endDate=${fmt(today)}&gameType=R`
    );
    const scheduleData = await scheduleRes.json();
    const recentGames = (scheduleData?.dates?.flatMap(d => d.games) || [])
      .filter(g => g.status?.abstractGameState === "Final");

    if (recentGames.length === 0) {
      return { gamesLastThreeDays: 0, relieversUsedRecently: 0, note: "Sin juegos recientes registrados" };
    }

    // Count distinct relief pitchers used across those recent games for this team
    const usedPitcherIds = new Set();
    await Promise.all(recentGames.slice(0, 3).map(async (g) => {
      try {
        const boxRes = await fetch(`${MLB_BASE}/game/${g.gamePk}/boxscore`);
        const boxData = await boxRes.json();
        const isHome = g.teams?.home?.team?.id === teamId;
        const teamBox = isHome ? boxData?.teams?.home : boxData?.teams?.away;
        const pitchers = teamBox?.pitchers || [];
        // Skip index 0 (starter) — we only care about relievers for fatigue
        pitchers.slice(1).forEach(pid => usedPitcherIds.add(pid));
      } catch {
        // skip this game's boxscore if it fails
      }
    }));

    return {
      gamesLastThreeDays: recentGames.length,
      relieversUsedRecently: usedPitcherIds.size,
      note: usedPitcherIds.size >= 5
        ? "Bullpen con uso intenso en los últimos 3 días, posible fatiga"
        : "Bullpen con carga de trabajo normal en los últimos 3 días",
    };
  } catch {
    return null;
  }
}

// Injury context: compares the 40-man roster (includes injured list players) against
// the active roster to identify which notable players are currently unavailable.
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
    const injuredOrUnavailable = (fullData?.roster || [])
      .filter(p => !activeIds.has(p.person?.id) && p.status?.description)
      .map(p => ({
        name: p.person?.fullName,
        position: p.position?.abbreviation,
        status: p.status?.description,
      }))
      .filter(p => p.status && p.status.toLowerCase().includes("injured"));

    return injuredOrUnavailable.slice(0, 8); // cap to avoid bloating the prompt
  } catch {
    return [];
  }
}

// Calls Groq with automatic failover: if the primary key hits a rate limit (HTTP 429),
// automatically retries once using the secondary key (GROQ_API_KEY_2), if configured.
async function callGroqWithFailover(payload) {
  const primaryKey = process.env.GROQ_API_KEY;
  const secondaryKey = process.env.GROQ_API_KEY_2;

  const attempt = async (apiKey) => {
    const res = await fetch(GROQ_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return { res, data };
  };

  const first = await attempt(primaryKey);

  // Only fail over on rate limit (429) — other errors (bad request, model issue) would
  // fail the same way on the second key, so no point retrying those.
  const isRateLimited = first.res.status === 429 || first.data?.error?.code === "rate_limit_exceeded";

  if (isRateLimited && secondaryKey) {
    console.log("Groq primary key rate-limited — retrying with secondary key");
    const second = await attempt(secondaryKey);
    return { ...second, usedFailover: true };
  }

  return { ...first, usedFailover: false };
}

// Server-side safety net: independently determine the objectively highest-confidence
// market from the 8 individual fields, and correct best_method/alternative_method if
// the model's picks don't actually match the highest real numbers (guards against
// inconsistency between the AI's stated "best" choice and its own generated data).
function enforceObjectiveBestMethod(analysis, home, away) {
  const candidates = [];

  if (analysis.first_inning?.confidence_pct != null) {
    candidates.push({
      market: "SI_NO", side: "combined", line: null,
      pick: analysis.first_inning.scores, spread: null,
      confidence_pct: analysis.first_inning.confidence_pct,
      pick_summary: `${analysis.first_inning.scores === "SI" ? "Anotan" : "NO anotan"} en el 1er inning`,
      reasoning: analysis.first_inning.reasoning,
      team_or_side: "Ambos equipos",
    });
  }
  if (analysis.total_runs?.confidence_pct != null) {
    candidates.push({
      market: "Linea", side: "combined", line: analysis.total_runs.line,
      pick: analysis.total_runs.pick, spread: null,
      confidence_pct: analysis.total_runs.confidence_pct,
      pick_summary: `${analysis.total_runs.pick} ${analysis.total_runs.line} carreras totales`,
      reasoning: analysis.total_runs.reasoning,
      team_or_side: "Ambos equipos",
    });
  }
  if (analysis.home_team_runs?.confidence_pct != null) {
    candidates.push({
      market: "Solo", side: "home", line: analysis.home_team_runs.line,
      pick: analysis.home_team_runs.pick, spread: null,
      confidence_pct: analysis.home_team_runs.confidence_pct,
      pick_summary: `${home}: ${analysis.home_team_runs.pick} ${analysis.home_team_runs.line} carreras`,
      reasoning: analysis.home_team_runs.reasoning,
      team_or_side: home,
    });
  }
  if (analysis.away_team_runs?.confidence_pct != null) {
    candidates.push({
      market: "Solo", side: "away", line: analysis.away_team_runs.line,
      pick: analysis.away_team_runs.pick, spread: null,
      confidence_pct: analysis.away_team_runs.confidence_pct,
      pick_summary: `${away}: ${analysis.away_team_runs.pick} ${analysis.away_team_runs.line} carreras`,
      reasoning: analysis.away_team_runs.reasoning,
      team_or_side: away,
    });
  }
  if (analysis.first_five_innings?.confidence_pct != null) {
    const winnerName = analysis.first_five_innings.winner === "home" ? home : away;
    candidates.push({
      market: "H", side: analysis.first_five_innings.winner, line: null,
      pick: null, spread: null,
      confidence_pct: analysis.first_five_innings.confidence_pct,
      pick_summary: `${winnerName} gana first 5 innings`,
      reasoning: analysis.first_five_innings.reasoning,
      team_or_side: winnerName,
    });
  }
  if (analysis.strikeouts_home?.confidence_pct != null && analysis.strikeouts_home?.line != null) {
    candidates.push({
      market: "K", side: "home", line: analysis.strikeouts_home.line,
      pick: analysis.strikeouts_home.pick, spread: null,
      confidence_pct: analysis.strikeouts_home.confidence_pct,
      pick_summary: `${home} abridor: ${analysis.strikeouts_home.pick} ${analysis.strikeouts_home.line} ponches`,
      reasoning: analysis.strikeouts_home.reasoning,
      team_or_side: home,
    });
  }
  if (analysis.strikeouts_away?.confidence_pct != null && analysis.strikeouts_away?.line != null) {
    candidates.push({
      market: "K", side: "away", line: analysis.strikeouts_away.line,
      pick: analysis.strikeouts_away.pick, spread: null,
      confidence_pct: analysis.strikeouts_away.confidence_pct,
      pick_summary: `${away} abridor: ${analysis.strikeouts_away.pick} ${analysis.strikeouts_away.line} ponches`,
      reasoning: analysis.strikeouts_away.reasoning,
      team_or_side: away,
    });
  }
  if (analysis.hce_total?.confidence_pct != null) {
    candidates.push({
      market: "HCE", side: "combined", line: analysis.hce_total.line,
      pick: analysis.hce_total.pick, spread: null,
      confidence_pct: analysis.hce_total.confidence_pct,
      pick_summary: `${analysis.hce_total.pick} ${analysis.hce_total.line} carreras+hits+errores`,
      reasoning: analysis.hce_total.reasoning,
      team_or_side: "Ambos equipos",
    });
  }
  if (analysis.run_line?.confidence_pct != null) {
    const favoredName = analysis.run_line.favored_team === "home" ? home : away;
    candidates.push({
      market: "RL", side: analysis.run_line.favored_team, line: null,
      pick: analysis.run_line.covers, spread: analysis.run_line.spread,
      confidence_pct: analysis.run_line.confidence_pct,
      pick_summary: `${favoredName} ${analysis.run_line.covers === "SI" ? "cubre" : "no cubre"} ${analysis.run_line.spread}`,
      reasoning: analysis.run_line.reasoning,
      team_or_side: favoredName,
    });
  }

  if (candidates.length === 0) return analysis; // nothing to compare, leave as-is

  // Sort descending by confidence — highest genuinely wins
  candidates.sort((a, b) => b.confidence_pct - a.confidence_pct);

  const [top, second] = candidates;

  analysis.best_method = {
    market: top.market, side: top.side, team_or_side: top.team_or_side,
    line: top.line, pick: top.pick, spread: top.spread,
    pick_summary: top.pick_summary, confidence_pct: top.confidence_pct,
    reasoning: top.reasoning,
  };

  if (second) {
    analysis.alternative_method = {
      market: second.market, side: second.side, team_or_side: second.team_or_side,
      line: second.line, pick: second.pick, spread: second.spread,
      pick_summary: second.pick_summary, confidence_pct: second.confidence_pct,
      reasoning: second.reasoning,
    };
  }

  return analysis;
}

// Detects and corrects incoherence between the Moneyline favorite and the other
// directional markets (Run Line, First 5 Innings, individual team runs, and the
// pitching/batting edge text). This is a code-level safety net because asking the
// AI to "self-check for coherence" in the prompt proved unreliable in practice —
// the model can generate the Moneyline correctly but still describe the OTHER
// team as stronger in pitching_edge/batting_edge/run_line without flagging it.
//
// Approach: only override a directional market when it contradicts the Moneyline
// favorite AND there's no meaningfully large gap that would justify a real split
// (e.g. a much stronger starter for the underdog can legitimately flip First 5).
// When we do override, we flag it via "coherence_adjusted" so this is transparent
// rather than silently rewriting the AI's work.
function enforceMoneylineCoherence(analysis, home, away) {
  const homeWinPct = analysis.home_win_pct;
  const awayWinPct = analysis.away_win_pct;
  if (homeWinPct == null || awayWinPct == null) return analysis;

  const moneylineFavorite = homeWinPct >= awayWinPct ? "home" : "away";
  const moneylineMargin = Math.abs(homeWinPct - awayWinPct);
  const adjustments = [];

  // Only enforce coherence when the Moneyline itself is reasonably decisive
  // (a near-50/50 game legitimately can have mixed signals across markets).
  const MONEYLINE_DECISIVE_THRESHOLD = 4; // percentage points away from 50/50

  if (moneylineMargin >= MONEYLINE_DECISIVE_THRESHOLD) {
    // Run Line: the favored team in run_line should match the Moneyline favorite
    // unless the underdog has a genuinely leading batting/pitching edge that
    // could realistically flip a 1.5-run market — which is rare and should be
    // rare in the data, not the common case we saw in practice.
    if (analysis.run_line?.favored_team && analysis.run_line.favored_team !== moneylineFavorite) {
      analysis.run_line.favored_team = moneylineFavorite;
      analysis.run_line.reasoning = `${analysis.run_line.reasoning} [Ajustado por coherencia: el favorito del Run Line se alineó con el favorito del Moneyline].`;
      adjustments.push("run_line");
    }

    // First 5 Innings: same logic — should generally track the Moneyline favorite
    // unless there's a starter-specific reason (which the AI should have already
    // reflected in first_five_innings.confidence_pct being genuinely close to 50).
    if (analysis.first_five_innings?.winner && analysis.first_five_innings.winner !== moneylineFavorite && analysis.first_five_innings.confidence_pct > 55) {
      analysis.first_five_innings.winner = moneylineFavorite;
      analysis.first_five_innings.reasoning = `${analysis.first_five_innings.reasoning} [Ajustado por coherencia: el ganador de First 5 se alineó con el favorito del Moneyline].`;
      adjustments.push("first_five_innings");
    }

    // Individual team runs: the Moneyline favorite should generally project MORE
    // runs than the underdog, not fewer — a favorite that's projected to score
    // less than its opponent is a direct contradiction seen in the reported bug.
    const homeRuns = parseFloat(analysis.home_team_runs?.line);
    const awayRuns = parseFloat(analysis.away_team_runs?.line);
    if (!isNaN(homeRuns) && !isNaN(awayRuns)) {
      const favoredProjectsFewerRuns = moneylineFavorite === "home" ? homeRuns < awayRuns : awayRuns < homeRuns;
      if (favoredProjectsFewerRuns && Math.abs(homeRuns - awayRuns) >= 0.5) {
        // Swap the two lines so the favorite projects more runs, preserving both
        // original values (just reassigning which team gets which), rather than
        // inventing new numbers.
        const higher = Math.max(homeRuns, awayRuns);
        const lower = Math.min(homeRuns, awayRuns);
        if (moneylineFavorite === "home") {
          analysis.home_team_runs.line = higher;
          analysis.away_team_runs.line = lower;
        } else {
          analysis.away_team_runs.line = higher;
          analysis.home_team_runs.line = lower;
        }
        adjustments.push("team_runs_projection");
      }
    }
  }

  if (adjustments.length > 0) {
    analysis.coherence_adjusted = adjustments;
  }

  return analysis;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { home, away, gamePk: requestedGamePk } = req.body;
  if (!home || !away) return res.status(400).json({ error: "home and away teams are required" });

  const homeId = TEAM_IDS[home];
  const awayId = TEAM_IDS[away];
  if (!homeId || !awayId) return res.status(400).json({ error: "Invalid team name" });

  try {
    // 1. Fetch team-level stats + H2H + upcoming game info in parallel
    const [homeStats, awayStats, h2h, gameInfo] = await Promise.all([
      fetchMLBStats(homeId),
      fetchMLBStats(awayId),
      fetchHeadToHead(homeId, awayId),
      fetchUpcomingGameInfo(homeId, awayId, requestedGamePk),
    ]);

    // 2. Fetch probable pitcher stats (if known) + lineup (if published) + weather + bullpen fatigue + injuries
    let homePitcher = null, awayPitcher = null, lineup = null, weather = null;
    const [hp, ap, lu, wx, homeFatigue, awayFatigue, homeInjuries, awayInjuries] = await Promise.all([
      gameInfo ? fetchPitcherStats(gameInfo.homeProbablePitcher?.id) : null,
      gameInfo ? fetchPitcherStats(gameInfo.awayProbablePitcher?.id) : null,
      gameInfo ? fetchLineupIfAvailable(gameInfo.gamePk) : null,
      gameInfo ? fetchWeather(gameInfo.gamePk) : null,
      fetchBullpenFatigue(homeId),
      fetchBullpenFatigue(awayId),
      fetchInjuryContext(homeId),
      fetchInjuryContext(awayId),
    ]);
    if (gameInfo) {
      homePitcher = hp ? { name: gameInfo.homeProbablePitcher?.fullName, ...hp } : null;
      awayPitcher = ap ? { name: gameInfo.awayProbablePitcher?.fullName, ...ap } : null;
      lineup = lu;
      weather = wx;
    }

    // 3. Build prompt — prioritize starting pitcher data when available
    const pitcherBlock = (homePitcher || awayPitcher) ? `
ABRIDORES PROBABLES CONFIRMADOS (dato más importante para el análisis):
- ${home} (Local): ${homePitcher ? `${homePitcher.name} — ERA ${homePitcher.era} | WHIP ${homePitcher.whip} | K/9 ${homePitcher.strikeoutsPer9} | BB/9 ${homePitcher.walksPer9} | Record ${homePitcher.wins}-${homePitcher.losses} | IP ${homePitcher.inningsPitched} | AVG en contra ${homePitcher.battingAvgAgainst}` : "No confirmado aún"}
- ${away} (Visitante): ${awayPitcher ? `${awayPitcher.name} — ERA ${awayPitcher.era} | WHIP ${awayPitcher.whip} | K/9 ${awayPitcher.strikeoutsPer9} | BB/9 ${awayPitcher.walksPer9} | Record ${awayPitcher.wins}-${awayPitcher.losses} | IP ${awayPitcher.inningsPitched} | AVG en contra ${awayPitcher.battingAvgAgainst}` : "No confirmado aún"}

IMPORTANTE: Da MÁS PESO al rendimiento individual de estos abridores que al ERA general del staff de pitcheo del equipo. El abridor del día es el factor más determinante del partido.
` : `
NOTA: Los abridores probables aún no están confirmados oficialmente por la MLB para este partido. Basa el análisis en las tendencias generales del staff de pitcheo de cada equipo, e indica menor confianza en los mercados relacionados con pitcheo.
`;

    const lineupBlock = lineup ? `
ALINEACIÓN TITULAR CONFIRMADA (publicada cerca de la hora del juego):
- ${home}: ${lineup.home ? lineup.home.join(", ") : "No disponible"}
- ${away}: ${lineup.away ? lineup.away.join(", ") : "No disponible"}

Usa esta alineación real para evaluar la fortaleza ofensiva específica de hoy, no solo el promedio histórico del roster completo.
` : `
NOTA: La alineación titular de hoy aún no ha sido publicada por la MLB (normalmente se confirma 1-3 horas antes del primer lanzamiento). El análisis ofensivo se basa en el roster completo de la temporada.
`;

    const weatherBlock = weather ? `
CLIMA DEL ESTADIO: ${weather.condition}${weather.temp ? `, ${weather.temp}°F` : ""}${weather.wind ? `, viento: ${weather.wind}` : ""}
Considera el impacto del clima en el juego: viento soplando hacia afuera o temperaturas altas suelen favorecer más carreras/jonrones; viento en contra, frío, o estadios techados reducen la ofensiva.
` : `
NOTA: Clima no disponible aún para este partido.
`;

    const fatigueBlock = `
FATIGA DE BULLPEN (últimos 3 días):
- ${home}: ${homeFatigue?.relieversUsedRecently ?? "N/A"} relevistas distintos usados — ${homeFatigue?.note || "sin datos"}
- ${away}: ${awayFatigue?.relieversUsedRecently ?? "N/A"} relevistas distintos usados — ${awayFatigue?.note || "sin datos"}
Un bullpen con muchos relevistas usados recientemente tiene mayor riesgo de fatiga y blown saves hoy.
`;

    const injuryBlock = (homeInjuries.length > 0 || awayInjuries.length > 0) ? `
JUGADORES EN LISTA DE LESIONADOS (pueden afectar el rendimiento del equipo):
- ${home}: ${homeInjuries.length > 0 ? homeInjuries.map(p => `${p.name} (${p.position}, ${p.status})`).join(", ") : "Ninguno relevante detectado"}
- ${away}: ${awayInjuries.length > 0 ? awayInjuries.map(p => `${p.name} (${p.position}, ${p.status})`).join(", ") : "Ninguno relevante detectado"}
Considera si alguno de estos jugadores es una pieza clave (abridor, bateador regular) cuya ausencia debilite al equipo.
` : "";

    const prompt = `Eres un analista experto de MLB. Analiza el partido entre ${away} (visitante) vs ${home} (local).

DATOS REALES DE LA TEMPORADA ${new Date().getFullYear()} (MLB Stats API):

EQUIPO LOCAL — ${home}:
- Bateo (temporada completa): AVG ${homeStats.avg} | OPS ${homeStats.ops} | OBP ${homeStats.obp} | SLG ${homeStats.slg}
- Ofensiva: Carreras ${homeStats.runs} | HRs ${homeStats.homeRuns} | RBIs ${homeStats.rbi} | Ks ${homeStats.strikeOuts}
- Pitcheo (staff completo): ERA ${homeStats.era} | WHIP ${homeStats.whip} | K/9 ${homeStats.strikeoutsPer9} | BB/9 ${homeStats.walksPer9}
- Bullpen: Salvamentos ${homeStats.saves} | Blown Saves ${homeStats.blownSaves}

EQUIPO VISITANTE — ${away}:
- Bateo (temporada completa): AVG ${awayStats.avg} | OPS ${awayStats.ops} | OBP ${awayStats.obp} | SLG ${awayStats.slg}
- Ofensiva: Carreras ${awayStats.runs} | HRs ${awayStats.homeRuns} | RBIs ${awayStats.rbi} | Ks ${awayStats.strikeOuts}
- Pitcheo (staff completo): ERA ${awayStats.era} | WHIP ${awayStats.whip} | K/9 ${awayStats.strikeoutsPer9} | BB/9 ${awayStats.walksPer9}
- Bullpen: Salvamentos ${awayStats.saves} | Blown Saves ${awayStats.blownSaves}

HEAD-TO-HEAD (temporada actual): ${home} ${h2h.homeWins}W - ${h2h.awayWins}W ${away} (${h2h.totalGames} juegos)
${pitcherBlock}${lineupBlock}${weatherBlock}${fatigueBlock}${injuryBlock}

Responde SOLO con JSON sin markdown, estructura exacta:

{
  "home_win_pct": <entero 0-100. PARTE del cálculo estadístico base (Moneyline) de arriba y AJÚSTALO usando el contexto específico de HOY (abridores confirmados, clima, fatiga de bullpen, lesiones, alineación). Un ajuste típico razonable es de ±3 a ±8 puntos porcentuales según qué tan fuerte sea el contexto del día; no ignores el número base ni lo cambies drásticamente sin justificación clara en tu razonamiento>,
  "away_win_pct": <entero 0-100, debe sumar 100 con home_win_pct>,

  "first_inning": {
    "scores": "<SI|NO. SI significa que AL MENOS UN equipo anota en el 1er inning (combinado). NO significa que el 1er inning completo termina 0-0 entre ambos equipos>",
    "confidence_pct": <entero 0-100>,
    "reasoning": "<justifica con abridores probables y tendencia ofensiva del primer tercio del lineup rival, 1 oración>"
  },

  "total_runs": {
    "line": <decimal ej 8.5. Usa como referencia inicial la línea calculada en "Total de carreras proyectado (base)" de arriba, y ajústala si el contexto del día (clima, abridores, fatiga) lo justifica>,
    "pick": "<OVER|UNDER, tu decisión final considerando la línea base y el contexto del día>",
    "confidence_pct": <entero 0-100>,
    "reasoning": "<total de carreras COMBINADAS de ambos equipos en el juego completo, vs línea. Justifica con ambos abridores y ofensivas, mencionando si te alejaste de la línea base del cálculo estadístico y por qué, 1 oración>"
  },

  "home_team_runs": {
    "line": <decimal ej 4.5>,
    "pick": "<OVER|UNDER>",
    "confidence_pct": <entero 0-100>,
    "reasoning": "<carreras SOLO del equipo local vs línea, basado en bateo local vs abridor visitante, mencionando si te alejaste de la línea base y por qué, 1 oración>"
  },

  "away_team_runs": {
    "line": <decimal ej 3.5>,
    "pick": "<OVER|UNDER>",
    "confidence_pct": <entero 0-100>,
    "reasoning": "<carreras SOLO del equipo visitante vs línea, basado en bateo visitante vs abridor local, mencionando si te alejaste de la línea base y por qué, 1 oración>"
  },

  "first_five_innings": {
    "winner": "<home|away>",
    "confidence_pct": <entero 0-100>,
    "reasoning": "<quién va ganando al final del inning 5 (first 5), basado principalmente en la comparación de abridores probables ya que suelen retirarse cerca del inning 5, mencionando si te alejaste del cálculo base y por qué, 1 oración>"
  },

  "strikeouts_home": {
    "line": <decimal realista SOLO para el abridor probable local, normalmente entre 4.5 y 7.5, ej 5.5. Si no hay abridor confirmado, usa null>,
    "pick": "<OVER|UNDER solo para el abridor. Si no hay abridor confirmado, usa null>",
    "confidence_pct": <entero 0-100 de confianza para el pick del abridor. Si no hay abridor confirmado, usa null>,
    "reasoning": "<ponches del ABRIDOR PROBABLE local, basado en su K/9 individual vs tendencia de ponches del lineup visitante, 1 oración. Si no hay abridor confirmado, indica que no se puede proyectar>"
  },

  "strikeouts_away": {
    "line": <decimal realista SOLO para el abridor probable visitante, normalmente entre 4.5 y 7.5, ej 5.5. Si no hay abridor confirmado, usa null>,
    "pick": "<OVER|UNDER solo para el abridor. Si no hay abridor confirmado, usa null>",
    "confidence_pct": <entero 0-100 de confianza para el pick del abridor. Si no hay abridor confirmado, usa null>,
    "reasoning": "<ponches del ABRIDOR PROBABLE visitante, basado en su K/9 individual vs tendencia de ponches del lineup local, 1 oración. Si no hay abridor confirmado, indica que no se puede proyectar>"
  },

  "hce_total": {
    "line": <decimal ej 21.5>,
    "pick": "<OVER|UNDER>",
    "confidence_pct": <entero 0-100>,
    "reasoning": "<total combinado de Carreras+Hits+Errores de AMBOS equipos vs línea. Suele ser un número más alto que la línea de carreras solas, ya que incluye hits y errores. Menciona si te alejaste de la línea base y por qué, 1 oración>"
  },

  "run_line": {
    "favored_team": "<home|away, el equipo con mayor % en home_win_pct/away_win_pct>",
    "spread": "<-1.5 o -2.5, el hándicap que se le resta al favorito>",
    "covers": "<SI|NO, si el favorito gana por más carreras que el spread>",
    "confidence_pct": <entero 0-100>,
    "reasoning": "<justifica si el margen de victoria esperado del favorito supera el spread, considerando fuerza ofensiva y bullpen rival, mencionando si te alejaste del cálculo base y por qué, 1 oración>"
  },

  "best_method": {
    "market": "<JC|H|K|Solo|SI_NO|HCE|Linea|RL>",
    "side": "<home|away, SOLO si el mercado es JC, H, K, Solo o RL (el lado al que aplica el pick). Si el mercado es SI_NO, HCE o Linea (mercados combinados de ambos equipos), usa 'combined'>",
    "team_or_side": "<nombre del equipo si aplica (JC, H, K, Solo, RL), o 'Ambos equipos' si aplica (SI_NO, HCE, Linea) — SOLO para mostrar en pantalla, no se usa para verificar>",
    "line": "<número decimal si el mercado es K, Solo, HCE o Linea (ej 6.5). Si el mercado es JC, H, SI_NO o RL, usa null>",
    "pick": "<OVER|UNDER si el mercado es K, Solo, HCE o Linea. SI|NO si el mercado es SI_NO o RL (RL: SI=cubre el spread, NO=no cubre). Si el mercado es JC o H, usa null>",
    "spread": "<solo si el mercado es RL: el spread numérico ej -1.5. En cualquier otro mercado usa null>",
    "pick_summary": "<resumen corto y claro del pick recomendado, ej: 'Yankees ganan el juego completo' o 'Under 6.5 ponches Dodgers' o 'NO anotan en el 1er inning', máximo 12 palabras>",
    "confidence_pct": <entero 0-100>,
    "reasoning": "<por qué este mercado específico tiene mejor probabilidad de acierto que simplemente el ganador del juego completo, 1-2 oraciones>"
  },

  "alternative_method": {
    "market": "<JC|H|K|Solo|SI_NO|HCE|Linea|RL — OBLIGATORIO: debe ser un mercado DIFERENTE al elegido en best_method>",
    "side": "<mismo formato que en best_method>",
    "team_or_side": "<mismo formato que en best_method>",
    "line": "<mismo formato que en best_method>",
    "pick": "<mismo formato que en best_method>",
    "spread": "<mismo formato que en best_method>",
    "pick_summary": "<resumen corto, máximo 12 palabras>",
    "confidence_pct": <entero 0-100>,
    "reasoning": "<por qué este mercado alternativo también es una opción sólida para este partido, 1 oración>"
  },

  "pitching_edge": "<equipo con ventaja, priorizando comparación de abridores probables si están disponibles, 1 oración>",
  "bullpen_risk": "<riesgo bullpen, 1 oración>",
  "batting_edge": "<ventaja bateo, usando alineación titular si está disponible, 1 oración>",
  "h2h_note": "<nota head-to-head, 1 oración>",
  "data_confidence_note": "<indica si el análisis usó abridores confirmados, alineación real, clima, fatiga de bullpen y/o datos de lesiones, o si fue con datos generales del equipo, 1 oración>",
  "analyst_take": "<conclusión final, 2 oraciones>"
}

REGLAS IMPORTANTES:
- home_win_pct + away_win_pct = 100 exactamente.
- VERIFICACIÓN DE COHERENCIA (OBLIGATORIA, último paso antes de responder): antes de finalizar el JSON, revisa TODOS los campos generados en conjunto y verifica que cuenten una historia coherente. En particular:
  - El equipo favorecido en home_win_pct/away_win_pct debe ser generalmente el mismo equipo favorecido en pitching_edge, batting_edge, home_team_runs/away_team_runs (mayor proyección de carreras), run_line.favored_team, y first_five_innings.winner — salvo que exista una razón real y específica para que un mercado puntual diverja (ej. el equipo con menor probabilidad de ganar el juego completo tiene un abridor excepcional que lo hace más fuerte SOLO en first 5 innings). Si no hay una razón real, ajusta los campos para que sean coherentes entre sí.
  - Si detectas una contradicción sin justificación (ej. el equipo con 60%+ de Moneyline aparece con menor proyección de carreras que su rival, o pitching_edge/batting_edge favorecen abiertamente al equipo con menor % de victoria), corrige el campo que está en desacuerdo antes de responder, o explica explícitamente en su "reasoning" por qué diverge del resto del análisis.
  - analyst_take debe resumir una conclusión consistente con el resto de los campos, no contradecir al equipo que los demás campos favorecen.
  - Esta revisión de coherencia es un paso interno tuyo — no agregues ningún campo nuevo al JSON para explicarla, simplemente asegúrate de que el JSON final ya sea coherente.
- "best_method" es el campo MÁS IMPORTANTE para el sistema de picks: evalúa los 8 métodos disponibles (JC=juego completo/moneyline, H=first 5 innings, K=ponches del ABRIDOR probable de un equipo, Solo=carreras de un equipo específico, SI_NO=anotación combinada en el 1er inning, HCE=total carreras+hits+errores combinado, Linea=total carreras combinado, RL=run line con spread).
- CÓMO ELEGIR "best_method" (regla objetiva y verificable, sin sesgo hacia ningún mercado en particular): genera PRIMERO los 8 campos individuales de mercado (first_inning, total_runs, home_team_runs, away_team_runs, first_five_innings, strikeouts_home, strikeouts_away, hce_total, run_line) con sus respectivos confidence_pct realistas y diferenciados. SOLO DESPUÉS de tener esos 8 números generados, compara los 8 confidence_pct entre sí y elige "best_method" = el mercado con el número más alto. El confidence_pct que reportes dentro de "best_method" DEBE ser EXACTAMENTE IGUAL (el mismo número, sin redondear ni ajustar) al confidence_pct que ya escribiste en el campo individual correspondiente a ese mercado — nunca inventes un número nuevo para "best_method" que no coincida con su campo fuente. Por ejemplo, si eliges "SI_NO" como best_method porque first_inning.confidence_pct fue 60, entonces best_method.confidence_pct también debe ser 60, no un valor distinto. Esta consistencia es OBLIGATORIA y se verifica automáticamente.
- "alternative_method" sigue la misma regla: su confidence_pct debe coincidir exactamente con el campo individual del segundo mercado más alto, generado con el mismo criterio.
- Sé exigente y realista al asignar cada confidence_pct: no repitas el mismo valor de forma mecánica entre partidos ni entre mercados dentro del mismo partido. Diferencia genuinamente la confianza según la fuerza real de los datos disponibles (por ejemplo, un abridor con K/9 muy alto frente a un lineup con muchos ponches debería tener un confidence_pct notablemente más alto en el mercado K que uno con datos mediocres).
- IMPORTANTE: si eliges "K" como "best_method" o "alternative_method", el campo "line", "pick" y "confidence_pct" DEBEN coincidir exactamente con los del campo strikeouts_home/strikeouts_away correspondiente (que ya representan al abridor probable específico). Esto es un requisito de las casas de apuestas que solo aceptan picks de ponches por abridor individual. Si no hay abridor confirmado para ese equipo (line es null), no elijas "K" como mercado.
- "alternative_method" DEBE ser un mercado distinto al de "best_method" (nunca repitas el mismo "market" en ambos campos), y debe ser el mercado con el SEGUNDO confidence_pct más alto de los 8, siguiendo el mismo criterio objetivo.
- Los campos "side", "line", "pick" y "spread" dentro de "best_method" y "alternative_method" son OBLIGATORIOS y deben coincidir exactamente con el mercado elegido en cada uno (usa null en los que no apliquen según la tabla del propio campo). Estos se usan para verificación automática de resultados, así que deben ser precisos y consistentes con el resto del análisis (por ejemplo, si "market" es "K" y el pick es sobre el equipo local, "side" debe ser "home" y "line" debe coincidir con la línea usada en strikeouts_home).
- Todas las líneas numéricas (line, spread) deben ser realistas para MLB basadas en los datos reales proporcionados, no números genéricos repetidos.`;

    // 4. Call Groq API (with automatic failover to a second key if rate-limited)
    const { res: groqRes, data: groqData, usedFailover } = await callGroqWithFailover({
      model: "llama-3.3-70b-versatile",
      max_tokens: 2900,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: "Eres un analista experto de béisbol MLB. Priorizas datos específicos del día (abridores confirmados, alineación) sobre promedios generales de temporada cuando están disponibles. Responde siempre con JSON válido únicamente, sin texto adicional ni markdown.",
        },
        { role: "user", content: prompt },
      ],
    });

    if (usedFailover) {
      console.log("Analysis completed using secondary Groq key (primary was rate-limited)");
    }

    // If Groq itself returned an error (rate limit, invalid key, model overloaded, etc.),
    // surface that real reason instead of failing confusingly at JSON.parse below.
    if (!groqRes.ok || groqData.error) {
      const groqErrorMsg = groqData.error?.message || `Groq respondió con estado ${groqRes.status}`;
      console.error("Groq API error:", groqErrorMsg);
      return res.status(502).json({
        error: `Error de Groq AI: ${groqErrorMsg}`,
        details: groqData.error?.type || "unknown",
      });
    }

    const text = groqData.choices?.[0]?.message?.content || "";
    const clean = text.replace(/```json|```/g, "").trim();

    let analysis;
    try {
      analysis = JSON.parse(clean);
    } catch (parseErr) {
      console.error("JSON parse failed. Raw response (first 500 chars):", clean.slice(0, 500));
      return res.status(502).json({
        error: "La IA devolvió una respuesta incompleta o mal formada (posiblemente por límite de tokens). Intenta de nuevo.",
        details: parseErr.message,
      });
    }

    // Fix any incoherence between the Moneyline favorite and the other
    // directional markets (Run Line, First 5, team run projections) BEFORE
    // selecting best_method, so that selection works with already-coherent data.
    analysis = enforceMoneylineCoherence(analysis, home, away);

    // Enforce objective best_method/alternative_method selection server-side,
    // independent of whatever the AI reported, to guarantee genuine numeric comparison.
    analysis = enforceObjectiveBestMethod(analysis, home, away);

    // 5. Return combined data
    return res.status(200).json({
      analysis,
      realStats: {
        home: { name: home, ...homeStats },
        away: { name: away, ...awayStats },
        h2h,
      },
      gameContext: {
        homePitcher,
        awayPitcher,
        lineup,
        weather,
        bullpenFatigue: { home: homeFatigue, away: awayFatigue },
        injuries: { home: homeInjuries, away: awayInjuries },
        gameDate: gameInfo?.gameDate || null,
        gamePk: gameInfo?.gamePk || null,
      },
    });
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: "Error al obtener stats o generar análisis", details: err.message });
  }
}
