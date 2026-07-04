// api/game-result.js — Vercel Serverless Function
// Checks the final result of one or more games by gamePk

const MLB_BASE = "https://statsapi.mlb.com/api/v1";

async function fetchGameResult(gamePk) {
  try {
    // The /schedule endpoint (filtered by gamePk) reliably reports the official
    // game status ("Final") — the /linescore endpoint's inningState field is not
    // a dependable way to detect completion.
    const res = await fetch(`${MLB_BASE}/schedule?gamePk=${gamePk}&hydrate=linescore`);
    const data = await res.json();
    const game = data?.dates?.[0]?.games?.[0];

    if (!game) return { gamePk, final: false };

    const abstractState = game.status?.abstractGameState || ""; // "Preview" | "Live" | "Final"
    const detailedState = game.status?.detailedState || ""; // "Final", "Game Over", "Completed Early", etc.
    const isFinal = abstractState === "Final" || detailedState.toLowerCase().includes("final") || detailedState.toLowerCase().includes("completed");

    if (!isFinal) return { gamePk, final: false };

    const homeRuns = game.teams?.home?.score;
    const awayRuns = game.teams?.away?.score;

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
