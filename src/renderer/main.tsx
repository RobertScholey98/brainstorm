import { createRoot } from "react-dom/client";
import { createApi } from "./api";
import { App } from "./App";
import "./styles.css";

// The UI token arrives in the hash once; it is held in memory only and wiped from the URL and history.
const token = new URLSearchParams(location.hash.slice(1)).get("ui");
history.replaceState(null, "", location.pathname);

// While the width changes, body carries data-window-resizing into the frame after the one that lays the new width out,
// so the panes that follow it move with it rather than slide. Two frames: a frame asked for during the resize runs
// before that same frame's style pass.
let settle = 0;
addEventListener("resize", () => {
  document.body.dataset.windowResizing = "";
  cancelAnimationFrame(settle);
  settle = requestAnimationFrame(() => (settle = requestAnimationFrame(() => delete document.body.dataset.windowResizing)));
});

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(
  token === null ? (
    <div className="grid h-full place-items-center px-8 text-center text-sm text-fg-muted">
      This page needs Brainstorm's window. Open Brainstorm from its app, or run a brainstorm command to start it.
    </div>
  ) : (
    <App api={createApi(token)} />
  ),
);
