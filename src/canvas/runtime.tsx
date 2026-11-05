import * as React from "react";
import { Component, type ComponentType, type ReactNode, useSyncExternalStore } from "react";
import * as JSXRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import type { BlockId, CanvasFrame, CanvasMode, CanvasModule, CanvasPin, ContentHash, FrameToHost, HostToFrame, Props } from "../core/types";

type Loaded = { readonly ok: true; readonly component: ComponentType<Props> } | { readonly ok: false; readonly message: string };

type CanvasState = {
  readonly frames: readonly CanvasFrame[];
  readonly props: Readonly<Record<string, Props>>;
  readonly selected: BlockId | null;
  readonly mode: CanvasMode;
  readonly pins: readonly CanvasPin[];
  /** Which content each block shows. Modules are cached by hash, so a new hash is the only thing that remounts a block. */
  readonly hashes: ReadonlyMap<BlockId, ContentHash>;
};

const boot = JSON.parse(document.getElementById("brainstorm-boot")?.textContent ?? "{}") as {
  mode?: "live" | "export";
  messages?: HostToFrame[];
};
const live = boot.mode !== "export";

const post = (message: FrameToHost) => {
  if (live) window.parent.postMessage(message, "*");
};

const modules = new Map<ContentHash, Loaded>();
const styles = new Map<BlockId, HTMLStyleElement>();
const reported = new Set<string>();

function reportError(blockId: BlockId, hash: ContentHash | undefined, message: string): void {
  const key = `${blockId}@${hash}:${message}`;
  if (reported.has(key)) return;
  reported.add(key);
  post({ kind: "block_error", blockId, message });
}

const blockRequire = (name: string): unknown => {
  if (name === "react") return React;
  if (name === "react/jsx-runtime") return JSXRuntime;
  throw new Error(`blocks can only import react, not "${name}"`);
};

