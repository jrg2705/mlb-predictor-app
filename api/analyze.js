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

// Find today's (or nearest upcoming) scheduled game between these two teams,
// and pull probable pitchers + gamePk for later lineup lookup.
async function fetchUpcomingGameInfo(homeId, awayId) {
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
    const match = games.find(g => {
      const h = g.teams?.home?.team?.id;
      const a = g.teams?.away?.team?.id;
      return (h === homeId && a === awayId) || (h === awayId && a === homeId);
    });

    if (!match) return null;

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
    // 1. Fetch team-level stats + H2H + upcoming game info in parallel
    const [homeStats, awayStats, h2h, gameInfo] = await Promise.all([
      fetchMLBStats(homeId),
      fetchMLBStats(awayId),
      fetchHeadToHead(homeId, awayId),
      fetchUpcomingGameInfo(homeId, awayId),
    ]);

    // 2. Fetch probable pitcher stats (if known) + lineup (if published)
    let homePitcher = null, awayPitcher = null, lineup = null;
    if (gameInfo) {
      const [hp, ap, lu] = await Promise.all([
        fetchPitcherStats(gameInfo.homeProbablePitcher?.id),
        fetchPitcherStats(gameInfo.awayProbablePitcher?.id),
        fetchLineupIfAvailable(gameInfo.gamePk),
      ]);
      homePitcher = hp ? { name: gameInfo.homeProbablePitcher?.fullName, ...hp } : null;
      awayPitcher = ap ? { name: gameInfo.awayProbablePitcher?.fullName, ...ap } : null;
      lineup = lu;
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
${pitcherBlock}${lineupBlock}

Responde SOLO con JSON sin markdown, estructura exacta:

{
  "home_win_pct": <entero 0-100>,
  "away_win_pct": <entero 0-100>,
  "first_inning": {
    "scores": "<SI|NO>",
    "confidence_pct": <entero 0-100>,
    "reasoning": "<justificación basada en el abridor probable vs primer tercio del orden, 1 oración>"
  },
  "total_runs": {
    "line": <decimal ej 8.5>,
    "pick": "<OVER|UNDER>",
    "confidence_pct": <entero 0-100>,
    "reasoning": "<justificación basada en ambos abridores y ofensivas, 1 oración>"
  },
  "home_team_runs": {
    "line": <decimal ej 4.5>,
    "pick": "<OVER|UNDER>",
    "confidence_pct": <entero 0-100>,
    "reasoning": "<justificación basada en bateo local vs abridor visitante, 1 oración>"
  },
  "away_team_runs": {
    "line": <decimal ej 3.5>,
    "pick": "<OVER|UNDER>",
    "confidence_pct": <entero 0-100>,
    "reasoning": "<justificación basada en bateo visitante vs abridor local, 1 oración>"
  },
  "pitching_edge": "<equipo con ventaja, priorizando comparación de abridores probables si están disponibles, 1 oración>",
  "bullpen_risk": "<riesgo bullpen, 1 oración>",
  "batting_edge": "<ventaja bateo, usando alineación titular si está disponible, 1 oración>",
  "h2h_note": "<nota head-to-head, 1 oración>",
  "data_confidence_note": "<indica si el análisis usó abridores confirmados y/o alineación real, o si fue con datos generales del equipo, 1 oración>",
  "analyst_take": "<conclusión final, 2 oraciones>"
}

home_win_pct + away_win_pct = 100 exactamente.`;

    // 4. Call Groq API
    const groqRes = await fetch(GROQ_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 1200,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: "Eres un analista experto de béisbol MLB. Priorizas datos específicos del día (abridores confirmados, alineación) sobre promedios generales de temporada cuando están disponibles. Responde siempre con JSON válido únicamente, sin texto adicional ni markdown.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    const groqData = await groqRes.json();
    const text = groqData.choices?.[0]?.message?.content || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const analysis = JSON.parse(clean);

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
        gameDate: gameInfo?.gameDate || null,
        gamePk: gameInfo?.gamePk || null,
      },
    });
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: "Error al obtener stats o generar análisis", details: err.message });
  }
}
