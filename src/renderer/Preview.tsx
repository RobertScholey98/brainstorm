import { CircleAlert, Hourglass } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "cn";
import { Skeleton } from "@/components/ui/skeleton";
import type { FrameToHost, HostToFrame, Result, SessionId, SessionPreview } from "../core/types";
import { PREVIEW_FRAMES, PreviewTurns, StillCache } from "./previewQueue";

const turns = new PreviewTurns(PREVIEW_FRAMES);
const stills = new StillCache(200);
/** A frame that hasn't painted by then gives its turn back and shows as failed. */
const PAINT_MS = 10_000;

export type LoadPreview = (id: SessionId) => Promise<Result<SessionPreview | null>>;

type Shown =
  | { readonly kind: "loading" }
  | { readonly kind: "empty" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "still"; readonly image: string }
  | { readonly kind: "live" };

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
 * A home card's preview: the latest iteration's first slot, as Rob left it, scaled to the card's width from the top.
 * It is drawn in the canvas's own sandboxed frame (`/canvas/preview`, same CSP, postMessage only), which takes a still
 * of itself and is then removed, so only a few frames ever run. It loads only while the card is in view, and nothing
 * in it can be pressed or focused: a click lands on the card.
 */
export function CardPreview({ id, revision, load, muted }: { id: SessionId; revision: number; load: LoadPreview; muted: boolean }) {
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
    void load(id).then((r) => current && setPayload(r.ok ? { preview: r.data } : { error: r.error.message }));
    return () => {
      current = false;
    };
  }, [inView, id, revision, load]);

  const preview = payload !== null && "preview" in payload ? payload.preview : null;
  const key = preview === null ? null : `${dark ? "dark" : "light"}:${preview.module.hash}:${preview.frame.frame.width}:${JSON.stringify(preview.props)}`;

  useEffect(() => {
    if (payload === null) return;
    if ("error" in payload) return setShown({ kind: "failed", message: payload.error });
    if (key === null) return setShown({ kind: "empty" });
    const image = stills.get(key);
    setShown(image === undefined ? { kind: "loading" } : { kind: "still", image });
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
    const receive = (e: MessageEvent) => {
      if (frame.current === null || e.source !== frame.current.contentWindow) return;
      const message = e.data as FrameToHost;
      const p = sent.current;
      const post = (m: HostToFrame) => frame.current?.contentWindow?.postMessage(m, "*");
      if (message.kind === "ready" && p !== null) {
        post({ kind: "modules", modules: [p.module] });
        post({ kind: "state", frames: [p.frame], props: { [p.frame.blockId]: p.props }, selected: null, stage: null });
      } else if (message.kind === "block_error") {
        setShown({ kind: "failed", message: message.message });
      } else if (message.kind === "painted") {
        if (message.image !== null && key !== null) stills.set(key, message.image);
        setShown((s) => (s.kind === "failed" ? s : message.image === null ? { kind: "live" } : { kind: "still", image: message.image }));
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [turn, key]);

  return (
    <div
      ref={box}
      aria-hidden
      className={cn("relative h-preview shrink-0 overflow-hidden rounded-t-lg border-b bg-canvas", muted && "opacity-60")}
      data-preview={shown.kind}
    >
      {shown.kind === "still" && <img src={shown.image} alt="" className="size-full object-cover object-top" draggable={false} />}
      {(turn || shown.kind === "live") && shown.kind !== "still" && shown.kind !== "failed" && (
        <iframe
          ref={frame}
          title="Preview"
          src="/canvas/preview"
          sandbox="allow-scripts"
          tabIndex={-1}
          inert
          className={cn("pointer-events-none absolute inset-0 size-full border-0", shown.kind !== "live" && "opacity-0")}
        />
      )}
      {shown.kind === "loading" && <Skeleton className="absolute inset-3 rounded-sm" />}
      {shown.kind === "empty" && (
        <span className="flex size-full items-center justify-center gap-1.5 text-xs text-fg-muted">
          <Hourglass aria-hidden className="size-3.5" />
          Waiting for the first commit
        </span>
      )}
      {shown.kind === "failed" && (
        <span className="flex size-full items-center justify-center gap-1.5 px-4 text-xs text-fg-muted" data-preview-error={shown.message}>
          <CircleAlert aria-hidden className="size-3.5 shrink-0 text-danger" />
          <span className="truncate">The preview failed to render</span>
        </span>
      )}
    </div>
  );
}
