import { useState } from "react";

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
    <div style={{
      background: "#142235", border: "1px solid #1e3a52",
      borderRadius: "10px", padding: "16px"
    }}>
      <div style={{ fontSize: "11px", color: "#4A90D9", letterSpacing: "0.15em", marginBottom: "8px" }}>
        {icon} {title}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px", flexWrap: "wrap" }}>
        <span style={{
          fontSize: "22px", fontWeight: 900, color: pickColor
        }}>{pick}</span>
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

export default function MLBPredictor() {
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [realStats, setRealStats] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showStats, setShowStats] = useState(false);

  const analyze = async () => {
    if (!home || !away || home === away) {
      setError("Selecciona dos equipos diferentes.");
      return;
    }
    setError("");
    setResult(null);
    setRealStats(null);
    setShowStats(false);
    setLoading(true);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ home, away }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error del servidor");
      setResult(data.analysis);
      setRealStats(data.realStats);
    } catch (e) {
      setError(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    const text = `=== MLB PREDICTOR — ANÁLISIS CON DATOS REALES ===
PARTIDO: ${away} (V) vs ${home} (L)
FUENTE: MLB Stats API ${new Date().getFullYear()} + Claude AI

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

  const selectStyle = {
    width: "100%", background: "#142235", border: "1px solid #1e3a52",
    color: "#F0F4F8", borderRadius: "8px", padding: "12px",
    fontSize: "14px", cursor: "pointer", outline: "none",
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

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: "32px" }}>
        <div style={{ fontSize: "11px", letterSpacing: "0.25em", color: "#4A90D9", textTransform: "uppercase", marginBottom: "6px" }}>
          ⚾ MLB Stats API · Claude AI · Datos Reales
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

      {/* Selectors */}
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

      {/* CTA */}
      <div style={{ textAlign: "center", marginBottom: "32px" }}>
        <button onClick={analyze} disabled={loading} style={{
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

          {/* Top actions */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "8px" }}>
            <span style={{ fontSize: "12px", color: "#2D6A4F", fontWeight: 600 }}>
              ✅ Stats reales obtenidos de MLB Stats API
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => setShowStats(!showStats)} style={{
                background: "#142235", border: "1px solid #1e3a52", color: "#4A90D9",
                borderRadius: "6px", padding: "8px 14px", fontSize: "12px",
                fontWeight: 600, cursor: "pointer",
              }}>
                {showStats ? "Ocultar Stats" : "📊 Ver Stats Reales"}
              </button>
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

          {/* Real Stats Panel */}
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
              {realStats.h2h.totalGames > 0 && (
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

          {/* Win Probability */}
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

          {/* Markets Grid */}
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

          {/* Edges */}
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

          {/* H2H + Final Take */}
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
    </div>
  );
}
