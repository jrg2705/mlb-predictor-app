// api/analyze.js — Vercel Serverless Function
// Fetches real MLB stats + calls Groq AI for analysis

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
  };
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { home, away } = req.body;
  if (!home || !away) return res.status(400).json({ error: "home and away teams are required" });

  const homeId = TEAM_IDS[home];
  const awayId = TEAM_IDS[away];
  if (!homeId || !awayId) return res.status(400).json({ error: "Invalid team name" });

  try {
    // 1. Fetch real MLB stats
    const [homeStats, awayStats, h2h] = await Promise.all([
      fetchMLBStats(homeId),
      fetchMLBStats(awayId),
      fetchHeadToHead(homeId, awayId),
    ]);

    // 2. Build prompt with real data
    const prompt = `Eres un analista experto de MLB. Analiza el partido entre ${away} (visitante) vs ${home} (local).

DATOS REALES DE LA TEMPORADA ${new Date().getFullYear()} (MLB Stats API):

EQUIPO LOCAL — ${home}:
- Bateo: AVG ${homeStats.avg} | OPS ${homeStats.ops} | OBP ${homeStats.obp} | SLG ${homeStats.slg}
- Ofensiva: Carreras ${homeStats.runs} | HRs ${homeStats.homeRuns} | RBIs ${homeStats.rbi} | Ks ${homeStats.strikeOuts}
- Pitcheo: ERA ${homeStats.era} | WHIP ${homeStats.whip} | K/9 ${homeStats.strikeoutsPer9} | BB/9 ${homeStats.walksPer9}
- Bullpen: Salvamentos ${homeStats.saves} | Blown Saves ${homeStats.blownSaves}

EQUIPO VISITANTE — ${away}:
- Bateo: AVG ${awayStats.avg} | OPS ${awayStats.ops} | OBP ${awayStats.obp} | SLG ${awayStats.slg}
- Ofensiva: Carreras ${awayStats.runs} | HRs ${awayStats.homeRuns} | RBIs ${awayStats.rbi} | Ks ${awayStats.strikeOuts}
- Pitcheo: ERA ${awayStats.era} | WHIP ${awayStats.whip} | K/9 ${awayStats.strikeoutsPer9} | BB/9 ${awayStats.walksPer9}
- Bullpen: Salvamentos ${awayStats.saves} | Blown Saves ${awayStats.blownSaves}

HEAD-TO-HEAD (temporada actual): ${home} ${h2h.homeWins}W - ${h2h.awayWins}W ${away} (${h2h.totalGames} juegos)

Responde SOLO con JSON sin markdown, estructura exacta:

{
  "home_win_pct": <entero 0-100>,
  "away_win_pct": <entero 0-100>,
  "first_inning": {
    "scores": "<SI|NO>",
    "confidence_pct": <entero 0-100>,
    "reasoning": "<justificación 1 oración>"
  },
  "total_runs": {
    "line": <decimal ej 8.5>,
    "pick": "<OVER|UNDER>",
    "confidence_pct": <entero 0-100>,
    "reasoning": "<justificación 1 oración>"
  },
  "home_team_runs": {
    "line": <decimal ej 4.5>,
    "pick": "<OVER|UNDER>",
    "confidence_pct": <entero 0-100>,
    "reasoning": "<justificación 1 oración>"
  },
  "away_team_runs": {
    "line": <decimal ej 3.5>,
    "pick": "<OVER|UNDER>",
    "confidence_pct": <entero 0-100>,
    "reasoning": "<justificación 1 oración>"
  },
  "pitching_edge": "<ventaja pitching, 1 oración>",
  "bullpen_risk": "<riesgo bullpen, 1 oración>",
  "batting_edge": "<ventaja bateo, 1 oración>",
  "h2h_note": "<nota head-to-head, 1 oración>",
  "analyst_take": "<conclusión final, 2 oraciones>"
}

home_win_pct + away_win_pct = 100 exactamente.`;

    // 3. Call Groq API (free tier - LLaMA 3.3 70B)
    const groqRes = await fetch(GROQ_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 1000,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: "Eres un analista experto de béisbol MLB. Responde siempre con JSON válido únicamente, sin texto adicional ni markdown.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    const groqData = await groqRes.json();
    const text = groqData.choices?.[0]?.message?.content || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const analysis = JSON.parse(clean);

    // 4. Return combined real stats + AI analysis
    return res.status(200).json({
      analysis,
      realStats: {
        home: { name: home, ...homeStats },
        away: { name: away, ...awayStats },
        h2h,
      },
    });
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: "Error al obtener stats o generar análisis", details: err.message });
  }
}
