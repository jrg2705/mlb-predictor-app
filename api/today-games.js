// api/today-games.js — Vercel Serverless Function
// Fetches today's scheduled MLB games

const MLB_BASE = "https://statsapi.mlb.com/api/v1";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // Use date from query param, or today
    const date = req.query.date || new Date().toISOString().split("T")[0];

    const response = await fetch(
      `${MLB_BASE}/schedule?sportId=1&date=${date}&hydrate=team,linescore`
    );
    const data = await response.json();

    const games = (data?.dates?.[0]?.games || []).map(g => ({
      gamePk: g.gamePk,
      status: g.status?.detailedState || "Scheduled",
      gameDate: g.gameDate,
      home: {
        name: g.teams?.home?.team?.name,
        score: g.teams?.home?.score ?? null,
      },
      away: {
        name: g.teams?.away?.team?.name,
        score: g.teams?.away?.score ?? null,
      },
      venue: g.venue?.name || "",
    }));

    return res.status(200).json({ date, games });
  } catch (err) {
    console.error("Error fetching today's games:", err);
    return res.status(500).json({ error: "Error al obtener partidos del día", details: err.message });
  }
}
