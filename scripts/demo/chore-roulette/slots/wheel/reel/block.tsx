import { useEffect, useRef, useState } from "react";

const CYCLES = 14;

export default function SlotReel({ crew, chore, spinSeconds, accent, rowHeight, housing, motionBlur, scanlines, buttonLabel }) {
  const strip = Array.from({ length: CYCLES }, () => crew).flat();
  const [index, setIndex] = useState(1);
  const [phase, setPhase] = useState("idle");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  function pull() {
    if (phase === "spinning") return;
    const n = crew.length;
    // Jump back to the same name near the top of the strip, then roll forward, so every pull spins the same way.
    setPhase("rewind");
    setIndex((i) => (i % n) + n);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setIndex(n * (CYCLES - 2) + Math.floor(Math.random() * n));
        setPhase("spinning");
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setPhase("landed"), spinSeconds * 1000);
      }),
    );
  }

  const winner = phase === "landed" ? strip[index] : null;
  const blur = phase === "spinning" ? { None: 0, Soft: 1.5, Heavy: 4 }[motionBlur] ?? 0 : 0;

  return (
    <div
      className="reel-app"
      data-part="screen"
      data-housing={housing.toLowerCase()}
      style={{ "--accent": accent, "--row": `${rowHeight}px` }}
    >
      <div className="status" aria-hidden>
        <span>21:04</span>
        <span>5G ▮▮▮▯</span>
      </div>
      <header className="masthead">
        <span className="brand" data-part="logo">
          Chore<b>Slots</b>
        </span>
        <span className="credits">1 swap left</span>
      </header>

      <section className="ticket" data-part="chore">
        <span className="ticket-label">Tonight</span>
        <span className="ticket-name">{chore.name}</span>
        <span className="ticket-due">{chore.due}</span>
      </section>

      <div className="machine" data-part="machine">
        <div className={`lights${phase === "spinning" ? " running" : ""}`} aria-hidden>
          {Array.from({ length: 9 }, (_, i) => (
            <i key={i} style={{ animationDelay: `${i * 90}ms` }} />
          ))}
        </div>
        <div className="window" data-part="reel-window">
          <div
            className="strip"
            data-part="reel"
            style={{
              transform: `translateY(calc(var(--row) * ${1 - index}))`,
              transition: phase === "spinning" ? `transform ${spinSeconds}s cubic-bezier(.2,.75,.12,1)` : "none",
              filter: blur > 0 ? `blur(${blur}px)` : "none",
            }}
          >
            {strip.map((p, i) => (
              <div key={i} className="cell" style={{ "--c": p.color }}>
                {p.name}
              </div>
            ))}
          </div>
          <div className="payline" aria-hidden />
          {scanlines && <div className="scan" aria-hidden />}
        </div>
      </div>

      <button type="button" className="pull" data-part="pull-button" onClick={pull} disabled={phase === "spinning"}>
        {phase === "spinning" ? "Rolling" : buttonLabel}
      </button>

      <p className="verdict" data-part="verdict" aria-live="polite">
        {winner ? (
          <>
            Jackpot: <b style={{ color: winner.color }}>{winner.name}</b> is on {chore.name.toLowerCase()}.
          </>
        ) : (
          "Every name is on the reel the same number of times."
        )}
      </p>
    </div>
  );
}
