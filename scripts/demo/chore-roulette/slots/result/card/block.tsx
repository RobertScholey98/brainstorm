import { useState } from "react";

export default function AssignmentCard({ winner, chore, swapsLeft, headline, accent, nameSize, glitch, density, stamp }) {
  const [state, setState] = useState("pending");
  const [swaps, setSwaps] = useState(swapsLeft);

  return (
    <div className="card-app" data-part="screen" data-density={density.toLowerCase()} style={{ "--accent": accent, "--who": winner.color, "--name-size": `${nameSize}px` }}>
      <article className="card" data-part="card">
        <p className="headline" data-part="headline">
          {headline}
        </p>
        <h1 className={glitch ? "name glitch" : "name"} data-part="winner" data-text={winner.name}>
          {winner.name}
        </h1>
        <p className="task" data-part="chore">
          {chore.name}
        </p>

        <dl className="facts" data-part="facts">
          <div>
            <dt>Due</dt>
            <dd>{chore.due}</dd>
          </div>
          <div>
            <dt>Points</dt>
            <dd>
              {winner.points} → {winner.points + chore.points}
            </dd>
          </div>
          <div>
            <dt>Swaps</dt>
            <dd>{swaps} left</dd>
          </div>
        </dl>

        {state === "accepted" && (
          <div className="stamp" data-part="stamp" aria-live="polite">
            {stamp}
          </div>
        )}
      </article>

      <div className="actions">
        <button type="button" className="accept" data-part="accept-button" disabled={state === "accepted"} onClick={() => setState("accepted")}>
          {state === "accepted" ? "Accepted" : "Accept"}
        </button>
        <button
          type="button"
          className="swap"
          data-part="swap-button"
          disabled={swaps === 0 || state === "accepted"}
          onClick={() => {
            setSwaps((s) => s - 1);
            setState("swap-asked");
          }}
        >
          {state === "swap-asked" ? "Swap asked" : "Ask to swap"}
        </button>
      </div>
      <p className="fine" data-part="fine">
        {state === "swap-asked" ? "The crew gets 10 minutes to take it off you." : "Accepting tells the crew it's handled."}
      </p>
    </div>
  );
}
