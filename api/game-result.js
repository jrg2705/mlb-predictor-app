// api/game-result.js — Vercel Serverless Function
// Checks the final result of one or more games by gamePk

const MLB_BASE = "https://statsapi.mlb.com/api/v1";

async function fetchGameResult(gamePk) {
  try {
    const res = await fetch(`${MLB_BASE}/game/${gamePk}/linescore`);
    const data = await res.json();

    if (!data || data.currentInning === undefined) {
      return { gamePk, final: false };
    }

    const isFinal = data.isGameOver === true || data.inningState === "Final";
    if (!isFinal) return { gamePk, final: false };

    const homeRuns = data.teams?.home?.runs;
    const awayRuns = data.teams?.away?.runs;

    if (homeRuns === undefined || awayRuns === undefined) {
      return { gamePk, final: false };
    }

    return {
      gamePk,
      final: true,
      homeRuns,
      awayRuns,
      winner: homeRuns > awayRuns ? "home" : awayRuns > homeRuns ? "away" : "tie",
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
    const results = await Promise.all(gamePks.map(fetchGameResult));
    return res.status(200).json({ results });
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: "Error al verificar resultados", details: err.message });
  }
}
