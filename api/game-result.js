// api/game-result.js — Vercel Serverless Function
// Checks the FULL result of one or more games by gamePk, including everything
// needed to verify any of the 8 "best_method" markets (JC, H, K, Solo, SI_NO, HCE, Linea, RL).

const MLB_BASE = "https://statsapi.mlb.com/api/v1";

async function fetchGameResult(gamePk) {
  try {
    // 1. Confirm the game is officially Final via /schedule (reliable status source)
    const scheduleRes = await fetch(`${MLB_BASE}/schedule?gamePk=${gamePk}`);
    const scheduleData = await scheduleRes.json();
    const game = scheduleData?.dates?.[0]?.games?.[0];

    if (!game) return { gamePk, final: false };

    const abstractState = game.status?.abstractGameState || "";
    const detailedState = game.status?.detailedState || "";
    const isFinal = abstractState === "Final" || detailedState.toLowerCase().includes("final") || detailedState.toLowerCase().includes("completed");

    if (!isFinal) return { gamePk, final: false };

    const homeRuns = game.teams?.home?.score;
    const awayRuns = game.teams?.away?.score;
    if (homeRuns === undefined || awayRuns === undefined) {
      return { gamePk, final: false };
    }

    // 2. Fetch boxscore (hits, errors, strikeouts) and linescore (per-inning, for first-5) in parallel
    const [boxscoreRes, linescoreRes] = await Promise.all([
      fetch(`${MLB_BASE}/game/${gamePk}/boxscore`),
      fetch(`${MLB_BASE}/game/${gamePk}/linescore`),
    ]);
    const boxscore = await boxscoreRes.json();
    const linescore = await linescoreRes.json();

    const homeBatting = boxscore?.teams?.home?.teamStats?.batting || {};
    const awayBatting = boxscore?.teams?.away?.teamStats?.batting || {};
    const homePitching = boxscore?.teams?.home?.teamStats?.pitching || {};
    const awayPitching = boxscore?.teams?.away?.teamStats?.pitching || {};
    const homeFielding = boxscore?.teams?.home?.teamStats?.fielding || {};
    const awayFielding = boxscore?.teams?.away?.teamStats?.fielding || {};

    const homeHits = homeBatting.hits ?? 0;
    const awayHits = awayBatting.hits ?? 0;
    const homeErrors = homeFielding.errors ?? 0;
    const awayErrors = awayFielding.errors ?? 0;

    // Strikeouts a team's PITCHING recorded (i.e., batters they struck out) — full team total
    const homeStrikeoutsPitching = homePitching.strikeOuts ?? 0;
    const awayStrikeoutsPitching = awayPitching.strikeOuts ?? 0;

    // Starter-specific strikeouts: find the starting pitcher in the boxscore player list
    // and read their individual strikeout count (gameStatus.isStarter or first pitcher in pitching order).
    const extractStarterStrikeouts = (teamData) => {
      const players = teamData?.players || {};
      const pitchers = teamData?.pitchers || []; // array of player IDs in the order they pitched
      if (!pitchers.length) return null;
      const starterId = pitchers[0];
      const starter = players[`ID${starterId}`];
      const k = starter?.stats?.pitching?.strikeOuts;
      return k !== undefined ? k : null;
    };

    const homeStarterStrikeouts = extractStarterStrikeouts(boxscore?.teams?.home);
    const awayStarterStrikeouts = extractStarterStrikeouts(boxscore?.teams?.away);

    // First inning: did EITHER team score (combined) in the top or bottom of inning 1?
    const innings = linescore?.innings || [];
    const inning1 = innings.find(i => i.num === 1);
    const firstInningRuns = (inning1?.home?.runs ?? 0) + (inning1?.away?.runs ?? 0);
    const firstInningScored = firstInningRuns > 0;

    // First 5 innings: cumulative score through inning 5 (winner at that point)
    let homeThrough5 = 0, awayThrough5 = 0;
    innings.forEach(i => {
      if (i.num <= 5) {
        homeThrough5 += i.home?.runs ?? 0;
        awayThrough5 += i.away?.runs ?? 0;
      }
    });
    const first5Winner = homeThrough5 > awayThrough5 ? "home" : awayThrough5 > homeThrough5 ? "away" : "tie";

    return {
      gamePk,
      final: true,
      homeRuns,
      awayRuns,
      winner: homeRuns > awayRuns ? "home" : awayRuns > homeRuns ? "away" : "tie",
      marginRuns: Math.abs(homeRuns - awayRuns),
      homeHits,
      awayHits,
      homeErrors,
      awayErrors,
      totalHitsErrorsRuns: homeRuns + awayRuns + homeHits + awayHits + homeErrors + awayErrors,
      homeStrikeoutsPitching,
      awayStrikeoutsPitching,
      homeStarterStrikeouts,
      awayStarterStrikeouts,
      firstInningScored,
      homeThrough5,
      awayThrough5,
      first5Winner,
    };
  } catch {
    return { gamePk, final: false };
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { gamePks } = req.body;
  if (!Array.isArray(gamePks) || gamePks.length === 0) {
    return res.status(400).json({ error: "gamePks array is required" });
  }

  try {
    // Process all games in parallel to keep total response time low regardless of count
    const results = await Promise.all(gamePks.map(fetchGameResult));
    return res.status(200).json({ results });
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: "Error al verificar resultados", details: err.message });
  }
}
