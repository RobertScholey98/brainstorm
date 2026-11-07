import { useEffect, useRef, useState } from "react";

const PALETTES = {
  "Night city": { bg: "#07070d", panel: "#10101c", line: "#2b2b48", text: "#ecebff", dim: "#a3a2c8", hub: "#00f0ff" },
  Synthwave: { bg: "#13071f", panel: "#1e0c33", line: "#43246b", text: "#ffe9fb", dim: "#c9a6dc", hub: "#ff9e3d" },
  Acid: { bg: "#050806", panel: "#0b140d", line: "#1f3a25", text: "#ecffea", dim: "#9ec5a0", hub: "#d4ff3b" },
  Ice: { bg: "#060b12", panel: "#0c1622", line: "#22364d", text: "#e8f6ff", dim: "#9fb8cc", hub: "#7fdcff" },
};

const R = 138;
const C = 150;

function point(turn, radius) {
  const a = turn * 2 * Math.PI;
  return [C + radius * Math.sin(a), C - radius * Math.cos(a)];
}

function slicePath(start, end) {
  const [x0, y0] = point(start, R);
  const [x1, y1] = point(end, R);
  return `M${C},${C} L${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 ${end - start > 0.5 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`;
}

const initials = (name) => name.slice(0, 2).toUpperCase();

export default function NeonWheel({ crew, chore, spinSeconds, accent, glow, labelStyle, fairOdds, spinLabel, palette }) {
  const theme = PALETTES[palette] ?? PALETTES["Night city"];
  const raw = crew.map((p) => (fairOdds ? 1 / (p.points + 1) : 1));
  const total = raw.reduce((a, b) => a + b, 0);
  let cursor = 0;
  const slices = crew.map((person, i) => {
    const start = cursor;
    cursor += raw[i] / total;
    return { person, start, end: cursor, share: raw[i] / total };
  });

  const [turns, setTurns] = useState(0);
  const [phase, setPhase] = useState({ kind: "idle" });
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  function spin() {
    if (phase.kind === "spinning") return;
    let roll = Math.random();
    let pick = slices[slices.length - 1];
    for (const s of slices) {
      if (roll < s.share) {
        pick = s;
        break;
      }
      roll -= s.share;
    }
    const centre = (pick.start + pick.end) / 2;
    setTurns(Math.floor(turns) + 5 + (1 - centre));
    setPhase({ kind: "spinning" });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPhase({ kind: "landed", person: pick.person }), spinSeconds * 1000);
  }

  const landed = phase.kind === "landed" ? phase.person : null;
  const label = (p, share) => (labelStyle === "Initials" ? initials(p.name) : labelStyle === "Points" ? `${Math.round(share * 100)}%` : p.name);

  return (
    <div
      className="neon"
      data-part="screen"
      style={{
        "--accent": accent,
        "--glow": `${glow}px`,
        "--bg": theme.bg,
        "--panel": theme.panel,
        "--line": theme.line,
        "--text": theme.text,
        "--dim": theme.dim,
        "--hub": theme.hub,
      }}
    >
      <div className="status" aria-hidden>
        <span>21:04</span>
        <span>5G ▮▮▮▯</span>
      </div>

      <header className="top">
        <div className="logo" data-part="logo">
          CHORE<span>//</span>ROULETTE
        </div>
        <div className="crew" data-part="crew">
          {crew.map((p) => (
            <span key={p.name} className="avatar" style={{ "--c": p.color }} title={p.name}>
              {p.name[0]}
            </span>
          ))}
        </div>
      </header>

      <section className="chore" data-part="chore">
        <div className="eyebrow">Up next</div>
        <div className="chore-name">{chore.name}</div>
        <div className="chore-due">Due {chore.due}</div>
      </section>

      <div className="stage">
        <svg className="pointer" data-part="pointer" viewBox="0 0 24 20" aria-hidden>
          <path d="M12 20 L0 0 L24 0 Z" />
        </svg>
        <svg className="wheel" viewBox="0 0 300 300" data-part="wheel" role="img" aria-label={`Wheel with ${crew.length} people`}>
          <circle cx={C} cy={C} r={R + 7} className="rim" />
          <g
            data-part="wheel-rotor"
            style={{
              transform: `rotate(${turns * 360}deg)`,
              transformOrigin: `${C}px ${C}px`,
              transition: `transform ${spinSeconds}s cubic-bezier(.12,.7,.14,1)`,
            }}
          >
            {slices.map(({ person, start, end, share }) => {
              const [lx, ly] = point((start + end) / 2, R * 0.64);
              return (
                <g key={person.name} data-part={`slice-${person.name}`}>
                  <path d={slicePath(start, end)} fill={person.color} fillOpacity={landed && landed.name !== person.name ? 0.28 : 0.9} className="slice" />
                  <text x={lx} y={ly} className="slice-label" textAnchor="middle" dominantBaseline="central">
                    {label(person, share)}
                  </text>
                </g>
              );
            })}
          </g>
          <circle cx={C} cy={C} r="34" className="hub" data-part="hub" />
          <text x={C} y={C} className="hub-text" textAnchor="middle" dominantBaseline="central">
            {landed ? initials(landed.name) : phase.kind === "spinning" ? "···" : "?"}
          </text>
        </svg>
      </div>

      <button type="button" className="spin" data-part="spin-button" onClick={spin} disabled={phase.kind === "spinning"}>
        {phase.kind === "spinning" ? "Spinning" : spinLabel}
      </button>

      <p className="pool" data-part="pool" aria-live="polite">
        {landed ? (
          <>
            <b style={{ color: landed.color }}>{landed.name}</b> takes {chore.name.toLowerCase()}.
          </>
        ) : fairOdds ? (
          <>
            <b>{crew.length} in the pool.</b> Odds lean towards whoever has done least.
          </>
        ) : (
          <>
            <b>{crew.length} in the pool.</b> Everyone has the same odds.
          </>
        )}
      </p>
    </div>
  );
}
