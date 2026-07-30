/** Format optional sportsbook lines for the analyze prompt (0 tokens when absent). */
export function formatBookLinesBlock(bl, home, away) {
  if (!bl || typeof bl !== "object") return "";

  const fmtOdds = (n) => {
    if (n == null || n === "") return "—";
    const num = Number(n);
    if (isNaN(num)) return String(n);
    return num > 0 ? `+${num}` : String(num);
  };

  const lines = [
    "LÍNEAS DE LA BANCA (referencia real del día — úsalas como líneas de mercado):",
  ];

  if (bl.mlAway != null || bl.mlHome != null) {
    lines.push(`- Moneyline: ${away} ${fmtOdds(bl.mlAway)} | ${home} ${fmtOdds(bl.mlHome)}`);
  }
  if (bl.rl != null) {
    lines.push(`- Run Line spread: ${bl.rl}`);
  }
  if (bl.total != null) {
    lines.push(`- Total carreras (Linea): ${bl.total}`);
  }
  if (bl.soloAway != null || bl.soloHome != null) {
    lines.push(`- Solo carreras: ${away} ${bl.soloAway ?? "—"} | ${home} ${bl.soloHome ?? "—"}`);
  }
  if (bl.hce != null) {
    lines.push(`- HCE (carreras+hits+errores): ${bl.hce}`);
  }
  if (bl.kAway != null || bl.kHome != null) {
    const parts = [];
    if (bl.kAway != null) parts.push(`${bl.pitcherAway || away}: ${bl.kAway}`);
    if (bl.kHome != null) parts.push(`${bl.pitcherHome || home}: ${bl.kHome}`);
    lines.push(`- Ponches abridor: ${parts.join(" | ")}`);
  }
  if (bl.firstInningSi != null || bl.firstInningNo != null) {
    lines.push(`- 1er inning SI/NO cuotas: SI ${fmtOdds(bl.firstInningSi)} | NO ${fmtOdds(bl.firstInningNo)}`);
  }

  lines.push(
    "REGLA LÍNEAS: Si hay línea de banca para un mercado, USA ESA línea en el campo .line correspondiente (total_runs, home/away_team_runs, hce_total, strikeouts_*). Pick OVER/UNDER respecto a ella. Si tu proyección difiere ≥0.5 runs/K, menciónalo en reasoning como posible value."
  );

  return lines.join("\n") + "\n";
}
