// api/news-context.js — Vercel Serverless Function
// Searches recent news for a specific matchup (injuries, lineup changes, rumors).
// Runs automatically right after each fresh analysis, and can also be re-triggered
// manually via the "🔍 Buscar noticias" button.
//
// COST OPTIMIZATION: uses a cheap first-pass relevance check (small prompt, ~200
// output tokens) to decide if any news actually matters for this game. Only if
// something IS relevant does it proceed to the expensive full re-analysis (sending
// the entire previous analysis back and regenerating it). This keeps the common
// case (no relevant news found) far cheaper than the previous always-full-rerun approach.

const NEWSDATA_API = "https://newsdata.io/api/1/news";
const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";

async function searchTeamNews(teamName) {
  const apiKey = process.env.NEWSDATA_API_KEY;
  if (!apiKey) return [];

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 3);
  const fromDateStr = fromDate.toISOString().split("T")[0];

  const runQuery = async (query) => {
    const url = `${NEWSDATA_API}?apikey=${apiKey}&q=${encodeURIComponent(query)}&language=en,es&category=sports&size=5&from_date=${fromDateStr}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.results) return [];
    return data.results.slice(0, 5).map(article => ({
      title: article.title,
      description: article.description || "",
      pubDate: article.pubDate,
      source: article.source_id,
      link: article.link,
    }));
  };

  try {
    // More specific query targeting the kind of news that actually changes a
    // pick: injuries, lineup changes, pitcher swaps — not generic season news.
    const specificResults = await runQuery(
      `"${teamName}" AND (injury OR injured OR lineup OR "starting pitcher" OR suspended OR "day-to-day")`
    );
    if (specificResults.length > 0) return specificResults;

    // Fallback: broader recent-news search if nothing specific was found,
    // so we don't lose all coverage on days without breaking news.
    return await runQuery(`"${teamName}" MLB`);
  } catch {
    return [];
  }
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

  const first = await attempt(primaryKey);
  const isRateLimited = first.res.status === 429 || first.data?.error?.code === "rate_limit_exceeded";

  if (isRateLimited && secondaryKey) {
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

  const { home, away, previousAnalysis } = req.body;
  if (!home || !away || !previousAnalysis) {
    return res.status(400).json({ error: "home, away, and previousAnalysis are required" });
  }

  try {
    // 1. Search news for both teams in parallel
    const [homeNews, awayNews] = await Promise.all([
      searchTeamNews(home),
      searchTeamNews(away),
    ]);

    const allNews = [...homeNews, ...awayNews];

    if (allNews.length === 0) {
      return res.status(200).json({
        newsFound: false,
        message: "No se encontraron noticias recientes relevantes para este partido.",
        analysis: previousAnalysis, // unchanged
      });
    }

    // 2. Build news context block
    const newsBlock = allNews
      .map(n => `- [${n.source}, ${n.pubDate}] ${n.title}${n.description ? `: ${n.description}` : ""}`)
      .join("\n");

    // 3a. CHEAP FIRST PASS: only ask if any news is relevant enough to warrant a
    // full re-analysis, and why — WITHOUT sending the full previous analysis back
    // or asking for a full JSON regeneration. This is a small, fast, low-token call
    // that covers the common case (no relevant news) at a fraction of the cost.
    const relevancePrompt = `Eres un analista experto de MLB. Partido: ${away} (visitante) vs ${home} (local).

NOTICIAS RECIENTES ENCONTRADAS:
${newsBlock}

¿Alguna de estas noticias es específicamente relevante para EL RESULTADO de este partido (ej. lesión de un jugador clave que juega hoy, cambio de abridor confirmado de último momento, suspensión, cambio de alineación titular)? Noticias genéricas de temporada, resultados de otros partidos, o análisis general NO cuentan como relevantes.

Responde SOLO con JSON, sin markdown: {"relevant": true|false, "reason": "<1 oración explicando qué noticia es relevante y por qué, o por qué ninguna aplica>"}`;

    const { res: relevanceRes, data: relevanceData } = await callGroqWithFailover({
      model: "llama-3.3-70b-versatile",
      max_tokens: 200,
      temperature: 0.2,
      messages: [
        { role: "system", content: "Respondes siempre con JSON válido únicamente, sin texto adicional ni markdown." },
        { role: "user", content: relevancePrompt },
      ],
    });

    if (!relevanceRes.ok || relevanceData.error) {
      return res.status(502).json({
        error: `Error de Groq AI: ${relevanceData.error?.message || "desconocido"}`,
      });
    }

    const relevanceText = relevanceData.choices?.[0]?.message?.content || "";
    const relevanceClean = relevanceText.replace(/```json|```/g, "").trim();

    let relevanceResult;
    try {
      relevanceResult = JSON.parse(relevanceClean);
    } catch {
      // If the cheap check itself fails to parse, don't waste tokens on the
      // expensive path — just report no relevant news found.
      return res.status(200).json({
        newsFound: false,
        message: "No se encontraron noticias recientes relevantes para este partido.",
        analysis: previousAnalysis,
      });
    }

    if (!relevanceResult.relevant) {
      return res.status(200).json({
        newsFound: true,
        newsUsed: allNews,
        relevanceOnly: true,
        message: relevanceResult.reason || "Ninguna noticia encontrada cambia el análisis de este partido.",
        analysis: previousAnalysis, // unchanged — no expensive re-analysis needed
      });
    }

    // 3b. EXPENSIVE PATH: only reached when the cheap check found something
    // genuinely relevant. Now (and only now) we send the full previous analysis
    // and ask for a complete, coherence-checked update.
    const prompt = `Eres un analista experto de MLB. Ya generaste un análisis previo para el partido ${away} (visitante) vs ${home} (local), el cual se incluye abajo en JSON.

Se detectó una noticia relevante: ${relevanceResult.reason}

NOTICIAS RECIENTES:
${newsBlock}

ANÁLISIS PREVIO (antes de conocer estas noticias):
${JSON.stringify(previousAnalysis)}

Actualiza el análisis (probabilidades, best_method, alternative_method, y cualquier campo afectado) reflejando este nuevo contexto, y agrega un campo "news_impact" explicando qué noticia influyó y cómo cambió tu análisis.

Antes de responder, verifica que todos los campos actualizados sean coherentes entre sí (el equipo favorecido en el Moneyline debe ser generalmente consistente con pitching_edge, batting_edge, proyecciones de carreras, y run_line, salvo razón específica justificada).

Responde SOLO con el JSON completo actualizado (misma estructura que el análisis previo, agregando "news_impact"), sin markdown ni texto adicional.`;

    const { res: groqRes, data: groqData } = await callGroqWithFailover({
      model: "llama-3.3-70b-versatile",
      max_tokens: 3000,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: "Eres un analista experto de béisbol MLB. Responde siempre con JSON válido únicamente, sin texto adicional ni markdown.",
        },
        { role: "user", content: prompt },
      ],
    });

    if (!groqRes.ok || groqData.error) {
      return res.status(502).json({
        error: `Error de Groq AI: ${groqData.error?.message || "desconocido"}`,
      });
    }

    const text = groqData.choices?.[0]?.message?.content || "";
    const clean = text.replace(/```json|```/g, "").trim();

    let updatedAnalysis;
    try {
      updatedAnalysis = JSON.parse(clean);
    } catch {
      return res.status(502).json({ error: "La IA devolvió una respuesta mal formada al reprocesar con noticias." });
    }

    return res.status(200).json({
      newsFound: true,
      newsUsed: allNews,
      analysis: updatedAnalysis,
    });
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: "Error al buscar noticias o reprocesar análisis", details: err.message });
  }
}
