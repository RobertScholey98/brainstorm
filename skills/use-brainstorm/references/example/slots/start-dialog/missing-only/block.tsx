import { useEffect, useState } from "react";

const surface = {
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontSize: 14,
  color: "#1f2328",
  background: "#ffffff",
  border: "1px solid #d0d7de",
  boxShadow: "0 8px 24px rgba(31, 35, 40, 0.12)",
  display: "flex",
  flexDirection: "column",
  padding: 20,
  margin: 16,
};
const heading = { margin: 0, fontSize: 18, fontWeight: 600 };
const muted = { margin: 0, color: "#59636e", lineHeight: 1.45 };
const field = { display: "flex", flexDirection: "column", gap: 6, fontWeight: 500 };
const input = { font: "inherit", fontWeight: 400, padding: 8, border: "1px solid #d0d7de", borderRadius: 6 };
const link = { font: "inherit", padding: 0, border: "none", background: "none", color: "inherit", textDecoration: "underline", cursor: "pointer" };

export default function StartDialog({ projects, draft, situation, accent, radius, density, showBranch, startLabel }) {
  const inferred = situation === "no-project" ? null : projects[0] ?? null;
  const [phase, setPhase] = useState("editing");
  const [attempts, setAttempts] = useState(0);
  const [projectId, setProjectId] = useState(inferred ? inferred.id : "");
  const [choosing, setChoosing] = useState(!inferred);
  const [message, setMessage] = useState(draft);

  useEffect(() => {
    setPhase("editing");
    setAttempts(0);
    setProjectId(inferred ? inferred.id : "");
    setChoosing(!inferred);
  }, [situation]);

  useEffect(() => {
    if (phase !== "starting") return;
    const fails = situation === "launch-fails" && attempts === 1;
    const timer = setTimeout(() => setPhase(fails ? "failed" : "started"), 900);
    return () => clearTimeout(timer);
  }, [phase, situation, attempts]);

  const project = projects.find((p) => p.id === projectId);
  const busy = phase === "starting";
  const ready = Boolean(project) && message.trim() !== "" && !busy;
  const gap = density === "compact" ? 10 : 16;
  const button = (primary) => ({
    font: "inherit",
    padding: "8px 14px",
    borderRadius: radius,
    border: primary ? "1px solid transparent" : "1px solid #d0d7de",
    background: primary ? accent : "transparent",
    color: primary ? "#ffffff" : "inherit",
    cursor: "pointer",
  });

  if (phase === "closed") {
    return (
      <div style={{ ...surface, boxShadow: "none", alignItems: "flex-start", borderRadius: radius }}>
        <button data-part="new-task-button" style={button(true)} onClick={() => setPhase("editing")}>
          New task
        </button>
      </div>
    );
  }

  if (phase === "started") {
    return (
      <section aria-label="Task started" data-part="started" style={{ ...surface, gap, borderRadius: radius }}>
        <h2 data-part="started-title" style={heading}>Agent started in {project.name}</h2>
        <p data-part="started-message" style={muted}>It received your message as its first instruction.</p>
        <button
          data-part="start-another"
          style={{ ...button(false), alignSelf: "flex-start" }}
          onClick={() => {
            setMessage("");
            setAttempts(0);
            setPhase("editing");
          }}
        >
          Start another task
        </button>
      </section>
    );
  }

  return (
    <section role="dialog" aria-label="Start a task" data-part="dialog" style={{ ...surface, gap, borderRadius: radius }}>
      <h2 data-part="title" style={heading}>Start a task</h2>
      {choosing || !project ? (
        <label data-part="project-field" style={field}>
          Project
          <select
            data-part="project-select"
            value={projectId}
            disabled={busy}
            onChange={(e) => setProjectId(e.target.value)}
            style={input}
          >
            <option value="" disabled>Choose a project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      ) : (
        <p data-part="recipient" style={muted}>
          A new agent in <strong>{project.name}</strong>
          {showBranch ? ` on ${project.branch}` : ""} receives this message.{" "}
          <button data-part="change-project" style={link} disabled={busy} onClick={() => setChoosing(true)}>
            Change
          </button>
        </p>
      )}
      <label data-part="message-field" style={field}>
        First message to the agent
        <textarea
          data-part="message-input"
          value={message}
          rows={density === "compact" ? 3 : 5}
          disabled={busy}
          onChange={(e) => setMessage(e.target.value)}
          style={{ ...input, resize: "vertical" }}
        />
      </label>
      <p data-part="message-help" style={muted}>Sent word for word. Nothing starts until you press {startLabel}.</p>
      {phase === "failed" ? (
        <p role="alert" data-part="launch-error" style={{ ...muted, color: "#cf222e" }}>
          The workspace was created, but the agent didn't start. Your message is kept, and trying again reuses the workspace.
        </p>
      ) : null}
      <div data-part="actions" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button data-part="cancel-button" style={button(false)} disabled={busy} onClick={() => setPhase("closed")}>
          Cancel
        </button>
        <button
          data-part="start-button"
          style={{ ...button(true), opacity: ready ? 1 : 0.5 }}
          disabled={!ready}
          onClick={() => {
            setAttempts((n) => n + 1);
            setPhase("starting");
          }}
        >
          {busy ? "Starting…" : phase === "failed" ? "Try again" : startLabel}
        </button>
      </div>
    </section>
  );
}
