import { useState, useEffect } from "react";

const TEAMS = [
  "New York Yankees", "Los Angeles Dodgers", "Houston Astros", "Atlanta Braves",
  "Philadelphia Phillies", "Texas Rangers", "Baltimore Orioles", "Minnesota Twins",
  "Tampa Bay Rays", "Arizona Diamondbacks", "San Diego Padres", "San Francisco Giants",
  "Seattle Mariners", "Chicago Cubs", "Boston Red Sox", "Toronto Blue Jays",
  "New York Mets", "Milwaukee Brewers", "Cincinnati Reds", "Cleveland Guardians",
  "Detroit Tigers", "Miami Marlins", "Kansas City Royals", "Chicago White Sox",
  "Oakland Athletics", "Pittsburgh Pirates", "Colorado Rockies", "Washington Nationals",
  "St. Louis Cardinals", "Los Angeles Angels",
];

const HISTORY_KEY = "mlb_predictor_history";
const MAX_HISTORY = 30;

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveToHistory(entry) {
  try {
    const current = loadHistory();
    const entryDay = entry.date.split("T")[0];
    // Remove any existing entry for the same matchup on the same day
    const filtered = current.filter(e => {
      const sameDay = e.date.split("T")[0] === entryDay;
      const sameMatchup = e.home === entry.home && e.away === entry.away;
      return !(sameDay && sameMatchup);
    });
    const updated = [entry, ...filtered].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return loadHistory();
  }
}

function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
}

// ---------- Track Record: independent accuracy tracking ----------
// This persists separately from history, so clearing history (30-item cap)
// never affects the long-term accuracy record.
const TRACK_RECORD_KEY = "mlb_predictor_track_record";

function loadTrackRecord() {
  try {
    const raw = localStorage.getItem(TRACK_RECORD_KEY);
    return raw ? JSON.parse(raw) : { total: 0, correct: 0, byBand: {} };
  } catch {
    return { total: 0, correct: 0, byBand: {} };
  }
}

function confidenceBand(pct) {
  if (pct >= 75) return "75-100";
  if (pct >= 65) return "65-74";
  if (pct >= 58) return "58-64";
  return "below-58";
}

function recordOutcome(entry, winner) {
  // winner: "home" | "away"
  const record = loadTrackRecord();
  const favoredPct = Math.max(entry.analysis.home_win_pct, entry.analysis.away_win_pct);
  const favoredSide = entry.analysis.home_win_pct >= entry.analysis.away_win_pct ? "home" : "away";
  const band = confidenceBand(favoredPct);
  const wasCorrect = favoredSide === winner;

  record.total += 1;
  if (wasCorrect) record.correct += 1;

  if (!record.byBand[band]) record.byBand[band] = { total: 0, correct: 0 };
  record.byBand[band].total += 1;
  if (wasCorrect) record.byBand[band].correct += 1;

  localStorage.setItem(TRACK_RECORD_KEY, JSON.stringify(record));
  return record;
}

function resetTrackRecord() {
  localStorage.removeItem(TRACK_RECORD_KEY);
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  const result = await Notification.requestPermission();
  return result;
}

function scheduleGameNotification(game) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const gameTime = new Date(game.gameDate).getTime();
  const notifyTime = gameTime - 15 * 60 * 1000;
  const now = Date.now();
  const delay = notifyTime - now;
  if (delay <= 0) return;
  const maxDelay = 2 * 60 * 60 * 1000;
  if (delay > maxDelay) return;
  setTimeout(() => {
    new Notification("⚾ Partido por comenzar", {
      body: `${game.away.name} @ ${game.home.name} empieza en 15 minutos`,
      icon: "/favicon.svg",
    });
  }, delay);
}

const DiamondLoader = () => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", padding: "40px" }}>
    <svg width="80" height="80" viewBox="0 0 80 80">
      <style>{`
        @keyframes pulse-base { 0%,100%{opacity:.3} 50%{opacity:1} }
        .b1{animation:pulse-base 1.2s ease-in-out 0s infinite}
        .b2{animation:pulse-base 1.2s ease-in-out .3s infinite}
        .b3{animation:pulse-base 1.2s ease-in-out .6s infinite}
        .b4{animation:pulse-base 1.2s ease-in-out .9s infinite}
      `}</style>
      <rect className="b1" x="37" y="4" width="6" height="6" rx="1" fill="#F4A261" transform="rotate(45 40 7)" />
      <rect className="b2" x="4" y="37" width="6" height="6" rx="1" fill="#2D6A4F" transform="rotate(45 7 40)" />
      <rect className="b3" x="70" y="37" width="6" height="6" rx="1" fill="#2D6A4F" transform="rotate(45 73 40)" />
      <rect className="b4" x="37" y="69" width="6" height="6" rx="1" fill="#F4A261" transform="rotate(45 40 72)" />
      <line x1="40" y1="12" x2="12" y2="40" stroke="#4A90D9" strokeWidth="1.5" opacity="0.5" />
      <line x1="40" y1="12" x2="68" y2="40" stroke="#4A90D9" strokeWidth="1.5" opacity="0.5" />
      <line x1="12" y1="40" x2="40" y2="68" stroke="#4A90D9" strokeWidth="1.5" opacity="0.5" />
      <line x1="68" y1="40" x2="40" y2="68" stroke="#4A90D9" strokeWidth="1.5" opacity="0.5" />
      <circle cx="40" cy="40" r="4" fill="#F0F4F8" opacity="0.8" />
    </svg>
    <p style={{ color: "#4A90D9", fontSize: "13px", letterSpacing: "0.15em", textTransform: "uppercase", margin: 0 }}>
      Obteniendo stats reales de MLB…
    </p>
    <p style={{ color: "#3a5a78", fontSize: "12px", margin: 0 }}>Consultando MLB Stats API + Análisis IA</p>
  </div>
);

