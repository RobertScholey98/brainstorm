import { useEffect, useRef, useState } from "react";

const FONTS = {
  "Cascadia Mono": '"Cascadia Mono", Consolas, monospace',
  Consolas: "Consolas, monospace",
  "Courier New": '"Courier New", Courier, monospace',
  "Lucida Console": '"Lucida Console", monospace',
};

export default function TerminalDraw({ crew, chore, tickMs, accent, cursor, showPoints, prompt, font }) {
  const [active, setActive] = useState(-1);
  const [phase, setPhase] = useState("idle");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const fewest = Math.min(...crew.map((p) => p.points));

  function run() {
    if (phase === "running") return;
    const weights = crew.map((p) => 1 / (p.points + 1));
    let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
    let pick = crew.length - 1;
    for (let i = 0; i < weights.length; i++) {
      if (roll < weights[i]) {
        pick = i;
        break;
      }
      roll -= weights[i];
    }
    const steps = crew.length * 4 + pick + 1;
    setPhase("running");
    let step = 0;
    const tick = () => {
      setActive(step % crew.length);
      step += 1;
      if (step >= steps) {
        setPhase("done");
        return;
      }
      // Each tick slows a little, like a list settling on a name.
      timer.current = setTimeout(tick, tickMs * (1 + (step / steps) ** 3 * 5));
    };
    tick();
  }

  const winner = phase === "done" ? crew[active] : null;

  return (
    <div className="term" data-part="screen" data-cursor={cursor.toLowerCase()} style={{ "--accent": accent, "--font": FONTS[font] ?? FONTS["Cascadia Mono"] }}>
      <div className="titlebar" aria-hidden>
        <i />
        <i />
        <i />
        <span>flat-07 — chore.sh</span>
      </div>

      <div className="log" data-part="log">
        <p>
          <span className="ps1">flat-07:~$</span> {prompt}
        </p>
        <p className="muted">chore ........ {chore.name.toLowerCase()} (due {chore.due})</p>
        <p className="muted">crew ......... {crew.length} found, 0 away</p>
        <p className="muted">odds ......... 1 / (points + 1)</p>
      </div>

      <div className="table" role="list" data-part="crew-table">
        <div className="row head" aria-hidden>
          <span>crew</span>
          {showPoints && <span>pts</span>}
        </div>
        {crew.map((p, i) => (
          <div
            key={p.name}
            role="listitem"
            className="row"
            data-part={`row-${p.name}`}
            data-active={i === active || undefined}
            data-winner={(winner && winner.name === p.name) || undefined}
          >
            <span>
              <span className="mark">{i === active ? "▶" : " "}</span>
              {p.name.toUpperCase()}
              {p.points === fewest && <span className="tag">due</span>}
            </span>
            {showPoints && <span className="pts">{p.points}</span>}
          </div>
        ))}
      </div>

      <div className="result" data-part="result" aria-live="polite">
        {winner ? (
          <>
            <p className="ok">[ok] assigned {chore.name.toLowerCase()} → {winner.name.toUpperCase()}</p>
            <p className="muted">notified {winner.name}. exit 0</p>
          </>
        ) : phase === "running" ? (
          <p className="muted">drawing…</p>
        ) : (
          <p className="muted">ready.</p>
        )}
      </div>

      <button type="button" className="run" data-part="run-button" onClick={run} disabled={phase === "running"}>
        <span className="ps1">$</span> {phase === "done" ? "run again" : "run draw"}
        <span className="cursor" aria-hidden />
      </button>
    </div>
  );
}
