import { createRoot } from "react-dom/client";
import { createApi } from "./api";
import { App } from "./App";
import "./styles.css";

// The UI token arrives in the hash once; it is held in memory only and wiped from the URL and history.
const token = new URLSearchParams(location.hash.slice(1)).get("ui");
history.replaceState(null, "", location.pathname);

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