const WinBar = ({ pct, color }) => (
  <div style={{ flex: 1, background: "#1a2d42", borderRadius: "4px", height: "8px", overflow: "hidden" }}>
    <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: "4px", transition: "width 1s ease" }} />
  </div>
);

const ConfidenceBadge = ({ pct }) => {
  const color = pct >= 70 ? "#2D6A4F" : pct >= 55 ? "#F4A261" : "#c0392b";
  const label = pct >= 70 ? "Alta" : pct >= 55 ? "Media" : "Baja";
  return (
    <span style={{
      background: color, color: "#fff", borderRadius: "12px",
      padding: "2px 10px", fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em"
    }}>
      {label} {pct}%
    </span>
  );
};

const StatCard = ({ label, value, highlight }) => (
  <div style={{
    background: "#0f1e2e", borderRadius: "6px", padding: "10px 12px",
    display: "flex", justifyContent: "space-between", alignItems: "center"
  }}>
    <span style={{ fontSize: "11px", color: "#4a6a88", letterSpacing: "0.05em" }}>{label}</span>
    <span style={{ fontSize: "14px", fontWeight: 700, color: highlight || "#F0F4F8" }}>{value}</span>
  </div>
);

const MarketCard = ({ icon, title, pick, line, confidence_pct, reasoning, pickColorYes, pickColorNo }) => {
  const isPositive = pick === "SI" || pick === "OVER";
  const pickColor = isPositive ? (pickColorYes || "#E63946") : (pickColorNo || "#2D6A4F");
  return (
    <div style={{ background: "#142235", border: "1px solid #1e3a52", borderRadius: "10px", padding: "16px" }}>
      <div style={{ fontSize: "11px", color: "#4A90D9", letterSpacing: "0.15em", marginBottom: "8px" }}>
        {icon} {title}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "22px", fontWeight: 900, color: pickColor }}>{pick}</span>
        {line !== undefined && (
          <span style={{ fontSize: "14px", color: "#7a9ab8" }}>línea: <strong style={{ color: "#F0F4F8" }}>{line}</strong></span>
        )}
        <ConfidenceBadge pct={confidence_pct} />
      </div>
      <p style={{ fontSize: "12px", color: "#7a9ab8", margin: 0, lineHeight: 1.5, fontStyle: "italic" }}>
        {reasoning}
      </p>
    </div>
  );
};

const TabButton = ({ active, onClick, children }) => (
  <button onClick={onClick} style={{
    background: active ? "#2D6A4F" : "transparent",
    color: active ? "#F0F4F8" : "#7a9ab8",
    border: `1px solid ${active ? "#2D6A4F" : "#1e3a52"}`,
    borderRadius: "8px", padding: "8px 16px", fontSize: "12px", fontWeight: 700,
    cursor: "pointer", letterSpacing: "0.05em", transition: "all 0.2s",
  }}>
    {children}
  </button>
);

