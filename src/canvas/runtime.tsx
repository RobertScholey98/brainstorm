import * as React from "react";
import { Component, type ComponentType, type ReactNode, useSyncExternalStore } from "react";
import * as JSXRuntime from "react/jsx-runtime";
import { CircleAlert } from "lucide-react";
import { createRoot } from "react-dom/client";
import { designCss, SCROLLBAR } from "../core/design";
import { CANVAS_PAD, fitFrames, GAP } from "./fit";
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
  SlotId,
} from "../core/types";

type Loaded = { readonly ok: true; readonly component: ComponentType<Props> } | { readonly ok: false; readonly message: string };

type CanvasState = {
  readonly frames: readonly CanvasFrame[];
  readonly props: Readonly<Record<string, Props>>;
  readonly selected: BlockId | null;
  /** The slot on the stage, or null for the board. */
  readonly stage: SlotId | null;
  /** Each slot zoomed below 1 to fit, keyed by slot. */
  readonly zooms: ReadonlyMap<string, number>;
  /** The board couldn't fit one row at the floor zoom, so its frames wrap at their own size. */
  readonly wrap: boolean;
  readonly mode: CanvasMode;
  readonly pins: readonly CanvasPin[];
  readonly focused: FeedbackId | null;
  /** The pin whose feedback item the pointer is over in the Inspector. */
  readonly hovered: FeedbackId | null;
  /** Export only: each slot's variants, for the in-page switcher. */
  readonly variants: Readonly<Record<string, readonly CanvasVariant[]>>;
  /** Which content each block shows. Modules are cached by hash, so a new hash is the only thing that remounts a block. */
  readonly hashes: ReadonlyMap<BlockId, ContentHash>;
  /** Slots whose block is taller than the frame's declared height, so the frame scrolls. */
  readonly scrolling: ReadonlySet<string>;
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

let state: CanvasState = {
  frames: [],
  props: {},
  selected: null,
  stage: null,
  zooms: new Map(),
  wrap: false,
  mode: "view",
  pins: [],
  focused: null,
  hovered: null,
  variants: {},
  hashes: new Map(),
  scrolling: new Set(),
};
/** The block Rob just pressed in the canvas. Its selection comes back from the host and needs no reveal. */
let pressed: BlockId | null = null;
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
    case "state": {
      const moved = message.selected !== state.selected || message.stage !== state.stage;
      // A frame Rob pressed waits for the pointer to lift, so the canvas never scrolls under a click.
      const reveal = moved && message.selected !== null && message.selected !== pressed;
      pressed = null;
      setState({ frames: message.frames, props: message.props, selected: message.selected, stage: message.stage });
      const canvas = document.getElementById("canvas");
      if (canvas !== null) canvas.dataset.view = message.stage === null ? "board" : "stage";
      fitCanvas();
      if (reveal) requestAnimationFrame(() => revealSelected("smooth"));
      requestAnimationFrame(reportBelow);
      return;
    }
    case "mode":
      document.body.dataset.mode = message.mode;
      if (message.mode !== "pin") hover = null;
      setState({ mode: message.mode });
      wake();
      return;
    case "pins":
      setState({ pins: message.pins, focused: message.focused, hovered: message.hovered });
      wake();
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

/** Scrolls the selected frame in only as far as it takes, from wherever the selection came: a press, the shell, a resize. */
function revealSelected(behavior: ScrollBehavior): void {
  document.querySelector(".bs-frame[data-selected]:not([data-offstage])")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior });
}

/**
 * A frame whose block outgrows its declared height scrolls, and its scrollbar sits outside the declared width at the
 * one width every scrollbar has, so the block lays out at that width and the bar never shrinks with the zoom.
 */
const gutter = (f: CanvasFrame) => (state.scrolling.has(f.slot) ? SCROLLBAR : 0);

let lastBelow = 0;
/** Tells the host how many board frames sit wholly below the window, so the bar can say they are there. */
function reportBelow(): void {
  const count =
    state.stage !== null ? 0 : [...document.querySelectorAll(".bs-frame:not([data-offstage])")].filter((f) => f.getBoundingClientRect().top >= innerHeight).length;
  if (count === lastBelow) return;
  lastBelow = count;
  post({ kind: "below", count });
}

