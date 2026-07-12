// api/news-context.js — Vercel Serverless Function
// Searches recent news for a specific matchup (injuries, lineup changes, rumors),
// then re-runs the Groq analysis incorporating that context. Triggered on-demand
// only, per game, from the "🔍 Buscar noticias" button — never automatic.

const NEWSDATA_API = "https://newsdata.io/api/1/news";
const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";

async function searchTeamNews(teamName) {
  const apiKey = process.env.NEWSDATA_API_KEY;
  if (!apiKey) return [];

  try {
    const query = encodeURIComponent(`"${teamName}" MLB`);
    const url = `${NEWSDATA_API}?apikey=${apiKey}&q=${query}&language=en,es&category=sports&size=5`;
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

    // 3. Ask Groq to re-evaluate the existing analysis with this new context
    const prompt = `Eres un analista experto de MLB. Ya generaste un análisis previo para el partido ${away} (visitante) vs ${home} (local), el cual se incluye abajo en JSON.

Ahora recibiste NOTICIAS RECIENTES relacionadas con estos equipos:
${newsBlock}

ANÁLISIS PREVIO (antes de conocer estas noticias):
${JSON.stringify(previousAnalysis, null, 2)}

Tu tarea: evalúa si alguna de estas noticias es relevante para el partido (ej. lesión de un jugador clave, cambio de abridor de último momento, suspensión, rumores de alineación). 

Si NINGUNA noticia es relevante o aplicable a este partido específico, responde con el análisis previo SIN CAMBIOS.

Si alguna noticia SÍ es relevante, actualiza el análisis (probabilidades, best_method, alternative_method, y cualquier campo afectado) reflejando ese nuevo contexto, y agrega un campo nuevo "news_impact" explicando qué noticia influyó y cómo cambió tu análisis.

Responde SOLO con el JSON completo actualizado (misma estructura que el análisis previo, agregando "news_impact" como string, o "news_impact": null si no hubo cambios), sin markdown ni texto adicional.`;

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
