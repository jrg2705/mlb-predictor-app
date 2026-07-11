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
    "reasoning": "<SI significa que AL MENOS UN equipo anota en el 1er inning (combinado). NO significa que el 1er inning completo termina 0-0 entre ambos equipos. Justifica con abridores probables, 1 oración>"
  },

  "total_runs": {
    "line": <decimal ej 8.5>,
    "pick": "<OVER|UNDER>",
    "confidence_pct": <entero 0-100>,
    "reasoning": "<total de carreras COMBINADAS de ambos equipos en el juego completo, vs línea. Justifica con ambos abridores y ofensivas, 1 oración>"
  },

  "home_team_runs": {
    "line": <decimal ej 4.5>,
    "pick": "<OVER|UNDER>",
    "confidence_pct": <entero 0-100>,
    "reasoning": "<carreras SOLO del equipo local vs línea, basado en bateo local vs abridor visitante, 1 oración>"
  },

  "away_team_runs": {
    "line": <decimal ej 3.5>,
    "pick": "<OVER|UNDER>",
    "confidence_pct": <entero 0-100>,
    "reasoning": "<carreras SOLO del equipo visitante vs línea, basado en bateo visitante vs abridor local, 1 oración>"
  },

  "first_five_innings": {
    "winner": "<home|away>",
    "confidence_pct": <entero 0-100>,
    "reasoning": "<quién va ganando al final del inning 5 (first 5), basado principalmente en la comparación de abridores probables ya que suelen retirarse cerca del inning 5, 1 oración>"
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
    "reasoning": "<total combinado de Carreras+Hits+Errores de AMBOS equipos vs línea. Suele ser un número más alto que la línea de carreras solas, ya que incluye hits y errores. Justifica brevemente, 1 oración>"
  },

  "run_line": {
    "favored_team": "<home|away, el equipo con mayor % en home_win_pct/away_win_pct>",
    "spread": "<-1.5 o -2.5, el hándicap que se le resta al favorito>",
    "covers": "<SI|NO, si el favorito gana por más carreras que el spread>",
    "confidence_pct": <entero 0-100>,
    "reasoning": "<justifica si el margen de victoria esperado del favorito supera el spread, considerando fuerza ofensiva y bullpen rival, 1 oración>"
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
  "data_confidence_note": "<indica si el análisis usó abridores confirmados y/o alineación real, o si fue con datos generales del equipo, 1 oración>",
  "analyst_take": "<conclusión final, 2 oraciones>"
}

REGLAS IMPORTANTES:
- home_win_pct + away_win_pct = 100 exactamente.
- "best_method" es el campo MÁS IMPORTANTE para el sistema de picks: evalúa los 8 métodos disponibles (JC=juego completo/moneyline, H=first 5 innings, K=ponches del ABRIDOR probable de un equipo, Solo=carreras de un equipo específico, SI_NO=anotación combinada en el 1er inning, HCE=total carreras+hits+errores combinado, Linea=total carreras combinado, RL=run line con spread) y elige el que consideres tiene MAYOR probabilidad real de acierto para este partido específico.
- PRIORIDAD DEL MONEYLINE (JC): el mercado JC tiene un historial de precisión demostrado y verificado (Track Record) superior al resto de los mercados. Por lo tanto:
  - Si home_win_pct o away_win_pct es 60% o mayor, elige "JC" como "best_method" salvo que exista otro mercado con una probabilidad de acierto claramente superior (10+ puntos porcentuales de diferencia, no una diferencia marginal).
  - Si home_win_pct o away_win_pct está entre 55-59%, JC sigue siendo una opción fuerte por defecto; solo elige otro mercado si genuinamente tiene mejor sustento en los datos del día (abridores, alineación, bullpen) y no simplemente por variar.
  - Nunca deprecies JC únicamente por "buscar variedad" — la variedad entre mercados es deseable SOLO cuando hay un empate real de probabilidad entre dos opciones, no como criterio para evitar repetir JC.
- IMPORTANTE SOBRE PONCHES: sí evita el sesgo de elegir Ponches (K) como "best_method" solo porque suele tener líneas fáciles de superar cuando en realidad el Moneyline de ese partido es más fuerte y confiable. Compara siempre contra la fuerza real del Moneyline antes de preferir K.
- IMPORTANTE: si eliges "K" como "best_method" o "alternative_method", el campo "line", "pick" y "confidence_pct" DEBEN coincidir exactamente con los del campo strikeouts_home/strikeouts_away correspondiente (que ya representan al abridor probable específico). Esto es un requisito de las casas de apuestas que solo aceptan picks de ponches por abridor individual. Si no hay abridor confirmado para ese equipo (line es null), no elijas "K" como mercado.
- "alternative_method" DEBE ser un mercado distinto al de "best_method" (nunca repitas el mismo "market" en ambos campos), y debe representar una segunda opción razonable, no un relleno forzado — si genuinamente no hay una segunda opción sólida, elige el segundo mercado con mayor confianza aunque sea menor a la del "best_method". Si "best_method" es JC, "alternative_method" puede perfectamente ser otro mercado con buena variedad.
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
