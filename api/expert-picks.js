// api/expert-picks.js — Independent expert using Groq + track-record calibration + A/B/F selection rules

const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";
const MAX_PONCHES_PICKS = 2; // tighter diversity
const MAX_F5 = 1;
const MAX_SI_NO = 1;

function buildGameSummary(entry) {
  const a = entry.analysis;
  const home = entry.home;
  const away = entry.away;
  const markets = [];

  if (a.home_win_pct != null) {
    const clear = Math.max(a.home_win_pct, a.away_win_pct) >= 58 ? " [ML CLARO ≥58%]" : "";
    markets.push(`- JC (Moneyline): ${home} ${a.home_win_pct}% | ${away} ${a.away_win_pct}%${clear}`);
  }
  if (a.best_method) {
    markets.push(`- MEJOR_METODO: ${a.best_method.market} — ${a.best_method.pick_summary} (${a.best_method.confidence_pct}%)`);
  }
  if (a.alternative_method) {
    markets.push(`- ALTERNATIVA: ${a.alternative_method.market} — ${a.alternative_method.pick_summary} (${a.alternative_method.confidence_pct}%)`);
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
    ? `Noticias consideradas: ${entry.newsUsed.map((n) => n.title).join(" | ")}`
    : "Sin noticias adicionales buscadas para este partido";

  return `PARTIDO: ${away} @ ${home}\n${pitcherInfo}\n${newsInfo}\n${markets.join("\n")}`;
}

function formatCalibrationBlock(calibration) {
  if (!Array.isArray(calibration) || calibration.length === 0) {
    return `CALIBRACIÓN HISTÓRICA: aún sin datos suficientes. Prioriza First 5 (H) y 1er Inning SI/NO; evita Run Line (RL). Incluye ML si ≥58%.`;
  }
  const lines = calibration.map((r) => {
    const tag = r.avoid ? "EVITAR" : r.prefer ? "PRIORIZAR" : "neutral";
    const pct = r.hitPct != null ? `${r.hitPct}%` : "n/d";
    return `- ${r.market}: acierto histórico ${pct} (n=${r.samples || 0}) → ${tag}`;
  });
  return `CALIBRACIÓN CON TRACK RECORD REAL DEL USUARIO (obliga a respetarla):
${lines.join("\n")}
Reglas: casi nunca elijas mercados marcados EVITAR; prefiere PRIORIZAR; card MIXTO.`;
}

async function callGroqWithFailover(payload) {
  const primaryKey = process.env.GROQ_API_KEY;
  const secondaryKey = process.env.GROQ_API_KEY_2;

  const attempt = async (apiKey) => {
    const res = await fetch(GROQ_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return { res, data };
  };

  if (!primaryKey && !secondaryKey) {
    return {
      res: { ok: false, status: 500 },
      data: { error: { message: "GROQ_API_KEY no configurada" } },
      usedFailover: false,
    };
  }

  const first = await attempt(primaryKey || secondaryKey);
  const isRateLimited =
    first.res.status === 429 || first.data?.error?.code === "rate_limit_exceeded";

  if (isRateLimited && secondaryKey && primaryKey) {
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

  const { games, pickCount, calibration = null } = req.body;
  if (!Array.isArray(games) || games.length === 0) {
    return res.status(400).json({ error: "games array is required" });
  }
  const requestedCount = Math.min(Math.max(1, pickCount || 5), games.length);

  if (!process.env.GROQ_API_KEY && !process.env.GROQ_API_KEY_2) {
    return res.status(500).json({ error: "GROQ_API_KEY no configurada en el servidor" });
  }

  try {
    const gamesSummary = games.map(buildGameSummary).join("\n\n---\n\n");
    const calibBlock = formatCalibrationBlock(calibration);

    const prompt = `Eres un analista profesional de apuestas MLB (estilo sharp): buscas POCOS picks de alta calidad en un CARD MIXTO, no volumen ni un solo mercado.

${calibBlock}

Recibirás el análisis completo de ${games.length} partidos. Selecciona los ${requestedCount} MEJORES picks (máximo uno por partido).

REGLAS DE SELECCIÓN (obligatorias — el usuario comprobó que el "mejor método" solo suele fallar más que el 2.º y el ML):
A) Si ALTERNATIVA está a ≤10 puntos de confianza del MEJOR_METODO, prefiere la ALTERNATIVA: datos del usuario muestran que rank #2 acierta mucho más que #1.
B) Si un partido tiene ML CLARO (≥58% en un lado), INCLUYE al menos un pick JC en el card cuando pidas 2+ picks. No ignores favoritos claros solo porque F5/K/SI_NO tengan % similar.
F) CARD MIXTO: no llenes el card solo de F5 o solo de SI_NO o solo de K.
   - Máximo ${MAX_F5} pick de H (First 5)
   - Máximo ${MAX_SI_NO} pick de SI_NO
   - Máximo ${MAX_PONCHES_PICKS} picks de K
   - Incluye variedad: idealmente 1 ML + 1 F5 o SI_NO + resto calibrado
- Respeta CALIBRACIÓN: evita EVITAR (sobre todo RL).
- Coherencia entre mercados > un % aislado inflado.

PARTIDOS:

${gamesSummary}

Responde SOLO JSON válido, sin markdown:
{
  "picks": [
    {
      "matchup": "<away> @ <home>",
      "market": "<JC|H|K|Solo|SI_NO|HCE|Linea|RL>",
      "pick_summary": "<máx 15 palabras>",
      "confidence_pct": <0-100, tu juicio calibrado>,
      "expert_reasoning": "<2-3 oraciones; menciona si usaste ML claro, alternativa o calibración>"
    }
  ],
  "overall_analysis": "<2-3 oraciones sobre la calidad del card de hoy y el mix de mercados>"
}

Ordena picks de mayor a menor confianza real.`;

    const { res: groqRes, data: groqData, usedFailover } = await callGroqWithFailover({
      model: "llama-3.3-70b-versatile",
      max_tokens: 4000,
      temperature: 0.35,
      messages: [
        {
          role: "system",
          content:
            "Analista sharp MLB. Card mixto: ML claro + diversidad. Prefiere alternativa si está cerca del best. Respeta calibración. JSON válido sin markdown.",
        },
        { role: "user", content: prompt },
      ],
    });

    if (usedFailover) console.log("Expert-picks used secondary Groq key");

    if (!groqRes.ok || groqData.error) {
      const errMsg = groqData.error?.message || `Groq status ${groqRes.status}`;
      return res.status(502).json({ error: `Error de Groq AI: ${errMsg}` });
    }

    const text = groqData.choices?.[0]?.message?.content || "";
    const clean = text.replace(/```json|```/g, "").trim();

    let result;
    try {
      result = JSON.parse(clean);
    } catch (parseErr) {
      return res.status(502).json({
        error: "Groq devolvió una respuesta mal formada. Intenta de nuevo.",
        details: parseErr.message,
      });
    }

    const avoidSet = new Set(
      (Array.isArray(calibration) ? calibration : []).filter((c) => c.avoid).map((c) => c.market)
    );

    let ponchesCount = 0;
    let f5Count = 0;
    let siNoCount = 0;
    const finalPicks = [];
    const deferred = [];

    for (const pick of result.picks || []) {
      if (pick.market === "K") {
        if (ponchesCount >= MAX_PONCHES_PICKS) continue;
        ponchesCount++;
      }
      if (pick.market === "H") {
        if (f5Count >= MAX_F5) continue;
        f5Count++;
      }
      if (pick.market === "SI_NO") {
        if (siNoCount >= MAX_SI_NO) continue;
        siNoCount++;
      }
      if (avoidSet.has(pick.market)) {
        deferred.push(pick);
        continue;
      }
      finalPicks.push(pick);
    }
    for (const pick of deferred) {
      if (finalPicks.length >= requestedCount) break;
      finalPicks.push({
        ...pick,
        expert_reasoning: `${pick.expert_reasoning || ""} [Nota: mercado con historial débil]`.trim(),
      });
    }

    return res.status(200).json({
      picks: finalPicks.slice(0, requestedCount),
      overallAnalysis: result.overall_analysis || null,
      totalGamesConsidered: games.length,
      provider: "groq",
      calibrationApplied: Array.isArray(calibration) && calibration.length > 0,
      selectionRules: "A+B+F",
    });
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({
      error: "Error al generar picks expertos",
      details: err.message,
    });
  }
}
