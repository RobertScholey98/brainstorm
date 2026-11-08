import type { PreviewPrefs } from "../core/prefs";
import { blockIdOf, type BlockId, type BlockView, type CanvasFrame, type CanvasPin, type CanvasSystem, type FeedbackId, type IterationN, type Props, type SessionId, type SlotId, type SlotView } from "../core/types";

/**
 * The preview window mirrors the main window's canvas (ADR 007). The two are pages of one origin in one Electron
 * session, so they talk over a BroadcastChannel; the server never hears of it. The main window owns everything: what
 * shows, the look, Hold. The preview window draws what it is sent and hands back what Rob does in it.
 */
const CHANNEL = "brainstorm-preview";

/** What the main window's canvas shows, sent whenever it changes. Blocks go apart, since they change far less often. */
export type MirrorScene = {
  readonly session: SessionId;
  readonly title: string;
  readonly slots: readonly SlotView[];
  readonly frames: readonly CanvasFrame[];
  /** The canvas's design system kit, theme and proposed components, or null for a freeform session. */
  readonly system: CanvasSystem | null;
  /** Keyed by BlockId, with Rob's unsaved settings over the stored ones, so a slider drag shows as he drags. */
  readonly props: Readonly<Record<string, Props>>;
  readonly selected: BlockId | null;
  /** The selected slot, which present shows whichever view the main window is in. */
  readonly slot: SlotId | null;
  readonly view: "stage" | "board";
  /** What a pick is for, while the canvas is in pick mode. */
  readonly picking: "comment" | "vary" | null;
  readonly pins: readonly CanvasPin[];
  readonly focused: FeedbackId | null;
  readonly hovered: FeedbackId | null;
  /** The past iteration on the canvas, or null at the latest. */
  readonly past: IterationN | null;
  /** Why a comment can't be pinned now, in the Inspector's words, or null when it can. */
  readonly pinBlocked: string | null;
};

export type PreviewSettings = { readonly look: PreviewPrefs["look"]; readonly hold: boolean };

export type ToPreview =
  /** The main window (re)loaded, so a preview window that is open says hello again. */
  | { readonly kind: "main" }
  | { readonly kind: "blocks"; readonly blocks: readonly BlockView[] }
  /** Null when the main window has no brainstorm open. */
  | { readonly kind: "scene"; readonly scene: MirrorScene | null }
  | { readonly kind: "settings"; readonly settings: PreviewSettings }
  | { readonly kind: "pulse"; readonly id: FeedbackId; readonly seq: number };

export type ToMain =
  | { readonly kind: "hello" }
  | { readonly kind: "bye" }
  | { readonly kind: "select_block"; readonly blockId: BlockId }
  | { readonly kind: "pin_clicked"; readonly id: FeedbackId }
  | { readonly kind: "pin_hovered"; readonly id: FeedbackId | null }
  /** Start a pick, or with null end one. */
  | { readonly kind: "pick"; readonly for: "comment" | "vary" | null }
  /** The preview window took the pick and opened its composer, so the main window leaves pick mode. */
  | { readonly kind: "picked" }
  | { readonly kind: "slot"; readonly slot: SlotId }
  | { readonly kind: "step"; readonly by: -1 | 1 }
  | { readonly kind: "view"; readonly view: "stage" | "board" }
  /** Resume live, from the working look's held bar. */
  | { readonly kind: "resume" }
  /** Switch the preview window to the clean look, from the working look's own bar, before sharing it. */
  | { readonly kind: "clean" };

/** The preview window is an Electron window the main process opens; a browser on the headless server has none. */
export const canOpenPreviewWindow = () => /Electron\//.test(navigator.userAgent);

/**
 * Asks the main process to open (or bring forward), close, or toggle full screen on the preview window. The renderer
 * has no preload, so this is a link the window-open handler acts on and never opens, as Show in folder is.
 */
export function previewWindow(command: "open" | "close" | "fullscreen"): void {
  window.open(`/preview-window/${command}`, "_blank", "noopener");
}

export function openChannel<In>(onMessage: (message: In) => void): { post: (message: unknown) => void; close: () => void } {
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (e: MessageEvent) => onMessage(e.data as In);
  return { post: (message) => channel.postMessage(message), close: () => channel.close() };
}

type Sent = { readonly blocks: readonly BlockView[]; readonly scene: MirrorScene | null };