function measureScrolling(): void {
  const scrolling = new Set<string>();
  for (const body of document.querySelectorAll<HTMLElement>(".bs-frame-body[data-height]")) {
    const slot = body.closest<HTMLElement>(".bs-frame")?.dataset.slot;
    if (slot !== undefined && body.scrollHeight > body.clientHeight) scrolling.add(slot);
  }
  if (scrolling.size === state.scrolling.size && [...scrolling].every((slot) => state.scrolling.has(slot))) return;
  setState({ scrolling });
  fitCanvas();
}

// A block's height changes with its content as well as its DOM, so each block root is watched for size too.
const blockSizes = new ResizeObserver(measureScrolling);
new MutationObserver(() => {
  for (const el of document.querySelectorAll(".bs-frame-body[data-height] > [data-bid] > *")) blockSizes.observe(el);
  measureScrolling();
  requestAnimationFrame(reportBelow);
}).observe(document.getElementById("canvas") ?? document.body, { childList: true, subtree: true });

/** Applies the fit rules to the canvas as it is now, and tells the host when a zoom changes. */
function fitCanvas(): void {
  // The scrollbar's gutter is kept on both sides and the padding gives it back, so in either view the room is the
  // window less its pad, with or without a scrollbar.
  const room = innerWidth - 2 * CANVAS_PAD;
  const { zooms: next, wrap } = fitFrames(
    state.frames.map((f) => ({ slot: f.slot, width: f.frame.width, gutter: gutter(f) })),
    room,
    state.stage,
  );
  const same = wrap === state.wrap && next.size === state.zooms.size && [...next].every(([k, v]) => state.zooms.get(k) === v);
  if (same) return;
  setState({ zooms: next, wrap });
  const canvas = document.getElementById("canvas");
  if (canvas !== null) canvas.dataset.wrap = String(wrap);
  post({ kind: "zooms", zooms: Object.fromEntries(next) });
  requestAnimationFrame(reportBelow);
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

/** The Inspector's danger callout, drawn in the frame: the tone icon, the title in the tone, the error in body text. */
function BlockFailure({ message }: { message: string }) {
  return (
    <div className="bs-failure" role="alert">
      <CircleAlert aria-hidden className="bs-failure-icon" />
      <div>
        <strong>This block failed to render</strong>
        <span>{message}</span>
      </div>
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
        const zoom = s.zooms.get(frame.slot);
        // Off the stage, a frame stays mounted and laid out, so its block keeps its state, its errors still report and
        // its pins still tell placed from detached.
        const offstage = s.stage !== null && s.stage !== frame.slot;
        return (
          <section
            key={frame.slot}
            className="bs-frame"
            data-slot={frame.slot}
            data-selected={selected || undefined}
            data-offstage={offstage || undefined}
            aria-hidden={offstage || undefined}
            // The frame is as wide as its zoomed body, so a long title truncates inside it rather than widening it.
            style={{ width: frame.frame.width * (zoom ?? 1) + gutter(frame) }}
            onPointerDownCapture={() => {
              pressed = frame.blockId;
              revealOnRelease = true;
              post({ kind: "select_block", blockId: frame.blockId });
            }}
          >
            <header className="bs-frame-title">
              <span>{frame.title}</span>
              <span className="bs-frame-size">
                {frame.frame.width} × {frame.frame.height ?? "auto"}
              </span>
            </header>
            {variants.length > 1 && <VariantSwitch frame={frame} variants={variants} />}
            <div
              className="bs-frame-body"
              data-zoom={zoom}
              data-height={frame.frame.height ?? undefined}
              data-scrolls={gutter(frame) > 0 || undefined}
              style={{
                width: frame.frame.width + gutter(frame) / (zoom ?? 1),
                height: frame.frame.height ?? undefined,
                zoom,
                ["--bs-unzoom" as string]: zoom === undefined ? undefined : 1 / zoom,
              }}
            >
              <Block frame={frame} hash={s.hashes.get(frame.blockId)} props={s.props[frame.blockId] ?? {}} />
              {s.pins
                .filter((p) => p.pin.blockId === frame.blockId)
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="bs-pin"
                    // The pin undoes its frame's zoom, so it keeps one size and hit area at any fit.
                    style={zoom === undefined ? undefined : { zoom: 1 / zoom }}
                    ref={(el) => {
                      if (el === null) return;
                      markers.set(p.id, el);
                      return () => {
                        if (markers.get(p.id) === el) markers.delete(p.id);
                      };
                    }}
                    data-pin={p.id}
                    data-status={p.status}
                    data-focused={s.focused === p.id || undefined}
                    data-hovered={s.hovered === p.id || undefined}
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
let revealOnRelease = false;
let wantedPulse: FeedbackId | null = null;
let looping = false;
let lastPlacement: { readonly placed: readonly FeedbackId[]; readonly detached: readonly FeedbackId[] } | null = null;
/** The rendered marker for each pin, kept by its ref so the layout loop never searches the document for one. */
const markers = new Map<FeedbackId, HTMLElement>();

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

const sameIds = (a: readonly FeedbackId[], b: readonly FeedbackId[]) => a.length === b.length && a.every((id, i) => id === b[i]);

function reportPlacement(placed: readonly FeedbackId[], detached: readonly FeedbackId[]): void {
  if (lastPlacement !== null && sameIds(placed, lastPlacement.placed) && sameIds(detached, lastPlacement.detached)) return;
  lastPlacement = { placed, detached };
  post({ kind: "pin_placement", placed, detached });
}

function layoutPins(): void {
  const placed: FeedbackId[] = [];
  const detached: FeedbackId[] = [];
  const stacked = new Map<Element, number>();
  const wrappers = new Map<BlockId, Element | null>();
  const wrapperOf = (blockId: BlockId) => {
    if (!wrappers.has(blockId)) wrappers.set(blockId, document.querySelector(`[data-bid="${blockId}"]`));
    return wrappers.get(blockId) ?? null;
  };
  for (const { id, pin } of state.pins) {
    const wrapper = wrapperOf(pin.blockId);
    const marker = markers.get(id);
    const body = wrapper?.closest(".bs-frame-body");
    if (wrapper == null || marker === undefined || body == null) continue;
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
    // The body's own sizes and scroll offsets are in its unzoomed px, rects in the viewport's. The pin undoes the zoom,
    // so it is placed in viewport px from the body's corner.
    const k = body instanceof HTMLElement && body.offsetWidth > 0 ? b.width / body.offsetWidth : 1;
    let x: number;
    let y: number;
    if (anchor === body) {
      x = body.clientWidth * k - PIN_SIZE - 6;
      y = 6;
    } else {
      const r = anchor.getBoundingClientRect();
      x = r.right - b.left + (body.scrollLeft - body.clientLeft) * k - PIN_SIZE / 2;
      y = r.top - b.top + (body.scrollTop - body.clientTop) * k - PIN_SIZE / 2;
    }
    x = Math.min(Math.max(x - index * (PIN_SIZE + 2), 2), body.scrollWidth * k - PIN_SIZE - 2);
    y = Math.min(Math.max(y, 2), body.scrollHeight * k - PIN_SIZE - 2);
    // The translate property, not transform: a hover or pulse scale applies inside it, so it never scales the offset.
    const translate = `${Math.round(x)}px ${Math.round(y)}px`;
    if (marker.style.translate !== translate) marker.style.translate = translate;
    marker.dataset.placed = "";
    if (wantedPulse === id && marker.closest("[data-offstage]") === null) {
      wantedPulse = null;
      // Nearest, with the pin's scroll margin, so a pin already in view doesn't pull the canvas sideways.
      marker.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      marker.classList.remove("bs-pulse");
      void marker.offsetWidth;
      marker.classList.add("bs-pulse");
    }
  }
  reportPlacement(placed, detached);
}

const highlight = document.createElement("div");
highlight.className = "bs-pick";
const highlightLabel = document.createElement("span");
highlight.append(highlightLabel);
/** Where position: fixed puts 0, 0. The root keeps a scrollbar gutter on its left, and fixed boxes start after it. */
const fixedOrigin = document.createElement("div");
fixedOrigin.style.cssText = "position: fixed; left: 0; top: 0; width: 0; height: 0; visibility: hidden; pointer-events: none";

function layoutHover(): void {
  if (state.mode !== "pin" || hover === null || !hover.anchor.isConnected) {
    delete highlight.dataset.on;
    return;
  }
  const r = hover.anchor.getBoundingClientRect();
  const o = fixedOrigin.getBoundingClientRect();
  highlight.style.transform = `translate(${r.left - o.left}px, ${r.top - o.top}px)`;
  highlight.style.width = `${r.width}px`;
  highlight.style.height = `${r.height}px`;
  highlightLabel.textContent = hover.pin.part ?? "Whole block";
  highlight.dataset.on = "";
}

if (live) {
  document.body.append(highlight, fixedOrigin);
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
          // The composer anchors to the element, so its frame comes into view first, and the click point moves with it.
          const before = target.anchor.getBoundingClientRect();
          target.anchor.closest(".bs-frame")?.scrollIntoView({ block: "nearest", inline: "nearest" });
          const r = target.anchor.getBoundingClientRect();
          const { clientX, clientY } = e as MouseEvent;
          const [x, y] = [clientX + r.left - before.left, clientY + r.top - before.top];
          post({ kind: "picked", pin: target.pin, at: { x, y }, rect: { x: r.left, y: r.top, width: r.width, height: r.height } });
        }
      },
      true,
    );
  }
  window.addEventListener("pointerup", () => {
    if (!revealOnRelease) return;
    revealOnRelease = false;
    revealSelected("smooth");
  });
  window.addEventListener("pointermove", (e) => (hover = state.mode === "pin" ? pickTarget(e.target) : null), true);
  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || !(e.key === "Escape" || e.ctrlKey || e.metaKey)) return;
    post({ kind: "key", key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey });
  });
  document.documentElement.addEventListener("pointerleave", () => (hover = null));
  wake();
}

