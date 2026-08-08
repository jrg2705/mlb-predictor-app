// api/h2h.js — Head-to-head season series between two teams (MLB Stats API)
const MLB_BASE = "https://statsapi.mlb.com/api/v1";

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
  "Athletics": 133,
  "Pittsburgh Pirates": 134,
  "Colorado Rockies": 115,
  "Washington Nationals": 120,
  "St. Louis Cardinals": 138,
  "Los Angeles Angels": 108,
};

function resolveTeamId(input) {
  if (input == null || input === "") return null;
  const n = Number(input);
  if (!Number.isNaN(n) && n > 0) return n;
  const name = String(input).trim();
  if (TEAM_IDS[name]) return TEAM_IDS[name];
  const lower = name.toLowerCase();
  for (const [k, id] of Object.entries(TEAM_IDS)) {
    if (k.toLowerCase() === lower || k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase())) {
      return id;
    }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const team1Raw = req.query.team1 || req.query.a;
    const team2Raw = req.query.team2 || req.query.b;
    const season = Number(req.query.season) || new Date().getFullYear();

    const id1 = resolveTeamId(team1Raw);
    const id2 = resolveTeamId(team2Raw);

    if (!id1 || !id2) {
      return res.status(400).json({
        error: "Indica dos equipos válidos (nombre o id)",
        team1: team1Raw || null,
        team2: team2Raw || null,
      });
    }
    if (id1 === id2) {
      return res.status(400).json({ error: "Elige dos equipos distintos" });
    }

    const url =
      `${MLB_BASE}/schedule?sportId=1&season=${season}&teamId=${id1}` +
      `&opponentId=${id2}&gameType=R&hydrate=linescore`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`MLB API ${response.status}`);
    }
    const data = await response.json();

    const games = [];
    let wins1 = 0;
    let wins2 = 0;

    for (const day of data.dates || []) {
      for (const g of day.games || []) {
        const status = g.status?.abstractGameState;
        const away = g.teams?.away;
        const home = g.teams?.home;
        if (!away?.team || !home?.team) continue;

        const awayId = away.team.id;
        const homeId = home.team.id;
        const awayName = away.team.name;
        const homeName = home.team.name;
        const awayScore = away.score;
        const homeScore = home.score;
        const isFinal = status === "Final";

        let winnerId = null;
        let winnerName = null;
        if (isFinal && typeof awayScore === "number" && typeof homeScore === "number") {
          if (away.isWinner) {
            winnerId = awayId;
            winnerName = awayName;
          } else if (home.isWinner) {
            winnerId = homeId;
            winnerName = homeName;
          }
          if (winnerId === id1) wins1 += 1;
          else if (winnerId === id2) wins2 += 1;
        }

        games.push({
          gamePk: g.gamePk,
          date: g.officialDate || day.date,
          status: status || g.status?.detailedState || "Unknown",
          isFinal,
          away: { id: awayId, name: awayName, score: awayScore ?? null },
          home: { id: homeId, name: homeName, score: homeScore ?? null },
          winnerId,
          winnerName,
          venue: g.venue?.name || null,
        });
      }
    }

    games.sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const nameById = {};
    for (const g of games) {
      nameById[g.away.id] = g.away.name;
      nameById[g.home.id] = g.home.name;
    }
    for (const [name, id] of Object.entries(TEAM_IDS)) {
      if (!nameById[id]) nameById[id] = name;
    }

    return res.status(200).json({
      season,
      team1: { id: id1, name: nameById[id1] || String(team1Raw), wins: wins1 },
      team2: { id: id2, name: nameById[id2] || String(team2Raw), wins: wins2 },
      totalGames: games.length,
      finalGames: games.filter((g) => g.isFinal).length,
      games,
    });
  } catch (err) {
    console.error("H2H error:", err);
    return res.status(500).json({ error: "Error al obtener enfrentamientos", details: err.message });
  }
}
