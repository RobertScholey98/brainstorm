import { useState } from "react";

const FONTS = {
  "Cascadia Mono": '"Cascadia Mono", Consolas, monospace',
  Consolas: "Consolas, monospace",
  "Courier New": '"Courier New", Courier, monospace',
  "Lucida Console": '"Lucida Console", monospace',
};

function bars(text) {
  const out = [];
  for (let i = 0; i < 38; i++) {
    const c = text.charCodeAt(i % text.length) + i * 7;
    out.push({ w: 1 + (c % 3), gap: 1 + ((c >> 2) % 2) });
  }
  return out;
}

export default function Receipt({ winner, chore, crew, ticket, paper, printSeconds, showOdds, edge, typeface, footer }) {
  const [prints, setPrints] = useState(0);
  const weights = crew.map((p) => 1 / (p.points + 1));
  const total = weights.reduce((a, b) => a + b, 0);

  return (
    <div className="receipt-app" data-part="screen" style={{ "--paper": paper, "--print": `${printSeconds}s`, "--mono": FONTS[typeface] ?? FONTS["Cascadia Mono"] }}>
      <div className="slot" aria-hidden />
      <div className="feed">
        <div key={prints} className="paper" data-part="paper" data-edge={edge.toLowerCase()}>
          <p className="center strong">CHORE//ROULETTE</p>
          <p className="center">flat 07 · ticket {String(ticket).padStart(5, "0")}</p>
          <p className="rule" aria-hidden />
          <p className="row">
            <span>CHORE</span>
            <span data-part="chore">{chore.name.toUpperCase()}</span>
          </p>
          <p className="row">
            <span>DUE</span>
            <span>{chore.due.toUpperCase()}</span>
          </p>
          <p className="rule" aria-hidden />
          <p className="center">ASSIGNED TO</p>
          <p className="winner" data-part="winner">
            {winner.name.toUpperCase()}
          </p>
          {showOdds && (
            <div data-part="odds">
              <p className="rule" aria-hidden />
              {crew.map((p, i) => (
                <p key={p.name} className="row">
                  <span>{p.name.toUpperCase()}</span>
                  <span>{Math.round((weights[i] / total) * 100)}%</span>
                </p>
              ))}
            </div>
          )}
          <p className="rule" aria-hidden />
          <div className="barcode" aria-hidden>
            {bars(chore.name + winner.name).map((b, i) => (
              <i key={i} style={{ width: b.w, marginRight: b.gap }} />
            ))}
          </div>
          <p className="center small" data-part="footer">
            {footer}
          </p>
        </div>
      </div>
      <button type="button" className="reprint" data-part="reprint-button" onClick={() => setPrints((n) => n + 1)}>
        Print again
      </button>
    </div>
  );
}
