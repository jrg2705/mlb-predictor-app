// api/standings.js — Vercel Serverless Function
// Fetches MLB standings grouped by division, including games remaining

const MLB_BASE = "https://statsapi.mlb.com/api/v1";

// MLB division IDs (standard, stable across seasons)
const DIVISIONS = {
  201: { name: "AL East", league: "AL" },
  202: { name: "AL Central", league: "AL" },
  200: { name: "AL West", league: "AL" },
  204: { name: "NL East", league: "NL" },
  205: { name: "NL Central", league: "NL" },
  203: { name: "NL West", league: "NL" },
};

const TOTAL_REGULAR_SEASON_GAMES = 162;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const season = new Date().getFullYear();
    const response = await fetch(
      `${MLB_BASE}/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason`
    );
    const data = await response.json();

    const divisions = {};

    (data?.records || []).forEach(record => {
      const divId = record.division?.id;
      const divInfo = DIVISIONS[divId];
      if (!divInfo) return;

      const teams = (record.teamRecords || []).map(tr => {
        const wins = tr.leagueRecord?.wins ?? 0;
        const losses = tr.leagueRecord?.losses ?? 0;
        const gamesPlayed = wins + losses;
        const gamesRemaining = Math.max(0, TOTAL_REGULAR_SEASON_GAMES - gamesPlayed);

        return {
          teamId: tr.team?.id,
          name: tr.team?.name,
          wins,
          losses,
          pct: tr.leagueRecord?.pct || "N/A",
          gamesBack: tr.gamesBack === "-" ? "0" : tr.gamesBack,
          divisionRank: tr.divisionRank || "N/A",
          streak: tr.streak?.streakCode || "N/A",
          last10: tr.records?.splitRecords?.find(r => r.type === "lastTen")
            ? `${tr.records.splitRecords.find(r => r.type === "lastTen").wins}-${tr.records.splitRecords.find(r => r.type === "lastTen").losses}`
            : "N/A",
          gamesPlayed,
          gamesRemaining,
        };
      });

      // Sort by division rank
      teams.sort((a, b) => {
        const rankA = parseInt(a.divisionRank) || 99;
        const rankB = parseInt(b.divisionRank) || 99;
        return rankA - rankB;
      });

      divisions[divInfo.name] = { league: divInfo.league, teams };
    });

    return res.status(200).json({ season, divisions });
  } catch (err) {
    console.error("Error fetching standings:", err);
    return res.status(500).json({ error: "Error al obtener las posiciones", details: err.message });
  }
}
