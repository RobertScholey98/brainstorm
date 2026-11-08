import { createRoot } from "react-dom/client";
import { createApi } from "./api";
import { App } from "./App";
import "./styles.css";

// While the width changes, body carries data-window-resizing into the frame after the one that lays the new width out,
// so the panes that follow it move with it rather than slide. Two frames: a frame asked for during the resize runs
// before that same frame's style pass.
let settle = 0;
addEventListener("resize", () => {
  document.body.dataset.windowResizing = "";
  cancelAnimationFrame(settle);
  settle = requestAnimationFrame(() => (settle = requestAnimationFrame(() => delete document.body.dataset.windowResizing)));
});

/** The UI token from the hash, which is then wiped from the URL and history; the token is held in memory only. */
function takeToken(): string | null {
  const token = new URLSearchParams(location.hash.slice(1)).get("ui");
  history.replaceState(null, "", location.pathname);
  return token;
}

const root = createRoot(document.getElementById("root") as HTMLElement);
const token = takeToken();
if (token !== null) root.render(<App api={createApi(token)} />);
else {
  root.render(
    <div className="grid h-full place-items-center px-8 text-center text-sm text-fg-muted">
      This page needs Brainstorm's window. Open Brainstorm from its app, or run a brainstorm command to start it.
    </div>,
  );
  // A page that loaded again without the token (a reload) gets it back from the window as a change of hash alone.
  addEventListener("hashchange", function arrived() {
    const late = takeToken();
    if (late === null) return;
    removeEventListener("hashchange", arrived);
    root.render(<App api={createApi(late)} />);
  });
}