function load(m: CanvasModule): Loaded {
  try {
    const module = { exports: {} as { default?: unknown } };
    new Function("require", "module", "exports", m.compiled)(blockRequire, module, module.exports);
    const component = module.exports.default;
    return typeof component === "function"
      ? { ok: true, component: component as ComponentType<Props> }
      : { ok: false, message: "the module has no default-exported component" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

function applyCss(m: CanvasModule): void {
  let style = styles.get(m.blockId);
  if (m.css === null) {
    style?.remove();
    styles.delete(m.blockId);
    return;
  }
  if (style === undefined) {
    style = document.createElement("style");
    style.dataset.blockCss = m.blockId;
    document.head.append(style);
    styles.set(m.blockId, style);
  }
  // Block ids are kebab-case slot/variant pairs, so they are safe inside the attribute selector.
  style.textContent = `@scope ([data-bid="${m.blockId}"]) {\n${m.css}\n}`;
}

let state: CanvasState = { frames: [], props: {}, selected: null, mode: "view", pins: [], hashes: new Map() };
const listeners = new Set<() => void>();
const setState = (next: Partial<CanvasState>) => {
  state = { ...state, ...next };
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function receive(message: HostToFrame): void {
  switch (message.kind) {
    case "modules": {
      const hashes = new Map(state.hashes);
      for (const m of message.modules) {
        if (!modules.has(m.hash)) modules.set(m.hash, load(m));
        if (hashes.get(m.blockId) !== m.hash) applyCss(m);
        hashes.set(m.blockId, m.hash);
      }
      setState({ hashes });
      return;
    }
    case "state":
      setState({ frames: message.frames, props: message.props, selected: message.selected });
      return;
    case "mode":
      setState({ mode: message.mode });
      return;
    case "pins":
      setState({ pins: message.pins });
      return;
  }
}

const HOST_KINDS = new Set<string>(["modules", "state", "mode", "pins"] satisfies HostToFrame["kind"][]);

class BlockBoundary extends Component<
  { blockId: BlockId; hash: ContentHash; props: Props; children: ReactNode },
  { error: string | null }
> {
  override state: { error: string | null } = { error: null };

  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  override componentDidCatch(e: unknown) {
    reportError(this.props.blockId, this.props.hash, e instanceof Error ? e.message : String(e));
  }

  // A control change that broke the render gets another try once the props change again.
  override componentDidUpdate(previous: { props: Props }) {
    if (this.state.error !== null && previous.props !== this.props.props) this.setState({ error: null });
  }

  override render() {
    return this.state.error === null ? this.props.children : <BlockFailure message={this.state.error} />;
  }
}

function BlockFailure({ message }: { message: string }) {
  return (
    <div className="bs-failure" role="alert">
      <strong>This block failed to render</strong>
      <span>{message}</span>
    </div>
  );
}

function Block({ frame, hash, props }: { frame: CanvasFrame; hash: ContentHash | undefined; props: Props }) {
  const loaded = hash === undefined ? undefined : modules.get(hash);
  if (hash === undefined || loaded === undefined) return null;
  if (!loaded.ok) {
    reportError(frame.blockId, hash, loaded.message);
    return <BlockFailure message={loaded.message} />;
  }
  const Rendered = loaded.component;
  return (
    <BlockBoundary key={hash} blockId={frame.blockId} hash={hash} props={props}>
      <div data-bid={frame.blockId} style={{ display: "contents" }}>
        <Rendered {...props} />
      </div>
    </BlockBoundary>
  );
}

function Canvas() {
  const s = useSyncExternalStore(subscribe, () => state);
  return (
    <>
      {s.frames.map((frame) => {
        const selected = s.selected === frame.blockId;
        return (
          <section
            key={frame.slot}
            className="bs-frame"
            data-slot={frame.slot}
            data-selected={selected || undefined}
            onPointerDownCapture={() => post({ kind: "select_block", blockId: frame.blockId })}
          >
            <header className="bs-frame-title">
              <span>{frame.title}</span>
              <span className="bs-frame-size">
                {frame.frame.width} × {frame.frame.height ?? "auto"}
              </span>
            </header>
            <div className="bs-frame-body" style={{ width: frame.frame.width, height: frame.frame.height ?? undefined }}>
              <Block frame={frame} hash={s.hashes.get(frame.blockId)} props={s.props[frame.blockId] ?? {}} />
            </div>
          </section>
        );
      })}
    </>
  );
}

const CHROME_CSS = `
:root {
  color-scheme: light dark;
  --bs-canvas: #ebecef;
  --bs-dot: #d3d5da;
  --bs-title: #5d636c;
  --bs-frame: #ffffff;
  --bs-edge: rgb(15 18 25 / 0.1);
  --bs-shadow: 0 1px 2px rgb(15 18 25 / 0.06), 0 12px 32px -16px rgb(15 18 25 / 0.28);
  --bs-accent: #3b63e6;
  --bs-danger: #c4352b;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bs-canvas: #121316;
    --bs-dot: #26282d;
    --bs-title: #959aa3;
    --bs-frame: #1b1c20;
    --bs-edge: rgb(255 255 255 / 0.08);
    --bs-shadow: 0 1px 2px rgb(0 0 0 / 0.4), 0 16px 40px -16px rgb(0 0 0 / 0.7);
    --bs-accent: #7593ff;
    --bs-danger: #ff8a7f;
  }
}
html, body { margin: 0; min-height: 100%; }
html { scrollbar-width: thin; scrollbar-color: var(--bs-dot) transparent; }
body {
  background-color: var(--bs-canvas);
  background-image: radial-gradient(var(--bs-dot) 1px, transparent 1.2px);
  background-size: 16px 16px;
  font: 12px/1.4 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
}
#canvas { display: flex; align-items: flex-start; gap: 56px; padding: 40px 48px 64px; width: max-content; }
.bs-frame { flex: none; }
.bs-frame-title {
  display: flex; justify-content: space-between; gap: 12px;
  margin: 0 2px 8px; color: var(--bs-title); font-weight: 500; cursor: default; user-select: none;
}
.bs-frame-size { font-variant-numeric: tabular-nums; opacity: 0.7; font-weight: 400; }
.bs-frame[data-selected] .bs-frame-title { color: var(--bs-accent); }
.bs-frame-body {
  position: relative; overflow: auto; isolation: isolate;
  background: var(--bs-frame); border-radius: 4px;
  box-shadow: 0 0 0 1px var(--bs-edge), var(--bs-shadow);
  transition: box-shadow 120ms ease-out;
}
.bs-frame[data-selected] .bs-frame-body { box-shadow: 0 0 0 2px var(--bs-accent), var(--bs-shadow); }
.bs-failure {
  display: grid; gap: 4px; margin: 16px; padding: 12px 14px; border-radius: 6px;
  color: var(--bs-danger); background: color-mix(in srgb, var(--bs-danger) 10%, transparent);
  font: 12px/1.45 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; white-space: pre-wrap;
}
`;

const chrome = document.createElement("style");
chrome.textContent = CHROME_CSS;
document.head.prepend(chrome);

document.addEventListener("securitypolicyviolation", (e) =>
  post({ kind: "csp_violation", directive: e.effectiveDirective, blockedUri: e.blockedURI }),
);

window.addEventListener("message", (e: MessageEvent) => {
  if (!live || e.source !== window.parent || window.parent === window) return;
  const data = e.data as { kind?: unknown } | null;
  if (typeof data?.kind === "string" && HOST_KINDS.has(data.kind)) receive(data as HostToFrame);
});

for (const message of boot.messages ?? []) receive(message);
const root = document.getElementById("canvas");
if (root !== null) createRoot(root).render(<Canvas />);
post({ kind: "ready" });
