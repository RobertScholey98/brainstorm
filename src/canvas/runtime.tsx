import * as React from "react";
import { Component, type ComponentType, type ReactNode, useSyncExternalStore } from "react";
import * as JSXRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import type {
  BlockId,
  CanvasFrame,
  CanvasMode,
  CanvasModule,
  CanvasPin,
  CanvasVariant,
  ContentHash,
  FeedbackId,
  FrameToHost,
  HostToFrame,
  PartName,
  Pin,
  Props,
} from "../core/types";

type Loaded = { readonly ok: true; readonly component: ComponentType<Props> } | { readonly ok: false; readonly message: string };

type CanvasState = {
  readonly frames: readonly CanvasFrame[];
  readonly props: Readonly<Record<string, Props>>;
  readonly selected: BlockId | null;
  readonly mode: CanvasMode;
  readonly pins: readonly CanvasPin[];
  /** Export only: each slot's variants, for the in-page switcher. */
  readonly variants: Readonly<Record<string, readonly CanvasVariant[]>>;
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

let state: CanvasState = { frames: [], props: {}, selected: null, mode: "view", pins: [], variants: {}, hashes: new Map() };
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
      document.body.dataset.mode = message.mode;
      if (message.mode !== "pin") hover = null;
      setState({ mode: message.mode });
      return;
    case "pins":
      setState({ pins: message.pins });
      return;
    case "pulse":
      // A pulse can arrive just before its block renders, so the layout loop runs it once the pin is placed.
      wantedPulse = message.id;
      return;
    case "variants":
      setState({ variants: message.slots });
      return;
  }
}

const HOST_KINDS = new Set<string>(["modules", "state", "mode", "pins", "pulse", "variants"] satisfies HostToFrame["kind"][]);

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

function VariantSwitch({ frame, variants }: { frame: CanvasFrame; variants: readonly CanvasVariant[] }) {
  const choose = (blockId: BlockId) => setState({ frames: state.frames.map((f) => (f.slot === frame.slot ? { ...f, blockId } : f)) });
  return (
    <div className="bs-switch" role="radiogroup" aria-label={`${frame.title} variant`}>
      {variants.map((v) => (
        <button key={v.blockId} type="button" role="radio" aria-checked={v.blockId === frame.blockId} data-variant={v.blockId} onClick={() => choose(v.blockId)}>
          {v.title}
        </button>
      ))}
    </div>
  );
}