/** Runs every frame while there are pins to place or a pick to highlight, and stops once there is neither. */
function loop(): void {
  if (state.pins.length === 0 && state.mode !== "pin") {
    looping = false;
    delete highlight.dataset.on;
    reportPlacement([], []);
    return;
  }
  looping = true;
  layoutPins();
  layoutHover();
  requestAnimationFrame(loop);
}

function wake(): void {
  if (live && !looping) {
    looping = true;
    requestAnimationFrame(loop);
  }
}

const CHROME_CSS = `
${designCss("bs-")}
html, body { margin: 0; min-height: 100%; }
html { scrollbar-gutter: stable both-edges; }
body {
  background-color: var(--bs-canvas);
  background-image: radial-gradient(color-mix(in oklab, var(--bs-fg) 10%, transparent) 1px, transparent 1.2px);
  background-size: 16px 16px;
  font: 12px/16px var(--bs-font-ui);
}
#canvas {
  display: flex; align-items: flex-start; gap: ${GAP}px;
  padding: ${CANVAS_PAD}px calc(${CANVAS_PAD}px - var(--bs-scrollbar)) 48px;
}
#canvas[data-wrap="true"] { flex-wrap: wrap; justify-content: center; }
#canvas[data-view="stage"] { justify-content: center; }
/* A reveal stops at the canvas padding, so a frame's label sits the same way off the bar in both views. */
.bs-frame { flex: none; min-width: 0; scroll-margin: ${CANVAS_PAD}px; }
.bs-frame[data-offstage] { position: fixed; left: 0; top: 0; visibility: hidden; pointer-events: none; }
.bs-frame-title {
  display: flex; gap: 8px; max-width: 100%; box-sizing: border-box;
  margin: 0 0 8px; padding: 0 2px; color: var(--bs-fg-muted); font-weight: 500; cursor: default; user-select: none; white-space: nowrap;
}
.bs-frame-title > span:first-child { overflow: hidden; text-overflow: ellipsis; }
.bs-frame-size { flex: none; font-variant-numeric: tabular-nums; font-weight: 400; }
.bs-frame:has(.bs-failure) .bs-frame-size { display: none; }
.bs-frame[data-selected] .bs-frame-title { color: var(--bs-accent); }
.bs-frame-body {
  position: relative; overflow: auto; isolation: isolate;
  background: var(--bs-card); border-radius: 4px;
  box-shadow: 0 0 0 1px var(--bs-border), var(--bs-elevation-sm);
  transition: box-shadow 120ms ease-out;
}
.bs-frame[data-selected] .bs-frame-body { box-shadow: 0 0 0 2px var(--bs-accent), var(--bs-elevation-sm); }
.bs-frame-body:has(> .bs-failure) { height: auto !important; }
.bs-frame-body[data-scrolls] { overflow-y: scroll; }
.bs-frame-body::-webkit-scrollbar { width: calc(var(--bs-scrollbar) * var(--bs-unzoom, 1)); }
.bs-failure {
  display: flex; align-items: flex-start; gap: 8px; margin: 16px; padding: 12px; border-radius: 8px;
  color: var(--bs-fg); background: var(--bs-danger-subtle);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--bs-danger) 25%, transparent);
  font: 12px/1.55 var(--bs-font-ui); white-space: pre-wrap; text-wrap: pretty;
}
.bs-failure > div { display: grid; gap: 4px; min-width: 0; }
.bs-failure strong { color: var(--bs-danger); font: 500 13px/18px var(--bs-font-ui); }
.bs-failure-icon { flex: none; width: 14px; height: 14px; margin-top: 2px; color: var(--bs-danger); }
.bs-switch {
  display: flex; gap: 2px; margin: 0 0 8px; padding: 2px; border-radius: 6px; width: max-content; max-width: 100%;
  background: var(--bs-muted);
}
.bs-switch button {
  height: 24px; padding: 0 8px; border: 0; border-radius: 4px; background: transparent; color: var(--bs-fg-muted);
  font: 500 12px var(--bs-font-ui); cursor: pointer;
}
.bs-switch button[aria-checked="true"] { background: var(--bs-card); color: var(--bs-fg); box-shadow: 0 0 0 1px var(--bs-border), var(--bs-elevation-xs); }
.bs-pin {
  position: absolute; left: 0; top: 0; z-index: 2147483000; display: none; place-items: center;
  width: ${PIN_SIZE}px; height: ${PIN_SIZE}px; box-sizing: border-box; padding: 0;
  border: 2px solid var(--bs-card); border-radius: 10px 10px 10px 4px; background: var(--bs-accent); color: var(--bs-accent-fg);
  font: 600 11px/1 var(--bs-font-ui); font-variant-numeric: tabular-nums;
  box-shadow: var(--bs-elevation-sm); cursor: pointer; scroll-margin: 48px; transition: scale 120ms ease-out, box-shadow 120ms ease-out;
}
.bs-pin[data-placed] { display: grid; }
/* The hit area sits 3 px past the face; an inset is measured inside the 2 px border, so it is 5 px. */
.bs-pin::after { content: ""; position: absolute; inset: -5px; }
.bs-pin[data-status="addressed"] { background: var(--bs-card); color: var(--bs-accent); border-color: var(--bs-accent); }
.bs-pin[data-status="confirmed"] {
  background: var(--bs-muted); color: var(--bs-fg-muted);
  box-shadow: 0 0 0 1px var(--bs-fg-muted), var(--bs-elevation-sm);
}
/* Hovered here, or through its feedback item in the Inspector. */
.bs-pin:hover, .bs-pin[data-hovered] { scale: 1.15; box-shadow: var(--bs-elevation-md); }
.bs-pin[data-focused] { box-shadow: 0 0 0 2px var(--bs-card), 0 0 0 4px var(--bs-accent), var(--bs-elevation-sm); }
.bs-pin.bs-pulse { animation: bs-pulse 650ms ease-out 2; }
@keyframes bs-pulse {
  0% { box-shadow: var(--bs-elevation-sm), 0 0 0 0 color-mix(in oklab, var(--bs-accent) 60%, transparent); scale: 1.25; }
  100% { box-shadow: var(--bs-elevation-sm), 0 0 0 14px transparent; scale: 1; }
}
.bs-pick {
  position: fixed; left: 0; top: 0; z-index: 2147483001; display: none; pointer-events: none; box-sizing: border-box;
  border-radius: 4px; outline: 2px solid var(--bs-accent); outline-offset: 1px;
  background: color-mix(in oklab, var(--bs-accent) 10%, transparent);
}
.bs-pick[data-on] { display: block; }
.bs-pick span {
  position: absolute; left: -3px; bottom: calc(100% + 6px); padding: 2px 6px; border-radius: 4px; white-space: nowrap;
  background: var(--bs-accent); color: var(--bs-accent-fg); font: 500 12px/16px var(--bs-font-ui);
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

addEventListener("resize", () => {
  fitCanvas();
  revealSelected("auto");
  requestAnimationFrame(reportBelow);
});
addEventListener("scroll", reportBelow, { passive: true });
post({ kind: "ready" });
