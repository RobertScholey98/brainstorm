import { createRoot } from "react-dom/client";
import { createApi } from "./api";
import { App } from "./App";
import { PreviewWindow } from "./PreviewWindow";
import "./styles.css";

// Brainstorm's own window on macOS has the traffic lights over its top left (src/electron/main.ts), which styles.css
// leaves room for. Read from the user agent, since the renderer has no preload, and before the first paint, so the
// header never jumps. A browser on a Mac has no Electron in its user agent and keeps the full row.
if (/Macintosh/.test(navigator.userAgent) && /Electron\//.test(navigator.userAgent)) document.documentElement.dataset.trafficLights = "";

// While the width changes, body carries data-window-resizing into the frame after the one that lays the new width out,
// so the panes that follow it move with it rather than slide. Two frames: a frame asked for during the resize runs
// before that same frame's style pass.
let settle = 0;
addEventListener("resize", () => {
  document.body.dataset.windowResizing = "";
  cancelAnimationFrame(settle);
  settle = requestAnimationFrame(() => (settle = requestAnimationFrame(() => delete document.body.dataset.windowResizing)));
});

/**
 * The UI token from the hash, which is then wiped from the URL and history; the token is held in memory only. The hash
 * also says which window this page is: the main window, or the preview window (ADR 007).
 */
function takeToken(): { token: string; preview: boolean } | null {
  const hash = new URLSearchParams(location.hash.slice(1));
  const token = hash.get("ui");
  history.replaceState(null, "", location.pathname);
  return token === null ? null : { token, preview: hash.get("window") === "preview" };
}

const root = createRoot(document.getElementById("root") as HTMLElement);
const render = ({ token, preview }: { token: string; preview: boolean }) =>
  root.render(preview ? <PreviewWindow api={createApi(token)} /> : <App api={createApi(token)} />);
const taken = takeToken();
if (taken !== null) render(taken);
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
    render(late);
  });
}
