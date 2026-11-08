import { CircleAlert, Hourglass } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "cn";
import { Skeleton } from "@/components/ui/skeleton";
import { Truncate } from "@/components/ui/truncate";
import type { FrameToHost, HostToFrame, Result, SessionId, SessionPreview } from "../core/types";
import { kitFor } from "./kit";
import { PREVIEW_FRAMES, PreviewTurns, StillCache, stillKey } from "./previewQueue";

const turns = new PreviewTurns(PREVIEW_FRAMES);
/** A frame that hasn't painted by then gives its turn back and shows as failed. */
const PAINT_MS = 10_000;

export type LoadPreview = (id: SessionId) => Promise<Result<SessionPreview | null>>;
type LoadStill = () => Promise<Result<SessionPreview | null>>;

type Shown =
  | { readonly kind: "loading" }
  | { readonly kind: "empty" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "still"; readonly image: string }
  | { readonly kind: "live" };

type Painted = Extract<Shown, { kind: "still" | "failed" }>;
/** A block that throws is kept as failed too, so its card doesn't run a frame again only to show the canvas's error box. */
const stills = new StillCache<Painted>(200);

const DARK = "(prefers-color-scheme: dark)";
function useDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = matchMedia(DARK);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => matchMedia(DARK).matches,
  );
}

function useInView(target: React.RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = target.current;
    if (el === null) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting ?? false));
    observer.observe(el);
    return () => observer.disconnect();
  }, [target]);
  return inView;
}

/**
 * A home card's preview: the latest iteration's first slot, as Rob left it, on a mat of the canvas the way the stage
 * shows a frame. The frame is inset from the mat's top and sides at the card's width and runs off its bottom, so a
 * short frame ends on the mat and every state, loading, waiting, failed and settled, sits on the same surface.
 * It is drawn in the canvas's own sandboxed frame (`/canvas/preview`, same CSP, postMessage only), which takes a still
 * of itself and is then removed, so only a few frames ever run. It loads only while the card is in view, and nothing
 * in it can be pressed or focused: a click lands on the card.
 */
export function CardPreview({ id, revision, load, muted }: { id: SessionId; revision: number; load: LoadPreview; muted: boolean }) {
  const loadStill = useCallback(() => load(id), [load, id]);
  return <Still load={loadStill} revision={revision} className={WELL} muted={muted} empty={WAITING} floor={CARD_FLOOR} />;
}

/** One brainstorm with no iteration yet, in the words the canvas and the sidebar use too. */
export const WAITING = "Waiting for the first commit";

const WELL = "h-preview shrink-0 rounded-t-lg border-b canvas-dots";
/** The frame's place on the mat: 12 px in from the top and sides, running off the bottom. */
const FRAME = "absolute inset-x-3 top-3 bottom-0";

/**
 * The least zoom a card's still takes. A page-width frame fitted to the card's width would be a strip of 3 px text, so
 * past this it keeps the zoom and shows its top left, at half its size on the stage.
 */
const CARD_FLOOR = 0.5;

/**
 * The frame's width on the mat. A frame that fits at the floor or above takes the mat less 12 px each side.
 * One the floor cuts runs off the mat's right edge as it runs off its bottom, so its cut edge reads as more to come.
 * Between the two, the frame shows whole at the floor. The preview zooms to the larger of its fit and the floor, so it
 * matches this box in every case.
 */
const frameBox = (frameWidth: number, floor: number) => `min(100% - 12px, max(100% - 24px, ${frameWidth * floor}px))`;

/** The well while the card itself loads: the mat, and a frame-shaped skeleton where the still will land. */
export function PreviewSkeleton() {
  return (
    <div aria-hidden className={cn("relative overflow-hidden bg-canvas", WELL)} data-preview="loading">
      <FrameSkeleton className={cn(FRAME, "rounded-t-sm")} />
    </div>
  );
}

/** A frame-shaped skeleton on the card's fill, so the mat's dots don't print through its pulse. */
function FrameSkeleton({ className }: { className: string }) {
  return (
    <div className={cn("overflow-hidden bg-card", className)} data-preview-skeleton>
      <Skeleton className="size-full rounded-none" />
    </div>
  );
}

/**
 * A settled card's still, opaque on the card's own fill so no dot of the mat prints through it. `still-settled` takes
 * its colour and most of its contrast, so a dark design becomes a pale ghost in light rather than a grey slab.
 */
const SETTLED_STILL = "bg-card still-settled";

/** A strip still's size, which its loading skeleton shares. */
export const STILL_BOX = "h-12 w-16 shrink-0 rounded-sm";

/**
 * A filmstrip still: one past iteration's slot, through the same frames, turns and cache as a home card, so stepping
 * back through history costs no more than scrolling home. It is a home well in small: a landscape mat with the frame
 * 4 px in from its top and sides, so a wide frame shows whole and a tall one shows its top.
 */
export function IterationStill({ load, revision }: { load: LoadStill; revision: number }) {
  return <Still load={load} revision={revision} compact className={cn(STILL_BOX, "canvas-dots ring-1 ring-border")} />;
}

