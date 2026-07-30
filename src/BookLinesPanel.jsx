// src/BookLinesPanel.jsx — Upload / paste sportsbook lines .txt
import { useRef, useState } from "react";
import { parseBookLines } from "./bookLines.js";

const panelStyle = {
  background: "#142235",
  border: "1px solid #1e3a52",
  borderRadius: "12px",
  padding: "16px",
  marginBottom: "16px",
};

export default function BookLinesPanel({ bookLines, onBookLinesChange }) {
  const fileRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [localError, setLocalError] = useState("");
  const [fileName, setFileName] = useState("");

  const games = bookLines?.games || [];
  const loaded = games.length > 0;

  const applyText = (text, name = "") => {
    const parsed = parseBookLines(text);
    if (parsed.games.length === 0 && parsed.errors.length > 0) {
      setLocalError(parsed.errors[0] || "No se pudo leer el archivo");
      return;
    }
    setLocalError("");
    setFileName(name || "texto pegado");
    onBookLinesChange(parsed);
    setOpen(true);
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      applyText(text, file.name);
    } catch {
      setLocalError("No se pudo leer el archivo");
    }
    // allow re-selecting the same file
    e.target.value = "";
  };

  const handlePasteLoad = () => {
    if (!pasteText.trim()) {
      setLocalError("Pega el contenido del .txt primero");
      return;
    }
    applyText(pasteText, "pegado");
  };

  const handleClear = () => {
    onBookLinesChange({ date: null, games: [], errors: [] });
    setPasteText("");
    setFileName("");
    setLocalError("");
  };

  return (
    <div style={panelStyle}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          background: "none",
          border: "none",
          width: "100%",
          padding: 0,
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: "13px", fontWeight: 700, color: "#F0F4F8" }}>
          📋 Líneas de la banca{" "}
          {loaded ? (
            <span style={{ color: "#2D6A4F", fontWeight: 600 }}>
              · {games.length} partido{games.length !== 1 ? "s" : ""}
              {bookLines.date ? ` · ${bookLines.date}` : ""}
            </span>
          ) : (
            <span style={{ color: "#7a9ab8", fontWeight: 400 }}>· opcional</span>
          )}
        </span>
        <span style={{ color: "#4A90D9", fontSize: "12px" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ marginTop: "14px" }}>
          <p style={{ fontSize: "11px", color: "#7a9ab8", margin: "0 0 12px", lineHeight: 1.4 }}>
            Sube el .txt de la pizarra (o pégalo). La app funciona igual sin él; con líneas puedes
            comparar proyecciones vs la banca. Formato: una línea por partido separada por |
          </p>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              style={{
                background: "linear-gradient(135deg, #2D6A4F, #1a4a35)",
                border: "none",
                color: "#fff",
                borderRadius: "8px",
                padding: "10px 16px",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              📁 Subir .txt
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,text/plain"
              onChange={handleFile}
              style={{ display: "none" }}
            />
            {loaded && (
              <button
                type="button"
                onClick={handleClear}
                style={{
                  background: "transparent",
                  border: "1px solid #c0392b",
                  color: "#c0392b",
                  borderRadius: "8px",
                  padding: "10px 14px",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                🗑️ Quitar líneas
              </button>
            )}
          </div>

          <div style={{ marginBottom: "10px" }}>
            <div style={{ fontSize: "10px", color: "#4A90D9", letterSpacing: "0.1em", marginBottom: "6px" }}>
              O PEGAR TEXTO
            </div>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="# FECHA: 2026-07-30&#10;away|home|pitcher_a|k_a|..."
              rows={3}
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "#0f1e2e",
                border: "1px solid #1e3a52",
                borderRadius: "8px",
                color: "#F0F4F8",
                padding: "10px",
                fontSize: "11px",
                fontFamily: "ui-monospace, monospace",
                resize: "vertical",
              }}
            />
            <button
              type="button"
              onClick={handlePasteLoad}
              style={{
                marginTop: "8px",
                background: "#0f1e2e",
                border: "1px solid #4A90D9",
                color: "#4A90D9",
                borderRadius: "8px",
                padding: "8px 14px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Cargar texto pegado
            </button>
          </div>

          {localError && (
            <p style={{ color: "#e74c3c", fontSize: "12px", margin: "0 0 8px" }}>{localError}</p>
          )}

          {bookLines?.errors?.length > 0 && (
            <p style={{ color: "#F4A261", fontSize: "11px", margin: "0 0 8px" }}>
              Avisos: {bookLines.errors.slice(0, 3).join(" · ")}
              {bookLines.errors.length > 3 ? "…" : ""}
            </p>
          )}

          {loaded && (
            <div style={{ marginTop: "8px" }}>
              <div style={{ fontSize: "11px", color: "#2D6A4F", marginBottom: "6px" }}>
                ✅ Cargado desde {fileName}
                {bookLines.date ? ` · Fecha: ${bookLines.date}` : ""}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "160px", overflowY: "auto" }}>
                {games.map((g, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: "11px",
                      color: "#c5d8ea",
                      background: "#0f1e2e",
                      borderRadius: "6px",
                      padding: "6px 10px",
                    }}
                  >
                    <strong style={{ color: "#F0F4F8" }}>
                      {g.away} @ {g.home}
                    </strong>
                    {" · "}
                    ML {g.mlAway != null ? (g.mlAway > 0 ? `+${g.mlAway}` : g.mlAway) : "—"}/
                    {g.mlHome != null ? (g.mlHome > 0 ? `+${g.mlHome}` : g.mlHome) : "—"}
                    {g.total != null && ` · Total ${g.total}`}
                    {g.kAway != null && ` · K ${g.pitcherAway || "V"} ${g.kAway}`}
                    {g.kHome != null && ` · K ${g.pitcherHome || "L"} ${g.kHome}`}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