/** Whether the preview window is open, and while it is held, the slot and variant it is held on, in Rob's words. */
export type LinkState = { readonly open: boolean; readonly hold: boolean; readonly heldOn: string | null };

/** "The wheel · Slot reel": the slot the preview window shows and its variant's title, or the slot alone. */
/** What a window shows, such as "The wheel · Slot reel", for the held bar. */
export function describe({ blocks, scene }: Sent): string | null {
  const slot = scene?.slots.find((s) => s.id === scene.slot);
  if (slot === undefined) return null;
  const block = blocks.find((b) => b.id === blockIdOf(slot.id, slot.active));
  return block === undefined ? slot.title : `${slot.title} · ${block.title}`;
}

/**
 * The main window's end. It keeps the latest scene and blocks, and what the preview window was last sent: under Hold
 * the two part, and releasing Hold sends the latest. A preview window that (re)loads gets what it last had, so Hold
 * survives its reload.
 */
export class PreviewLink {
  private readonly channel = openChannel<ToMain>((m) => this.receive(m));
  private latest: Sent = { blocks: [], scene: null };
  private shown: Sent = this.latest;
  private open = false;
  private settings: PreviewSettings;
  private snapshot: LinkState;
  private readonly listeners = new Set<() => void>();
  private readonly handlers = new Set<(m: ToMain) => void>();

  constructor(look: PreviewSettings["look"]) {
    this.settings = { look, hold: false };
    this.snapshot = { open: false, hold: false, heldOn: null };
    this.channel.post({ kind: "main" } satisfies ToPreview);
  }

  /** Whether a preview window is open, and Hold, for useSyncExternalStore. */
  readonly state = () => this.snapshot;
  readonly subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  /** What Rob does in the preview window, for the open brainstorm to act on. */
  readonly onMessage = (h: (m: ToMain) => void): (() => void) => {
    this.handlers.add(h);
    return () => {
      this.handlers.delete(h);
    };
  };

  close(): void {
    this.channel.close();
  }

  setLook(look: PreviewSettings["look"]): void {
    if (look === this.settings.look) return;
    this.settings = { ...this.settings, look };
    this.post({ kind: "settings", settings: this.settings });
  }

  setHold(hold: boolean): void {
    if (hold === this.settings.hold) return;
    this.settings = { ...this.settings, hold };
    this.post({ kind: "settings", settings: this.settings });
    if (!hold) this.release();
    this.changed();
  }

  blocks(blocks: readonly BlockView[]): void {
    this.latest = { ...this.latest, blocks };
    if (this.settings.hold) return;
    this.shown = { ...this.shown, blocks };
    this.post({ kind: "blocks", blocks });
  }

  scene(scene: MirrorScene | null): void {
    this.latest = { ...this.latest, scene };
    if (this.settings.hold) return;
    this.shown = { ...this.shown, scene };
    this.post({ kind: "scene", scene });
  }

  pulse(id: FeedbackId, seq: number): void {
    if (!this.settings.hold) this.post({ kind: "pulse", id, seq });
  }

  private release(): void {
    if (this.shown.blocks !== this.latest.blocks) this.post({ kind: "blocks", blocks: this.latest.blocks });
    if (this.shown.scene !== this.latest.scene) this.post({ kind: "scene", scene: this.latest.scene });
    this.shown = this.latest;
  }

  private receive(m: ToMain): void {
    if (m.kind === "hello") {
      this.open = true;
      this.post({ kind: "settings", settings: this.settings });
      this.post({ kind: "blocks", blocks: this.shown.blocks });
      this.post({ kind: "scene", scene: this.shown.scene });
      this.changed();
      return;
    }
    if (m.kind === "bye") {
      this.open = false;
      // Hold is for the window that is open; the next one starts live.
      if (this.settings.hold) {
        this.settings = { ...this.settings, hold: false };
        this.release();
      }
      this.changed();
      return;
    }
    if (m.kind === "resume") return this.setHold(false);
    for (const h of this.handlers) h(m);
  }

  private post(m: ToPreview): void {
    if (this.open || m.kind === "main") this.channel.post(m);
  }

  private changed(): void {
    this.snapshot = { open: this.open, hold: this.settings.hold, heldOn: this.settings.hold ? describe(this.shown) : null };
    for (const l of this.listeners) l();
  }
}