function Still({
  load,
  revision,
  className,
  empty = "",
  compact = false,
  muted = false,
  floor = 0,
}: {
  load: LoadStill;
  revision: number;
  className: string;
  empty?: string;
  /** A settled card's: the still recedes, the mat stays. */
  muted?: boolean;
  /** A thumbnail: its states show as an icon alone. */
  compact?: boolean;
  /** The least zoom the frame takes, cut from its top left past it. */
  floor?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const inView = useInView(box);
  const dark = useDark();
  const [payload, setPayload] = useState<{ readonly preview: SessionPreview | null } | { readonly error: string } | null>(null);
  const [shown, setShown] = useState<Shown>({ kind: "loading" });
  const [turn, setTurn] = useState(false);

  useEffect(() => {
    if (!inView) return;
    let current = true;
    void load().then((r) => current && setPayload(r.ok ? { preview: r.data } : { error: r.error.message }));
    return () => {
      current = false;
    };
  }, [inView, revision, load]);

  const preview = payload !== null && "preview" in payload ? payload.preview : null;
  const key = preview === null ? null : stillKey(preview, { dark, compact });

  useEffect(() => {
    if (payload === null) return;
    if ("error" in payload) return setShown({ kind: "failed", message: payload.error });
    if (key === null) return setShown({ kind: "empty" });
    setShown(stills.get(key) ?? { kind: "loading" });
  }, [payload, key]);

  // A card in view with nothing to show waits for a turn, then runs a frame until it paints.
  const needsFrame = inView && key !== null && shown.kind === "loading";
  useEffect(() => {
    if (!needsFrame) return;
    const giveBack = turns.take(() => setTurn(true));
    const timer = setTimeout(() => {
      setShown({ kind: "failed", message: "The preview didn't finish drawing." });
      giveBack();
    }, PAINT_MS);
    return () => {
      clearTimeout(timer);
      giveBack();
      setTurn(false);
    };
  }, [needsFrame, key]);

  const sent = useRef(preview);
  sent.current = preview;
  useEffect(() => {
    if (!turn) return;
    let failed = false;
    const keep = (painted: Painted) => {
      if (key !== null) stills.set(key, painted);
      setShown(painted);
    };
    const receive = (e: MessageEvent) => {
      if (frame.current === null || e.source !== frame.current.contentWindow) return;
      const message = e.data as FrameToHost;
      const p = sent.current;
      const post = (m: HostToFrame) => frame.current?.contentWindow?.postMessage(m, "*");
      if (message.kind === "ready" && p !== null) {
        const draw = () => {
          post({ kind: "modules", modules: [p.module] });
          post({ kind: "state", frames: [p.frame], props: { [p.frame.blockId]: p.props }, selected: null, stage: null, floor });
        };
        const system = p.system;
        if (system === null) draw();
        else {
          // The kit goes first, so the block finds it when it loads.
          void kitFor(system.id, system.n).then((kit) => {
            if (kit === null) {
              failed = true;
              keep({ kind: "failed", message: "The design system's kit didn't load." });
              return;
            }
            post({ kind: "kit", kit });
            post({ kind: "proposed", modules: system.proposed });
            post({ kind: "theme", theme: system.theme });
            draw();
          });
        }
      } else if (message.kind === "block_error") {
        failed = true;
        keep({ kind: "failed", message: message.message });
      } else if (message.kind === "painted" && !failed) {
        if (message.image === null) setShown({ kind: "live" });
        else keep({ kind: "still", image: message.image });
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [turn, key, floor]);

  return (
    <div
      ref={box}
      aria-hidden
      className={cn("relative overflow-hidden bg-canvas", className)}
      data-preview={shown.kind}
    >
      <div
        className={compact ? "absolute inset-x-1 top-1 bottom-0" : FRAME}
        style={floor > 0 && preview !== null ? { width: frameBox(preview.frame.frame.width, floor) } : undefined}
      >
        {shown.kind === "still" && (
          <img
            src={shown.image}
            alt=""
            className={cn("block w-full ring-1", compact ? "rounded-t-sm ring-border" : "rounded-sm shadow-xs ring-border-strong", muted && SETTLED_STILL)}
            draggable={false}
            data-preview-still
          />
        )}
        {(turn || shown.kind === "live") && shown.kind !== "still" && shown.kind !== "failed" && (
          <iframe
            ref={frame}
            title="Preview"
            src="/canvas/preview"
            sandbox="allow-scripts"
            tabIndex={-1}
            inert
            className={cn("pointer-events-none size-full border-0", !compact && "rounded-t-sm", shown.kind !== "live" && "opacity-0")}
          />
        )}
        {shown.kind === "loading" && <FrameSkeleton className={cn("absolute inset-0", compact ? "rounded-sm" : "rounded-t-sm")} />}
      </div>
      {shown.kind === "empty" && (
        <span className="flex size-full items-center justify-center gap-1.5 text-xs text-fg-muted">
          <Hourglass aria-hidden className="size-3.5" />
          {!compact && empty}
        </span>
      )}
      {shown.kind === "failed" && (
        <span className={cn("flex size-full items-center justify-center gap-1.5 text-xs text-fg-muted", !compact && "px-4")} data-preview-error={shown.message}>
          <CircleAlert aria-hidden className="size-3.5 shrink-0 text-danger" />
          {!compact && <Truncate>The preview failed to render</Truncate>}
        </span>
      )}
    </div>
  );
}