export default function MLBPredictor() {
  const [tab, setTab] = useState("predictor");
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [realStats, setRealStats] = useState(null);
  const [gameContext, setGameContext] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showStats, setShowStats] = useState(false);

  const [todayGames, setTodayGames] = useState([]);
  const [loadingGames, setLoadingGames] = useState(false);
  const [gamesError, setGamesError] = useState("");

  const [history, setHistory] = useState([]);
  const [trackRecord, setTrackRecord] = useState({ total: 0, correct: 0, byBand: {} });
  const [verifying, setVerifying] = useState(false);

  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );

  useEffect(() => {
    const loadedHistory = loadHistory();
    setHistory(loadedHistory);
    setTrackRecord(loadTrackRecord());
    verifyPendingGames(loadedHistory);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Checks any past, unverified games against real MLB results,
  // updates the independent track record, and marks history entries as verified.
  const verifyPendingGames = async (currentHistory) => {
    const now = new Date();
    const pending = currentHistory.filter(e => {
      if (e.verified || !e.gamePk) return false;
      const entryDate = new Date(e.date);
      // Only check games from a previous day (game should be over by now)
      return entryDate.toDateString() !== now.toDateString();
    });

    if (pending.length === 0) return;

    setVerifying(true);
    try {
      const res = await fetch("/api/game-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gamePks: pending.map(e => e.gamePk) }),
      });
      const data = await res.json();
      const resultsByPk = {};
      (data.results || []).forEach(r => { resultsByPk[r.gamePk] = r; });

      let updatedHistory = loadHistory();
      let record = loadTrackRecord();

      pending.forEach(entry => {
        const gameResult = resultsByPk[entry.gamePk];
        if (gameResult && gameResult.final && gameResult.winner !== "tie") {
          record = recordOutcome(entry, gameResult.winner);
          updatedHistory = updatedHistory.map(e =>
            e.id === entry.id
              ? { ...e, verified: true, actualWinner: gameResult.winner, actualScore: `${gameResult.awayRuns}-${gameResult.homeRuns}` }
              : e
          );
        }
      });

      localStorage.setItem(HISTORY_KEY, JSON.stringify(updatedHistory));
      setHistory(updatedHistory);
      setTrackRecord(record);
    } catch {
      // Silent fail — verification will retry next time the app loads
    } finally {
      setVerifying(false);
    }
  };

  const handleResetTrackRecord = () => {
    resetTrackRecord();
    setTrackRecord({ total: 0, correct: 0, byBand: {} });
  };

  const analyze = async (homeTeam = home, awayTeam = away) => {
    if (!homeTeam || !awayTeam || homeTeam === awayTeam) {
      setError("Selecciona dos equipos diferentes.");
      return;
    }
    setError("");
    setResult(null);
    setRealStats(null);
    setGameContext(null);
    setShowStats(false);
    setLoading(true);
    setTab("predictor");
    setHome(homeTeam);
    setAway(awayTeam);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ home: homeTeam, away: awayTeam }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error del servidor");
      setResult(data.analysis);
      setRealStats(data.realStats);
      setGameContext(data.gameContext || null);

      const entry = {
        id: Date.now(),
        date: new Date().toISOString(),
        home: homeTeam,
        away: awayTeam,
        analysis: data.analysis,
        gamePk: data.gameContext?.gamePk || null,
        verified: false,
      };
      setHistory(saveToHistory(entry));
    } catch (e) {
      setError(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadTodayGames = async () => {
    setLoadingGames(true);
    setGamesError("");
    try {
      const res = await fetch("/api/today-games");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al cargar partidos");
      setTodayGames(data.games || []);

      if (notifPermission === "granted") {
        data.games?.forEach(g => {
          if (g.status === "Scheduled" || g.status === "Pre-Game") {
            scheduleGameNotification(g);
          }
        });
      }
    } catch (e) {
      setGamesError(`Error: ${e.message}`);
    } finally {
      setLoadingGames(false);
    }
  };

  useEffect(() => {
    if (tab === "today" && todayGames.length === 0 && !loadingGames) {
      loadTodayGames();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const handleEnableNotifications = async () => {
    const result = await requestNotificationPermission();
    setNotifPermission(result);
    if (result === "granted" && todayGames.length > 0) {
      todayGames.forEach(g => {
        if (g.status === "Scheduled" || g.status === "Pre-Game") {
          scheduleGameNotification(g);
        }
      });
    }
  };

  const handleCopy = () => {
    if (!result) return;
    const text = `=== MLB PREDICTOR — ANÁLISIS CON DATOS REALES ===
PARTIDO: ${away} (V) vs ${home} (L)
FUENTE: MLB Stats API ${new Date().getFullYear()} + Groq AI

PROBABILIDADES: ${away} ${result.away_win_pct}% | ${home} ${result.home_win_pct}%

[1ER INNING SI/NO]
¿Anotan?: ${result.first_inning?.scores} (Confianza: ${result.first_inning?.confidence_pct}%)
${result.first_inning?.reasoning}

[TOTAL CARRERAS]
Línea ${result.total_runs?.line} → ${result.total_runs?.pick} (${result.total_runs?.confidence_pct}%)
${result.total_runs?.reasoning}

[SOLO LOCAL — ${home}]
Línea ${result.home_team_runs?.line} → ${result.home_team_runs?.pick} (${result.home_team_runs?.confidence_pct}%)
${result.home_team_runs?.reasoning}

[SOLO VISITANTE — ${away}]
Línea ${result.away_team_runs?.line} → ${result.away_team_runs?.pick} (${result.away_team_runs?.confidence_pct}%)
${result.away_team_runs?.reasoning}

[PITCHING]: ${result.pitching_edge}
[BULLPEN]: ${result.bullpen_risk}
[BATEO]: ${result.batting_edge}
[H2H]: ${result.h2h_note}
[ANÁLISIS FINAL]: ${result.analyst_take}
================================================`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const handleClearHistory = () => {
    clearHistory();
    setHistory([]);
  };

  const loadFromHistory = (entry) => {
    setHome(entry.home);
    setAway(entry.away);
    setResult(entry.analysis);
    setRealStats(null);
    setGameContext(null);
    setTab("predictor");
  };

  const selectStyle = {
    width: "100%", background: "#142235", border: "1px solid #1e3a52",
    color: "#F0F4F8", borderRadius: "8px", padding: "12px",
    fontSize: "14px", cursor: "pointer", outline: "none",
  };

  const formatGameTime = (iso) => {
    try {
      return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#0D1B2A", color: "#F0F4F8",
      fontFamily: "'Segoe UI', system-ui, sans-serif", padding: "24px 16px",
    }}>
      <style>{`
        @keyframes fadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        select option { background: #142235; }
        button:hover:not(:disabled) { filter: brightness(1.1); }
      `}</style>

      <div style={{ textAlign: "center", marginBottom: "24px" }}>
        <div style={{ fontSize: "11px", letterSpacing: "0.25em", color: "#4A90D9", textTransform: "uppercase", marginBottom: "6px" }}>
          ⚾ MLB Stats API · Groq AI · Datos Reales
        </div>
        <h1 style={{
          fontSize: "clamp(28px, 6vw, 46px)", fontWeight: 900, margin: "0 0 6px",
          background: "linear-gradient(135deg, #F0F4F8 40%, #4A90D9)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>MLB PREDICTOR</h1>
        <p style={{ color: "#7a9ab8", fontSize: "13px", margin: 0 }}>
          Análisis estadístico con datos reales de la temporada {new Date().getFullYear()}
        </p>
      </div>

      <div style={{ display: "flex", gap: "8px", justifyContent: "center", marginBottom: "24px", flexWrap: "wrap" }}>
        <TabButton active={tab === "predictor"} onClick={() => setTab("predictor")}>⚾ Predictor</TabButton>
        <TabButton active={tab === "today"} onClick={() => setTab("today")}>📅 Partidos de Hoy</TabButton>
        <TabButton active={tab === "history"} onClick={() => setTab("history")}>🕓 Historial ({history.length})</TabButton>
        <TabButton active={tab === "track"} onClick={() => setTab("track")}>🎯 Track Record</TabButton>
      </div>

      {tab === "predictor" && (
        <>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "14px",
            alignItems: "center", maxWidth: "680px", margin: "0 auto 20px",
          }}>
            <div>
              <div style={{ fontSize: "11px", color: "#4A90D9", letterSpacing: "0.15em", marginBottom: "7px", textAlign: "center" }}>VISITANTE</div>
              <select value={away} onChange={e => setAway(e.target.value)} style={selectStyle}>
                <option value="">Seleccionar…</option>
                {TEAMS.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div style={{
              width: "40px", height: "40px", borderRadius: "50%",
              background: "#142235", border: "1px solid #2D6A4F",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "11px", fontWeight: 700, color: "#F4A261", flexShrink: 0,
            }}>VS</div>
            <div>
              <div style={{ fontSize: "11px", color: "#F4A261", letterSpacing: "0.15em", marginBottom: "7px", textAlign: "center" }}>LOCAL</div>
              <select value={home} onChange={e => setHome(e.target.value)} style={selectStyle}>
                <option value="">Seleccionar…</option>
                {TEAMS.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {error && <p style={{ color: "#e74c3c", textAlign: "center", fontSize: "13px", marginBottom: "14px" }}>{error}</p>}

          <div style={{ textAlign: "center", marginBottom: "32px" }}>
            <button onClick={() => analyze()} disabled={loading} style={{
              background: loading ? "#1e3a52" : "linear-gradient(135deg, #2D6A4F, #1a4a35)",
              color: loading ? "#4a6a88" : "#F0F4F8", border: "none", borderRadius: "8px",
              padding: "14px 36px", fontSize: "15px", fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer", letterSpacing: "0.05em",
              boxShadow: loading ? "none" : "0 4px 20px rgba(45,106,79,0.4)", transition: "all 0.2s",
            }}>
              {loading ? "Consultando MLB Stats API…" : "⚾ ANALIZAR CON DATOS REALES"}
            </button>
          </div>

          {loading && <DiamondLoader />}

          {result && !loading && (
            <div style={{ maxWidth: "680px", margin: "0 auto", animation: "fadeIn .5s ease" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "8px" }}>
                <span style={{ fontSize: "12px", color: "#2D6A4F", fontWeight: 600 }}>
                  ✅ Stats reales obtenidos de MLB Stats API
                </span>
                <div style={{ display: "flex", gap: "8px" }}>
                  {realStats && (
                    <button onClick={() => setShowStats(!showStats)} style={{
                      background: "#142235", border: "1px solid #1e3a52", color: "#4A90D9",
                      borderRadius: "6px", padding: "8px 14px", fontSize: "12px",
                      fontWeight: 600, cursor: "pointer",
                    }}>
                      {showStats ? "Ocultar Stats" : "📊 Ver Stats Reales"}
                    </button>
                  )}
                  <button onClick={handleCopy} style={{
                    background: copied ? "#2D6A4F" : "#142235",
                    border: `1px solid ${copied ? "#2D6A4F" : "#1e3a52"}`,
                    color: "#F0F4F8", borderRadius: "6px", padding: "8px 14px",
                    fontSize: "12px", fontWeight: 600, cursor: "pointer",
                  }}>
                    {copied ? "✅ Copiado" : "📋 Copiar"}
                  </button>
                </div>
              </div>

              {showStats && realStats && (
                <div style={{
                  background: "#142235", border: "1px solid #1e3a52", borderRadius: "12px",
                  padding: "20px", marginBottom: "16px", animation: "fadeIn .3s ease"
                }}>
                  <div style={{ fontSize: "12px", color: "#F4A261", letterSpacing: "0.15em", marginBottom: "14px" }}>
                    📊 STATS REALES — TEMPORADA {new Date().getFullYear()}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                    {[
                      { label: `🔵 ${away} (V)`, stats: realStats.away, color: "#4A90D9" },
                      { label: `🟠 ${home} (L)`, stats: realStats.home, color: "#F4A261" },
                    ].map(({ label, stats, color }) => (
                      <div key={label}>
                        <div style={{ fontSize: "12px", fontWeight: 700, color, marginBottom: "8px" }}>{label}</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <StatCard label="AVG" value={stats.avg} />
                          <StatCard label="OPS" value={stats.ops} highlight={color} />
                          <StatCard label="OBP" value={stats.obp} />
                          <StatCard label="ERA" value={stats.era} highlight={color} />
                          <StatCard label="WHIP" value={stats.whip} />
                          <StatCard label="K/9" value={stats.strikeoutsPer9} />
                          <StatCard label="Carreras" value={stats.runs} />
                          <StatCard label="Blown Saves" value={stats.blownSaves} />
                        </div>
                      </div>
                    ))}
                  </div>
                  {realStats.h2h?.totalGames > 0 && (
                    <div style={{ marginTop: "12px", padding: "10px", background: "#0f1e2e", borderRadius: "6px", textAlign: "center" }}>
                      <span style={{ fontSize: "12px", color: "#7a9ab8" }}>
                        H2H {new Date().getFullYear()}: <strong style={{ color: "#F4A261" }}>{home} {realStats.h2h.homeWins}W</strong>
                        {" — "}
                        <strong style={{ color: "#4A90D9" }}>{away} {realStats.h2h.awayWins}W</strong>
                        {" "}({realStats.h2h.totalGames} juegos)
                      </span>
                    </div>
                  )}
                </div>
              )}

              {gameContext && (gameContext.homePitcher || gameContext.awayPitcher) && (
                <div style={{
                  background: "linear-gradient(135deg, #142235, #16314a)", border: "1px solid #2D6A4F",
                  borderRadius: "12px", padding: "20px", marginBottom: "14px"
                }}>
                  <div style={{ fontSize: "11px", color: "#F4A261", letterSpacing: "0.15em", marginBottom: "14px" }}>
                    ⚾ ABRIDORES PROBABLES CONFIRMADOS
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                    <div>
                      <div style={{ fontSize: "11px", color: "#4A90D9", marginBottom: "4px" }}>VISITANTE — {away}</div>
                      {gameContext.awayPitcher ? (
                        <>
                          <div style={{ fontSize: "14px", fontWeight: 700, color: "#F0F4F8", marginBottom: "4px" }}>
                            {gameContext.awayPitcher.name}
                          </div>
                          <div style={{ fontSize: "11px", color: "#7a9ab8" }}>
                            ERA {gameContext.awayPitcher.era} · WHIP {gameContext.awayPitcher.whip} · K/9 {gameContext.awayPitcher.strikeoutsPer9}
                          </div>
                        </>
                      ) : (
                        <span style={{ fontSize: "12px", color: "#7a9ab8", fontStyle: "italic" }}>No confirmado aún</span>
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: "11px", color: "#F4A261", marginBottom: "4px" }}>LOCAL — {home}</div>
                      {gameContext.homePitcher ? (
                        <>
                          <div style={{ fontSize: "14px", fontWeight: 700, color: "#F0F4F8", marginBottom: "4px" }}>
                            {gameContext.homePitcher.name}
                          </div>
                          <div style={{ fontSize: "11px", color: "#7a9ab8" }}>
                            ERA {gameContext.homePitcher.era} · WHIP {gameContext.homePitcher.whip} · K/9 {gameContext.homePitcher.strikeoutsPer9}
                          </div>
                        </>
                      ) : (
                        <span style={{ fontSize: "12px", color: "#7a9ab8", fontStyle: "italic" }}>No confirmado aún</span>
                      )}
                    </div>
                  </div>
                  {gameContext.lineup && (gameContext.lineup.home || gameContext.lineup.away) && (
                    <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #1e3a52" }}>
                      <span style={{ fontSize: "11px", color: "#2D6A4F", fontWeight: 700 }}>
                        ✅ Alineación titular confirmada incluida en el análisis
                      </span>
                    </div>
                  )}
                </div>
              )}

              {result.data_confidence_note && (
                <p style={{
                  fontSize: "11px", color: "#7a9ab8", textAlign: "center",
                  marginBottom: "14px", fontStyle: "italic", padding: "0 8px"
                }}>
                  ℹ️ {result.data_confidence_note}
                </p>
              )}

              <div style={{ background: "#142235", border: "1px solid #1e3a52", borderRadius: "12px", padding: "20px", marginBottom: "14px" }}>
                <div style={{ fontSize: "11px", color: "#4A90D9", letterSpacing: "0.15em", marginBottom: "14px" }}>
                  PROBABILIDADES DE VICTORIA (MONEYLINE)
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", fontSize: "13px" }}>
                  <span style={{ color: "#4A90D9" }}>{away} <strong style={{ color: "#F0F4F8", fontSize: "18px" }}>{result.away_win_pct}%</strong></span>
                  <span style={{ color: "#F4A261" }}>{home} <strong style={{ color: "#F0F4F8", fontSize: "18px" }}>{result.home_win_pct}%</strong></span>
                </div>
                <div style={{ display: "flex", gap: "4px" }}>
                  <WinBar pct={result.away_win_pct} color="#4A90D9" />
                  <WinBar pct={result.home_win_pct} color="#F4A261" />
                </div>
              </div>


              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px" }}>
                <MarketCard
                  icon="🎯" title="1ER INNING (SI/NO)"
                  pick={result.first_inning?.scores}
                  confidence_pct={result.first_inning?.confidence_pct}
                  reasoning={result.first_inning?.reasoning}
                  pickColorYes="#E63946" pickColorNo="#2D6A4F"
                />
                <MarketCard
                  icon="📊" title="TOTAL CARRERAS"
                  pick={result.total_runs?.pick}
                  line={result.total_runs?.line}
                  confidence_pct={result.total_runs?.confidence_pct}
                  reasoning={result.total_runs?.reasoning}
                  pickColorYes="#F4A261" pickColorNo="#4A90D9"
                />
                <MarketCard
                  icon="🟠" title={`SOLO LOCAL — ${home}`}
                  pick={result.home_team_runs?.pick}
                  line={result.home_team_runs?.line}
                  confidence_pct={result.home_team_runs?.confidence_pct}
                  reasoning={result.home_team_runs?.reasoning}
                  pickColorYes="#F4A261" pickColorNo="#4A90D9"
                />
                <MarketCard
                  icon="🔵" title={`SOLO VISITANTE — ${away}`}
                  pick={result.away_team_runs?.pick}
                  line={result.away_team_runs?.line}
                  confidence_pct={result.away_team_runs?.confidence_pct}
                  reasoning={result.away_team_runs?.reasoning}
                  pickColorYes="#F4A261" pickColorNo="#4A90D9"
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "14px" }}>
                {[
                  { icon: "⚾", label: "PITCHING", value: result.pitching_edge },
                  { icon: "⚠️", label: "BULLPEN RISK", value: result.bullpen_risk },
                  { icon: "🏏", label: "BATEO", value: result.batting_edge },
                ].map(item => (
                  <div key={item.label} style={{ background: "#142235", border: "1px solid #1e3a52", borderRadius: "10px", padding: "14px" }}>
                    <div style={{ fontSize: "10px", color: "#4A90D9", letterSpacing: "0.12em", marginBottom: "6px" }}>
                      {item.icon} {item.label}
                    </div>
                    <p style={{ fontSize: "12px", color: "#c5d8ea", margin: 0, lineHeight: 1.5 }}>{item.value}</p>
                  </div>
                ))}
              </div>

              <div style={{ background: "linear-gradient(135deg,#142235,#0f1e2e)", border: "1px solid #1e3a52", borderRadius: "12px", padding: "20px" }}>
                <div style={{ marginBottom: "14px" }}>
                  <div style={{ fontSize: "11px", color: "#F4A261", letterSpacing: "0.15em", marginBottom: "6px" }}>⚔️ HEAD TO HEAD</div>
                  <p style={{ margin: 0, fontSize: "13px", color: "#c5d8ea", lineHeight: 1.5 }}>{result.h2h_note}</p>
                </div>
                <div style={{ borderTop: "1px solid #1e3a52", paddingTop: "14px" }}>
                  <div style={{ fontSize: "11px", color: "#4A90D9", letterSpacing: "0.15em", marginBottom: "6px" }}>🎙️ ANÁLISIS FINAL</div>
                  <p style={{ margin: 0, fontSize: "13px", color: "#c5d8ea", lineHeight: 1.6, fontStyle: "italic" }}>"{result.analyst_take}"</p>
                </div>
              </div>

              <p style={{ textAlign: "center", fontSize: "11px", color: "#3a5a78", marginTop: "14px" }}>
                Stats obtenidos de MLB Stats API oficial · Análisis generado por IA · Solo uso estadístico y de referencia.
              </p>
            </div>
          )}
        </>
      )}

      {tab === "today" && (
        <div style={{ maxWidth: "680px", margin: "0 auto", animation: "fadeIn .4s ease" }}>

          {notifPermission !== "granted" && notifPermission !== "unsupported" && (
            <div style={{
              background: "#142235", border: "1px solid #2D6A4F", borderRadius: "10px",
              padding: "14px 16px", marginBottom: "16px", display: "flex",
              justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px"
            }}>
              <span style={{ fontSize: "12px", color: "#c5d8ea" }}>
                🔔 Activa notificaciones para avisos 15 min antes de cada partido
              </span>
              <button onClick={handleEnableNotifications} style={{
                background: "#2D6A4F", border: "none", color: "#fff", borderRadius: "6px",
                padding: "8px 14px", fontSize: "12px", fontWeight: 700, cursor: "pointer",
              }}>
                Activar
              </button>
            </div>
          )}
          {notifPermission === "denied" && (
            <p style={{ fontSize: "11px", color: "#c0392b", textAlign: "center", marginBottom: "16px" }}>
              Notificaciones bloqueadas. Actívalas en la configuración del navegador.
            </p>
          )}
          {notifPermission === "granted" && (
            <p style={{ fontSize: "11px", color: "#2D6A4F", textAlign: "center", marginBottom: "16px" }}>
              ✅ Notificaciones activadas — recibirás avisos 15 min antes (mientras la app esté abierta)
            </p>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ fontSize: "16px", margin: 0, color: "#F0F4F8" }}>
              📅 Partidos de Hoy — {new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}
            </h2>
            <button onClick={loadTodayGames} disabled={loadingGames} style={{
              background: "#142235", border: "1px solid #1e3a52", color: "#4A90D9",
              borderRadius: "6px", padding: "6px 12px", fontSize: "11px", cursor: "pointer",
            }}>
              {loadingGames ? "..." : "🔄"}
            </button>
          </div>

          {loadingGames && <DiamondLoader />}
          {gamesError && <p style={{ color: "#e74c3c", textAlign: "center", fontSize: "13px" }}>{gamesError}</p>}

          {!loadingGames && !gamesError && todayGames.length === 0 && (
            <p style={{ textAlign: "center", color: "#7a9ab8", fontSize: "13px" }}>
              No hay partidos programados para hoy.
            </p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {todayGames.map(g => (
              <div key={g.gamePk} style={{
                background: "#142235", border: "1px solid #1e3a52", borderRadius: "12px",
                padding: "16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap"
              }}>
                <div style={{ flex: 1, minWidth: "200px" }}>
                  <div style={{ fontSize: "13px", color: "#F0F4F8", fontWeight: 600, marginBottom: "4px" }}>
                    {g.away.name} <span style={{ color: "#4a6a88" }}>@</span> {g.home.name}
                  </div>
                  <div style={{ fontSize: "11px", color: "#7a9ab8" }}>
                    {g.status === "Final"
                      ? `Final: ${g.away.score} - ${g.home.score}`
                      : `${formatGameTime(g.gameDate)} · ${g.status}`}
                    {g.venue && ` · ${g.venue}`}
                  </div>
                </div>
                <button onClick={() => analyze(g.home.name, g.away.name)} style={{
                  background: "linear-gradient(135deg, #2D6A4F, #1a4a35)", border: "none",
                  color: "#fff", borderRadius: "6px", padding: "8px 16px", fontSize: "11px",
                  fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
                }}>
                  ⚾ Analizar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "history" && (
        <div style={{ maxWidth: "680px", margin: "0 auto", animation: "fadeIn .4s ease" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ fontSize: "16px", margin: 0, color: "#F0F4F8" }}>🕓 Historial de Predicciones</h2>
            {history.length > 0 && (
              <button onClick={handleClearHistory} style={{
                background: "transparent", border: "1px solid #c0392b", color: "#c0392b",
                borderRadius: "6px", padding: "6px 12px", fontSize: "11px", cursor: "pointer",
              }}>
                🗑️ Borrar todo
              </button>
            )}
          </div>

          <p style={{ fontSize: "11px", color: "#3a5a78", marginBottom: "16px" }}>
            Guardado solo en este dispositivo · Máximo {MAX_HISTORY} predicciones
          </p>

          {history.length === 0 && (
            <p style={{ textAlign: "center", color: "#7a9ab8", fontSize: "13px", padding: "40px 0" }}>
              Aún no has hecho ninguna predicción.
            </p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {history.map(entry => (
              <div key={entry.id} onClick={() => loadFromHistory(entry)} style={{
                background: "#142235", border: "1px solid #1e3a52", borderRadius: "12px",
                padding: "16px", cursor: "pointer", transition: "all 0.2s",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#F0F4F8" }}>
                    {entry.away} <span style={{ color: "#4a6a88" }}>@</span> {entry.home}
                  </span>
                  <span style={{ fontSize: "10px", color: "#4a6a88" }}>
                    {new Date(entry.date).toLocaleDateString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "12px", fontSize: "11px", color: "#7a9ab8", flexWrap: "wrap" }}>
                  <span>ML: <strong style={{ color: "#F4A261" }}>{entry.analysis?.home_win_pct}%</strong> / <strong style={{ color: "#4A90D9" }}>{entry.analysis?.away_win_pct}%</strong></span>
                  <span>1er Inn: <strong style={{ color: entry.analysis?.first_inning?.scores === "SI" ? "#E63946" : "#2D6A4F" }}>{entry.analysis?.first_inning?.scores}</strong></span>
                  <span>Total: <strong style={{ color: "#F0F4F8" }}>{entry.analysis?.total_runs?.pick}</strong></span>
                  {entry.verified && (
                    (() => {
                      const favoredSide = entry.analysis.home_win_pct >= entry.analysis.away_win_pct ? "home" : "away";
                      const correct = favoredSide === entry.actualWinner;
                      return (
                        <span style={{ color: correct ? "#2D6A4F" : "#c0392b", fontWeight: 700 }}>
                          {correct ? "✅ Acertó" : "❌ Falló"} ({entry.actualScore})
                        </span>
                      );
                    })()
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "track" && (
        <div style={{ maxWidth: "680px", margin: "0 auto", animation: "fadeIn .4s ease" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <h2 style={{ fontSize: "16px", margin: 0, color: "#F0F4F8" }}>🎯 Track Record del Modelo</h2>
            {trackRecord.total > 0 && (
              <button onClick={handleResetTrackRecord} style={{
                background: "transparent", border: "1px solid #c0392b", color: "#c0392b",
                borderRadius: "6px", padding: "6px 12px", fontSize: "11px", cursor: "pointer",
              }}>
                🗑️ Reiniciar
              </button>
            )}
          </div>
          <p style={{ fontSize: "11px", color: "#3a5a78", marginBottom: "16px" }}>
            Independiente del historial · No se borra al limpiar el historial · Verificado automáticamente con MLB Stats API
          </p>

          {verifying && (
            <p style={{ fontSize: "12px", color: "#4A90D9", textAlign: "center", marginBottom: "16px" }}>
              🔄 Verificando resultados pendientes…
            </p>
          )}

          {trackRecord.total === 0 ? (
            <p style={{ textAlign: "center", color: "#7a9ab8", fontSize: "13px", padding: "40px 0" }}>
              Aún no hay partidos verificados. Los resultados se confirman automáticamente al abrir la app,
              un día después de haber hecho el análisis.
            </p>
          ) : (
            <>
              <div style={{
                background: "linear-gradient(135deg, #142235, #16314a)", border: "1px solid #2D6A4F",
                borderRadius: "12px", padding: "24px", textAlign: "center", marginBottom: "16px"
              }}>
                <div style={{ fontSize: "11px", color: "#4A90D9", letterSpacing: "0.15em", marginBottom: "8px" }}>
                  PRECISIÓN GENERAL (EQUIPO FAVORITO)
                </div>
                <div style={{ fontSize: "42px", fontWeight: 900, color: "#F4A261" }}>
                  {Math.round((trackRecord.correct / trackRecord.total) * 100)}%
                </div>
                <div style={{ fontSize: "12px", color: "#7a9ab8", marginTop: "4px" }}>
                  {trackRecord.correct} de {trackRecord.total} predicciones acertadas
                </div>
              </div>

              <div style={{ background: "#142235", border: "1px solid #1e3a52", borderRadius: "12px", padding: "20px" }}>
                <div style={{ fontSize: "11px", color: "#4A90D9", letterSpacing: "0.15em", marginBottom: "14px" }}>
                  PRECISIÓN POR NIVEL DE CONFIANZA
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {["75-100", "65-74", "58-64", "below-58"].map(band => {
                    const bandData = trackRecord.byBand[band];
                    if (!bandData || bandData.total === 0) return null;
                    const pct = Math.round((bandData.correct / bandData.total) * 100);
                    const labels = {
                      "75-100": "Confianza Alta (75%+)",
                      "65-74": "Confianza Media-Alta (65-74%)",
                      "58-64": "Confianza Media (58-64%)",
                      "below-58": "Confianza Baja (<58%)",
                    };
                    return (
                      <div key={band}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
                          <span style={{ color: "#c5d8ea" }}>{labels[band]}</span>
                          <span style={{ color: "#F0F4F8", fontWeight: 700 }}>{pct}% ({bandData.correct}/{bandData.total})</span>
                        </div>
                        <WinBar pct={pct} color={pct >= 55 ? "#2D6A4F" : "#c0392b"} />
                      </div>
                    );
                  })}
                </div>
              </div>

              <p style={{ textAlign: "center", fontSize: "11px", color: "#3a5a78", marginTop: "14px" }}>
                Referencia: incluso los mejores modelos profesionales de MLB rondan 60-65% de precisión sostenida.
                Muestras pequeñas (menos de 30-50 partidos) no son representativas.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
