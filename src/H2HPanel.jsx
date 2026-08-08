import { useState } from "react";

const TEAMS = [
  "New York Yankees", "Los Angeles Dodgers", "Houston Astros", "Atlanta Braves",
  "Philadelphia Phillies", "Texas Rangers", "Baltimore Orioles", "Minnesota Twins",
  "Tampa Bay Rays", "Arizona Diamondbacks", "San Diego Padres", "San Francisco Giants",
  "Seattle Mariners", "Chicago Cubs", "Boston Red Sox", "Toronto Blue Jays",
  "New York Mets", "Milwaukee Brewers", "Cincinnati Reds", "Cleveland Guardians",
  "Detroit Tigers", "Miami Marlins", "Kansas City Royals", "Chicago White Sox",
  "Athletics", "Pittsburgh Pirates", "Colorado Rockies", "Washington Nationals",
  "St. Louis Cardinals", "Los Angeles Angels",
];

const selectStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "8px",
  border: "1px solid #1e3a52",
  background: "#0d1b2a",
  color: "#e8f0f8",
  fontSize: "14px",
};

export default function H2HPanel() {
  const [teamA, setTeamA] = useState("");
  const [teamB, setTeamB] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  const load = async () => {
    if (!teamA || !teamB) {
      setError("Selecciona los dos equipos");
      return;
    }
    if (teamA === teamB) {
      setError("Elige dos equipos distintos");
      return;
    }
    setLoading(true);
    setError("");
    setData(null);
    try {
      const q = new URLSearchParams({ team1: teamA, team2: teamB });
      const res = await fetch(`/api/h2h?${q}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al cargar");
      setData(json);
    } catch (e) {
      setError(e.message || "No se pudo cargar el H2H");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: "680px", margin: "0 auto" }}>
      <div style={{
        background: "#142235",
        border: "1px solid #1e3a52",
        borderRadius: "12px",
        padding: "20px",
        marginBottom: "16px",
      }}>
        <div style={{
          fontSize: "12px", color: "#4A90D9", letterSpacing: "0.12em",
          marginBottom: "12px", textAlign: "center",
        }}>
          ENFRENTAMIENTOS DE LA TEMPORADA
        </div>
        <p style={{ color: "#7a9ab8", fontSize: "13px", margin: "0 0 16px", textAlign: "center" }}>
          Elige dos equipos y verás todos sus partidos de esta temporada (fecha, marcador y ganador).
        </p>

        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          gap: "10px",
          alignItems: "end",
          marginBottom: "14px",
        }}>
          <div>
            <div style={{ fontSize: "11px", color: "#4A90D9", marginBottom: "6px", textAlign: "center" }}>EQUIPO A</div>
            <select value={teamA} onChange={(e) => setTeamA(e.target.value)} style={selectStyle}>
              <option value="">— Elegir —</option>
              {TEAMS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div style={{ color: "#4A90D9", fontWeight: 700, paddingBottom: "10px" }}>vs</div>
          <div>
            <div style={{ fontSize: "11px", color: "#4A90D9", marginBottom: "6px", textAlign: "center" }}>EQUIPO B</div>
            <select value={teamB} onChange={(e) => setTeamB(e.target.value)} style={selectStyle}>
              <option value="">— Elegir —</option>
              {TEAMS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={load}
          disabled={loading}
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: "8px",
            border: "none",
            background: loading ? "#1e3a52" : "#1a6bb5",
            color: "#fff",
            fontWeight: 600,
            fontSize: "14px",
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Cargando…" : "Ver enfrentamientos"}
        </button>

        {error && (
          <div style={{ marginTop: "12px", color: "#f07178", fontSize: "13px", textAlign: "center" }}>
            {error}
          </div>
        )}
      </div>

      {data && (
        <div style={{
          background: "#142235",
          border: "1px solid #1e3a52",
          borderRadius: "12px",
          padding: "20px",
        }}>
          <div style={{ textAlign: "center", marginBottom: "16px" }}>
            <div style={{ color: "#e8f0f8", fontWeight: 700, fontSize: "16px" }}>
              {data.team1.name} vs {data.team2.name}
            </div>
            <div style={{ color: "#7a9ab8", fontSize: "13px", marginTop: "4px" }}>
              Temporada {data.season} · {data.finalGames} finalizados
              {data.totalGames > data.finalGames ? ` · ${data.totalGames - data.finalGames} pendientes` : ""}
            </div>
            <div style={{
              marginTop: "12px",
              display: "flex",
              justifyContent: "center",
              gap: "24px",
              fontSize: "15px",
            }}>
              <span style={{ color: "#7dcea0" }}>
                {data.team1.name.split(" ").slice(-1)[0]} <strong>{data.team1.wins}</strong>
              </span>
              <span style={{ color: "#7a9ab8" }}>—</span>
              <span style={{ color: "#7dcea0" }}>
                <strong>{data.team2.wins}</strong> {data.team2.name.split(" ").slice(-1)[0]}
              </span>
            </div>
          </div>

          {data.games.length === 0 && (
            <p style={{ color: "#7a9ab8", textAlign: "center", fontSize: "13px" }}>
              No hay partidos entre estos equipos en la temporada {data.season}.
            </p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {data.games.map((g) => {
              const score =
                g.isFinal && g.away.score != null && g.home.score != null
                  ? `${g.away.score} – ${g.home.score}`
                  : "—";
              const winnerLabel = g.winnerName
                ? g.winnerName
                : g.isFinal
                  ? "Empate / N/D"
                  : g.status;
              const isA = g.winnerId === data.team1.id;
              const isB = g.winnerId === data.team2.id;

              return (
                <div
                  key={g.gamePk}
                  style={{
                    background: "#0d1b2a",
                    border: "1px solid #1e3a52",
                    borderRadius: "8px",
                    padding: "12px 14px",
                    display: "grid",
                    gridTemplateColumns: "90px 1fr auto",
                    gap: "10px",
                    alignItems: "center",
                    fontSize: "13px",
                  }}
                >
                  <div style={{ color: "#7a9ab8" }}>{g.date}</div>
                  <div>
                    <div style={{ color: "#e8f0f8" }}>
                      {g.away.name} <span style={{ color: "#4A90D9" }}>@</span> {g.home.name}
                    </div>
                    {g.venue && (
                      <div style={{ color: "#5a7a9a", fontSize: "11px", marginTop: "2px" }}>{g.venue}</div>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: "#e8f0f8", fontWeight: 600 }}>{score}</div>
                    <div style={{
                      color: isA || isB ? "#7dcea0" : "#7a9ab8",
                      fontSize: "11px",
                      marginTop: "2px",
                    }}>
                      {g.isFinal ? (g.winnerName ? `✅ ${winnerLabel}` : winnerLabel) : winnerLabel}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
