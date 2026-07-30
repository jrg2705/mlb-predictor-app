// api/expert-picks.js — Vercel Serverless Function
// Uses Groq (same dual-key failover as analyze.js) as an independent "expert analyst"
// that reviews ALL markets of every analyzed game and builds Top Picks with its own judgment.
// Only the "K" (Ponches) market is capped at 4 picks max, per sportsbook rules.

const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";
const MAX_PONCHES_PICKS = 4;

function buildGameSummary(entry) {
  const a = entry.analysis;
  const home = entry.home;
  const away = entry.away;

  const markets = [];

  if (a.home_win_pct != null) {
    markets.push(`- JC (Moneyline): ${home} ${a.home_win_pct}% | ${away} ${a.away_win_pct}%`);
  }
  if (a.first_inning) {
    markets.push(`- SI_NO (1er inning): ${a.first_inning.scores} — ${a.first_inning.confidence_pct}% — ${a.first_inning.reasoning}`);
  }
  if (a.total_runs) {
    markets.push(`- Linea (Total carreras): ${a.total_runs.pick} ${a.total_runs.line} — ${a.total_runs.confidence_pct}% — ${a.total_runs.reasoning}`);
  }
  if (a.home_team_runs) {
    markets.push(`- Solo (${home}): ${a.home_team_runs.pick} ${a.home_team_runs.line} — ${a.home_team_runs.confidence_pct}% — ${a.home_team_runs.reasoning}`);
  }
  if (a.away_team_runs) {
    markets.push(`- Solo (${away}): ${a.away_team_runs.pick} ${a.away_team_runs.line} — ${a.away_team_runs.confidence_pct}% — ${a.away_team_runs.reasoning}`);
  }
  if (a.first_five_innings) {
    const winnerName = a.first_five_innings.winner === "home" ? home : away;
    markets.push(`- H (First 5 Innings): gana ${winnerName} — ${a.first_five_innings.confidence_pct}% — ${a.first_five_innings.reasoning}`);
  }
  if (a.strikeouts_home?.line != null) {
    markets.push(`- K (Ponches abridor ${home}): ${a.strikeouts_home.pick} ${a.strikeouts_home.line} — ${a.strikeouts_home.confidence_pct}% — ${a.strikeouts_home.reasoning}`);
  }
  if (a.strikeouts_away?.line != null) {
    markets.push(`- K (Ponches abridor ${away}): ${a.strikeouts_away.pick} ${a.strikeouts_away.line} — ${a.strikeouts_away.confidence_pct}% — ${a.strikeouts_away.reasoning}`);
  }
  if (a.hce_total) {
    markets.push(`- HCE (Carreras+Hits+Errores): ${a.hce_total.pick} ${a.hce_total.line} — ${a.hce_total.confidence_pct}% — ${a.hce_total.reasoning}`);
  }
  if (a.run_line) {
    const favoredName = a.run_line.favored_team === "home" ? home : away;
    markets.push(`- RL (Run Line ${a.run_line.spread}): ${favoredName} ${a.run_line.covers === "SI" ? "cubre" : "no cubre"} — ${a.run_line.confidence_pct}% — ${a.run_line.reasoning}`);
  }

  const pitcherInfo = entry.gameContext?.homePitcher || entry.gameContext?.awayPitcher
    ? `Abridores: ${home} = ${entry.gameContext?.homePitcher?.name || "no confirmado"}, ${away} = ${entry.gameContext?.awayPitcher?.name || "no confirmado"}`
    : "Abridores no confirmados aún";

  const newsInfo = entry.newsUsed?.length > 0
    ? `Noticias consideradas: ${entry.newsUsed.map(n => n.title).join(" | ")}`
    : "Sin noticias adicionales buscadas para este partido";

  return `PARTIDO: ${away} @ ${home}\n${pitcherInfo}\n${newsInfo}\n${markets.join("\n")}`;
}

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

  if (!primaryKey && !secondaryKey) {
    return { res: { ok: false, status: 500 }, data: { error: { message: "GROQ_API_KEY no configurada" } }, usedFailover: false };
  }

  const first = await attempt(primaryKey || secondaryKey);
  const isRateLimited = first.res.status === 429 || first.data?.error?.code === "rate_limit_exceeded";

  if (isRateLimited && secondaryKey && primaryKey) {
    console.log("Groq primary key rate-limited — retrying with secondary key (expert-picks)");
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

  const { games, pickCount } = req.body;
  if (!Array.isArray(games) || games.length === 0) {
    return res.status(400).json({ error: "games array is required" });
  }
  const requestedCount = Math.min(Math.max(1, pickCount || 5), games.length);

  if (!process.env.GROQ_API_KEY && !process.env.GROQ_API_KEY_2) {
    return res.status(500).json({ error: "GROQ_API_KEY no configurada en el servidor" });
  }

  try {
    const gamesSummary = games.map(buildGameSummary).join("\n\n---\n\n");

    const prompt = `Eres un analista experto de MLB con décadas de experiencia evaluando mercados de apuestas deportivas. Recibirás el análisis COMPLETO (los 8 mercados posibles) de ${games.length} partidos del día de hoy, ya generados con datos reales de la MLB Stats API, fórmulas sabermétricas validadas (Log5, Pythagorean Expectation), y noticias relevantes cuando aplique.

TU TAREA: selecciona los ${requestedCount} MEJORES picks del día, uno por partido como máximo, evaluando TODOS los mercados de cada partido con criterio propio de experto — NO te limites a elegir solo el mercado con el porcentaje más alto de forma mecánica. Actúa como lo haría un analista profesional real:

- Considera la naturaleza y volatilidad histórica de cada tipo de mercado (un Moneyline fuerte de 70%+ suele ser más confiable en la práctica que un SI/NO o Ponches al 65%, por la naturaleza de muestra pequeña de esos mercados).
- Prioriza coherencia interna: si el Moneyline, Run Line, y ventaja ofensiva de un partido apuntan todos en la misma dirección, ese partido tiene una señal más sólida que uno con señales mezcladas o contradictorias entre mercados.
- Usa las noticias y abridores confirmados como factor de desempate o de alerta (ej. una lesión reciente puede invalidar una ventaja estadística).
- Es válido y esperado que elijas Moneyline (JC) cuando genuinamente sea la mejor opción de un partido — no lo evites por sistema.
- Busca variedad natural entre partidos SOLO cuando la calidad/confianza sea genuinamente comparable entre dos opciones — nunca sacrifiques calidad por variedad artificial.

REGLA OBLIGATORIA DE LÍMITE: máximo ${MAX_PONCHES_PICKS} picks del mercado "K" (Ponches) en total en la lista final — esta es una restricción real de las casas de apuestas. Todos los demás mercados (JC, H, Solo, SI_NO, HCE, Linea, RL) NO tienen límite; puedes incluir tantos como consideres que genuinamente son los mejores.

PARTIDOS Y SUS ANÁLISIS COMPLETOS:

${gamesSummary}

Responde SOLO con un JSON válido, sin markdown, con esta estructura exacta:

{
  "picks": [
    {
      "matchup": "<away> @ <home>",
      "market": "<JC|H|K|Solo|SI_NO|HCE|Linea|RL>",
      "pick_summary": "<resumen claro del pick, máximo 15 palabras>",
      "confidence_pct": <entero 0-100, tu propia evaluación de confianza como experto, no necesariamente igual al de un solo mercado>,
      "expert_reasoning": "<por qué este es el mejor pick de ese partido específico, considerando coherencia entre mercados, contexto y noticias, 2-3 oraciones>"
    }
  ],
  "overall_analysis": "<análisis general del día en 2-3 oraciones: qué patrones viste, qué tan sólida es la jugada combinada>"
}

Ordena "picks" del que consideres de MAYOR a MENOR confianza real.`;

    const { res: groqRes, data: groqData, usedFailover } = await callGroqWithFailover({
      model: "llama-3.3-70b-versatile",
      max_tokens: 4000,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: "Analista experto MLB. Evalúas todos los mercados con criterio profesional. JSON válido únicamente, sin markdown.",
        },
        { role: "user", content: prompt },
      ],
    });

    if (usedFailover) {
      console.log("Expert-picks completed using secondary Groq key");
    }

    if (!groqRes.ok || groqData.error) {
      const errMsg = groqData.error?.message || `Groq respondió con estado ${groqRes.status}`;
      console.error("Groq API error (expert-picks):", errMsg);
      return res.status(502).json({ error: `Error de Groq AI: ${errMsg}` });
    }

    const text = groqData.choices?.[0]?.message?.content || "";
    const clean = text.replace(/```json|```/g, "").trim();

    let result;
    try {
      result = JSON.parse(clean);
    } catch (parseErr) {
      console.error("Groq JSON parse failed (expert-picks). Raw (first 800 chars):", clean.slice(0, 800));
      return res.status(502).json({
        error: "Groq devolvió una respuesta mal formada. Intenta de nuevo.",
        details: parseErr.message,
      });
    }

    // Enforce the Ponches (K) cap server-side as a safety net
    let ponchesCount = 0;
    const finalPicks = [];
    for (const pick of result.picks || []) {
      if (pick.market === "K") {
        if (ponchesCount >= MAX_PONCHES_PICKS) continue;
        ponchesCount++;
      }
      finalPicks.push(pick);
    }

    return res.status(200).json({
      picks: finalPicks,
      overallAnalysis: result.overall_analysis || null,
      totalGamesConsidered: games.length,
      provider: "groq",
    });
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: "Error al generar picks expertos", details: err.message });
  }
}