function Canvas() {
  const s = useSyncExternalStore(subscribe, () => state);
  return (
    <>
      {s.frames.map((frame) => {
        const selected = s.selected === frame.blockId;
        const variants = s.variants[frame.slot] ?? [];
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
            {variants.length > 1 && <VariantSwitch frame={frame} variants={variants} />}
            <div className="bs-frame-body" style={{ width: frame.frame.width, height: frame.frame.height ?? undefined }}>
              <Block frame={frame} hash={s.hashes.get(frame.blockId)} props={s.props[frame.blockId] ?? {}} />
              {s.pins
                .filter((p) => p.pin.blockId === frame.blockId)
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="bs-pin"
                    data-pin={p.id}
                    data-status={p.status}
                    aria-label={`Feedback ${p.id}`}
                    onClick={() => post({ kind: "pin_clicked", id: p.id })}
                  >
                    {p.id}
                  </button>
                ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

// Pins and the pick highlight are positioned every animation frame, because block code can move its parts at any time
// (transitions, state, resizes) and there is no event for all of those.

const PIN_SIZE = 20;
type Target = { readonly pin: Pin; readonly anchor: Element };
let hover: Target | null = null;
let wantedPulse: FeedbackId | null = null;
let lastPlacement = "";

/** The nearest data-part inside the block under `target`, or the whole block when there is none. */
function pickTarget(target: EventTarget | null): Target | null {
  if (!(target instanceof Element)) return null;
  const section = target.closest(".bs-frame");
  const body = section?.querySelector(".bs-frame-body");
  const wrapper = section?.querySelector("[data-bid]");
  if (body == null || wrapper == null) return null;
  const blockId = wrapper.getAttribute("data-bid") as BlockId;
  const part = wrapper.contains(target) ? target.closest("[data-part]") : null;
  const name = part?.getAttribute("data-part");
  return part != null && name && wrapper.contains(part)
    ? { pin: { blockId, part: name as PartName }, anchor: part }
    : { pin: { blockId, part: null }, anchor: body };
}

const visible = (el: Element) => el.getClientRects().length > 0;

function layoutPins(): void {
  const placed: FeedbackId[] = [];
  const detached: FeedbackId[] = [];
  const stacked = new Map<Element, number>();
  for (const { id, pin } of state.pins) {
    const wrapper = document.querySelector(`[data-bid="${pin.blockId}"]`);
    const marker = document.querySelector<HTMLElement>(`.bs-pin[data-pin="${id}"]`);
    const body = wrapper?.closest(".bs-frame-body");
    if (wrapper == null || marker == null || body == null) continue;
    const anchor = pin.part === null ? body : wrapper.querySelector(`[data-part="${CSS.escape(pin.part)}"]`);
    if (anchor === null || !visible(anchor)) {
      detached.push(id);
      delete marker.dataset.placed;
      continue;
    }
    placed.push(id);
    const index = stacked.get(anchor) ?? 0;
    stacked.set(anchor, index + 1);
    const b = body.getBoundingClientRect();
    let x: number;
    let y: number;
    if (anchor === body) {
      x = body.clientWidth - PIN_SIZE - 6;
      y = 6;
    } else {
      const r = anchor.getBoundingClientRect();
      x = r.right - b.left - body.clientLeft + body.scrollLeft - PIN_SIZE / 2;
      y = r.top - b.top - body.clientTop + body.scrollTop - PIN_SIZE / 2;
    }
    x = Math.min(Math.max(x - index * (PIN_SIZE + 2), 2), body.scrollWidth - PIN_SIZE - 2);
    y = Math.min(Math.max(y, 2), body.scrollHeight - PIN_SIZE - 2);
    const transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (marker.style.transform !== transform) marker.style.transform = transform;
    marker.dataset.placed = "";
    if (wantedPulse === id) {
      wantedPulse = null;
      marker.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      marker.classList.remove("bs-pulse");
      void marker.offsetWidth;
      marker.classList.add("bs-pulse");
    }
  }
  const placement = JSON.stringify([placed, detached]);
  if (placement !== lastPlacement) {
    lastPlacement = placement;
    post({ kind: "pin_placement", placed, detached });
  }
}

const highlight = document.createElement("div");
highlight.className = "bs-pick";
const highlightLabel = document.createElement("span");
highlight.append(highlightLabel);

function layoutHover(): void {
  if (state.mode !== "pin" || hover === null || !hover.anchor.isConnected) {
    delete highlight.dataset.on;
    return;
  }
  const r = hover.anchor.getBoundingClientRect();
  highlight.style.transform = `translate(${r.left}px, ${r.top}px)`;
  highlight.style.width = `${r.width}px`;
  highlight.style.height = `${r.height}px`;
  highlightLabel.textContent = hover.pin.part ?? "Whole block";
  highlight.dataset.on = "";
}

if (live) {
  document.body.append(highlight);
  // In pin mode a click pins instead of reaching the block, so it can't press the block's own buttons.
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick", "contextmenu"]) {
    window.addEventListener(
      type,
      (e) => {
        if (state.mode !== "pin" || (e.target instanceof Element && e.target.closest(".bs-pin") !== null)) return;
        e.preventDefault();
        e.stopPropagation();
        const target = type === "click" ? pickTarget(e.target) : null;
        if (target !== null) {
          const { clientX: x, clientY: y } = e as MouseEvent;
          post({ kind: "picked", pin: target.pin, at: { x, y } });
        }
      },
      true,
    );
  }
  window.addEventListener("pointermove", (e) => (hover = state.mode === "pin" ? pickTarget(e.target) : null), true);
  document.documentElement.addEventListener("pointerleave", () => (hover = null));
  const loop = () => {
    layoutPins();
    layoutHover();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
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
  --bs-addressed: #c77c00;
  --bs-confirmed: #2a9563;
  --bs-switch: rgb(15 18 25 / 0.06);
  --bs-switch-on: #ffffff;
  --bs-text: #1d1e22;
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
    --bs-addressed: #e9a23b;
    --bs-confirmed: #4cc38a;
    --bs-switch: rgb(255 255 255 / 0.06);
    --bs-switch-on: #2a2c31;
    --bs-text: #e7e8eb;
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
.bs-switch {
  display: flex; gap: 2px; margin: 0 0 8px; padding: 2px; border-radius: 6px; width: max-content; max-width: 100%;
  background: var(--bs-switch);
}
.bs-switch button {
  height: 24px; padding: 0 10px; border: 0; border-radius: 4px; background: transparent; color: var(--bs-title);
  font: 500 12px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; cursor: pointer;
}
.bs-switch button[aria-checked="true"] { background: var(--bs-switch-on); color: var(--bs-text); box-shadow: 0 0 0 1px var(--bs-edge), 0 1px 2px rgb(0 0 0 / 0.08); }
.bs-pin {
  --pin: var(--bs-accent);
  position: absolute; left: 0; top: 0; z-index: 2147483000; display: none; place-items: center;
  width: ${PIN_SIZE}px; height: ${PIN_SIZE}px; box-sizing: border-box; padding: 0;
  border: 2px solid #fff; border-radius: 10px 10px 10px 3px; background: var(--pin); color: #fff;
  font: 700 10px/1 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; font-variant-numeric: tabular-nums;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.35); cursor: pointer;
}
.bs-pin[data-placed] { display: grid; }
.bs-pin[data-status="addressed"] { --pin: var(--bs-addressed); }
.bs-pin[data-status="confirmed"] { --pin: var(--bs-confirmed); }
.bs-pin:hover { filter: brightness(1.1); }
.bs-pin.bs-pulse { animation: bs-pulse 650ms ease-out 2; }
@keyframes bs-pulse {
  0% { box-shadow: 0 1px 3px rgb(0 0 0 / 0.35), 0 0 0 0 color-mix(in srgb, var(--pin) 70%, transparent); scale: 1.25; }
  100% { box-shadow: 0 1px 3px rgb(0 0 0 / 0.35), 0 0 0 14px transparent; scale: 1; }
}
.bs-pick {
  position: fixed; left: 0; top: 0; z-index: 2147483001; display: none; pointer-events: none; box-sizing: border-box;
  border-radius: 3px; outline: 2px solid var(--bs-accent); outline-offset: 1px;
  background: color-mix(in srgb, var(--bs-accent) 10%, transparent);
}
.bs-pick[data-on] { display: block; }
.bs-pick span {
  position: absolute; left: -3px; bottom: calc(100% + 5px); padding: 2px 6px; border-radius: 3px; white-space: nowrap;
  background: var(--bs-accent); color: #fff; font: 600 11px/1.3 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
}
body[data-mode="pin"], body[data-mode="pin"] * { cursor: crosshair !important; }
body[data-mode="pin"] .bs-pin { cursor: pointer !important; }
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
