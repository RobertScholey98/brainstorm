import { AppWindow, EyeOff, MessageSquarePlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Toast } from "@/components/ui/toast";
import { Hint, TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_SETTINGS } from "../core/prefs";
import type { BlockView, CanvasRect, FeedbackId, Pin, RobAction, SlotId } from "../core/types";
import type { Api } from "./api";
import { CanvasBar } from "./CanvasBar";
import { CanvasHost, type FeedbackCue } from "./CanvasHost";
import { PinComposer } from "./Feedback";
import { HeldBar } from "./HeldBar";
import { setKitSource } from "./kit";
import { describe, openChannel, type MirrorScene, type PreviewSettings, type ToMain, type ToPreview } from "./mirror";
import { failedTitle, type Notice } from "./notice";
import { VaryComposer } from "./Vary";
import { PickComposer } from "./Pick";
import type { PickKind } from "./mirror";

/** A pick waiting on its composer, with the slot that was showing when it was picked: a pick into Main goes there (ADR 009). */
type Composing = { readonly for: PickKind; readonly pin: Pin; readonly at: { x: number; y: number }; readonly rect: CanvasRect; readonly slot: SlotId | null };

const NO_SETTINGS: PreviewSettings = { look: "clean", hold: false };

/**
 * The preview window (ADR 007): the main window's canvas, mirrored. Clean shows the slot alone, filling the window, for
 * whoever is watching; Working shows the canvas as the main window draws it, with the canvas bar, pins and Pin comment.
 * A pick in either look opens its composer here, and what it sends goes straight to the server, which tells both
 * windows.
 */
export function PreviewWindow({ api }: { api: Api }) {
  const [blocks, setBlocks] = useState<readonly BlockView[]>([]);
  const [scene, setScene] = useState<MirrorScene | null>(null);
  const [heard, setHeard] = useState(false);
  const [settings, setSettings] = useState<PreviewSettings>(NO_SETTINGS);
  const [pulse, setPulse] = useState<FeedbackCue | null>(null);
  const [composing, setComposing] = useState<Composing | null>(null);
  const [zooms, setZooms] = useState<Readonly<Record<string, number>>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const area = useRef<HTMLElement>(null);
  const channel = useRef<ReturnType<typeof openChannel> | null>(null);
  const tell = useCallback((m: ToMain) => channel.current?.post(m), []);
  // A design system session's blocks import its kit, which this window fetches for itself.
  useEffect(() => setKitSource(api.kit), [api]);
  // Vary starts on Settings' count, which Rob changes in the main window, so this one reads it again on each focus.
  const [varyCount, setVaryCount] = useState(DEFAULT_SETTINGS.varyCount);
  useEffect(() => {
    const read = () => void api.prefs().then((r) => r.ok && setVaryCount(r.data.settings.varyCount));
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [api]);

  useEffect(() => {
    const ch = openChannel<ToPreview>((m) => {
      setHeard(true);
      switch (m.kind) {
        case "main":
          return ch.post({ kind: "hello" } satisfies ToMain);
        case "blocks":
          return setBlocks(m.blocks);
        case "scene":
          return setScene(m.scene);
        case "settings":
          return setSettings(m.settings);
        case "pulse":
          return setPulse({ id: m.id, seq: m.seq });
      }
    });
    channel.current = ch;
    ch.post({ kind: "hello" } satisfies ToMain);
    const bye = () => ch.post({ kind: "bye" } satisfies ToMain);
    addEventListener("pagehide", bye);
    return () => {
      removeEventListener("pagehide", bye);
      bye();
      ch.close();
    };
  }, []);

  useEffect(() => {
    // A shared window's title bar is on screen too, so the clean look's names the design alone.
    document.title = scene === null ? "Brainstorm preview" : settings.look === "clean" ? scene.title : `${scene.title} · Working, not for sharing`;
  }, [scene?.title, scene === null, settings.look]);

  // A composer belongs to the brainstorm it was opened on.
  const session = scene?.session ?? null;
  useEffect(() => setComposing(null), [session]);

  const clean = settings.look === "clean";
  // The clean look is the one an audience sees, so it never takes a pick or shows a composer: editing stays in the
  // main window, or in the working look.
  const picking = clean ? null : (scene?.picking ?? null);
  useEffect(() => {
    if (clean) setComposing(null);
  }, [clean]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // In present, the canvas hands left and right back as slide steps.
      if (clean && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        tell({ kind: "step", by: e.key === "ArrowLeft" ? -1 : 1 });
        return;
      }
      if (e.key !== "Escape" || document.querySelector("[data-slot=popover-content]") !== null) return;
      if (picking !== null) tell({ kind: "pick", for: null });
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [clean, picking, tell]);

  const act = async (action: RobAction): Promise<boolean> => {
    if (scene === null) return false;
    const result = await api.act(scene.session, action);
    if (result.ok) {
      setNotice(null);
      return true;
    }
    setNotice({ title: failedTitle(action, blocks), detail: result.error.message });
    return false;
  };

  if (scene === null) return <Waiting heard={heard} />;

  const stage = clean || scene.view === "stage" ? scene.slot : null;
  const blockOf = (pin: Pin) => blocks.find((b) => b.id === pin.blockId) ?? null;
  const bounds = { width: area.current?.clientWidth ?? 0, height: area.current?.clientHeight ?? 0 };

  return (
    <TooltipProvider>
      <div className="flex h-svh flex-col bg-canvas" data-preview-window={settings.look} data-held={settings.hold || undefined}>
        {!clean && (
          <CanvasBar
            slots={scene.slots}
            current={scene.slot}
            view={scene.view}
            zoom={scene.slot === null ? null : (zooms[scene.slot] ?? null)}
            picking={picking}
            onSlot={(slot) => tell({ kind: "slot", slot })}
            onView={(view) => tell({ kind: "view", view })}
            onCancelPick={() => tell({ kind: "pick", for: null })}
            trailing={
              <>
                {/* The working look is for Rob's own screen, so it says so, with the way back to the look an audience may see. */}
                <span className="flex items-center gap-1.5 text-sm font-medium text-warning" data-preview-private>
                  <EyeOff aria-hidden className="size-3.5" />
                  Not for sharing
                </span>
                <Hint label="Show only the design in this window, as an audience should see it" side="bottom">
                  <Button variant="outline" onClick={() => tell({ kind: "clean" })} data-preview-to-clean>
                    Switch to Clean
                  </Button>
                </Hint>
                <Hint label={scene.pinBlocked ?? "Click an element here to pin a comment to it"} side="bottom">
                  <span tabIndex={scene.pinBlocked === null ? -1 : 0} className="inline-flex">
                    <Button
                      variant="outline"
                      aria-pressed={picking === "comment"}
                      aria-expanded={composing?.for === "comment"}
                      disabled={scene.pinBlocked !== null}
                      onClick={() => tell({ kind: "pick", for: picking === "comment" ? null : "comment" })}
                      data-preview-pin
                    >
                      <MessageSquarePlus data-icon="inline-start" aria-hidden />
                      {/* Pressed while a pick is on; the chip beside it already names the mode and its way out. */}
                      Pin comment
                    </Button>
                  </span>
                </Hint>
              </>
            }
          />
        )}
        <section ref={area} className="relative min-h-0 flex-1 overflow-hidden bg-canvas" aria-label="Preview" data-canvas-region>
          {/* An amber rule the width of the window, under its bar, so the look that isn't for sharing shows from across a room. */}
          {!clean && !settings.hold && <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-raised h-0.5 bg-warning" data-preview-private-rule />}
          <CanvasHost
            system={scene.system}
            blocks={blocks}
            frames={scene.frames}
            props={scene.props}
            selected={clean ? null : scene.selected}
            stage={stage}
            present={clean}
            mode={picking !== null && composing === null ? "pin" : "view"}
            pins={clean ? [] : scene.pins}
            focused={scene.focused}
            hovered={scene.hovered}
            pulse={clean ? null : pulse}
            onSelect={(blockId) => tell({ kind: "select_block", blockId })}
            onBlockError={() => {}}
            onPicked={(pin, at, rect) => {
              if (picking === null) return;
              setComposing({ for: picking, pin, at, rect, slot: scene.slot });
              tell({ kind: "picked" });
            }}
            onPinClicked={(id: FeedbackId) => tell({ kind: "pin_clicked", id })}
            onPinHovered={(id) => tell({ kind: "pin_hovered", id })}
            onPlacement={() => {}}
            onZooms={setZooms}
          />
          {!clean && settings.hold && <HeldBar on={describe({ blocks, scene })} onRelease={() => tell({ kind: "resume" })} />}
          {composing?.for === "comment" && (
            <PinComposer
              key={JSON.stringify(composing)}
              pin={composing.pin}
              at={composing.at}
              rect={composing.rect}
              block={blockOf(composing.pin)}
              bounds={bounds}
              onSave={async (text) => {
                if (await act({ kind: "add_feedback", pin: composing.pin, text })) setComposing(null);
              }}
              onCancel={() => setComposing(null)}
            />
          )}
          {composing?.for === "vary" && (
            <VaryComposer
              key={JSON.stringify(composing)}
              pin={composing.pin}
              at={composing.at}
              rect={composing.rect}
              block={blockOf(composing.pin)}
              slot={scene.slots.find((s) => s.id === blockOf(composing.pin)?.slot) ?? null}
              initialCount={varyCount}
              bounds={bounds}
              onSend={async (count, direction) => {
                if (await act({ kind: "vary", target: composing.pin, count, direction })) setComposing(null);
              }}
              onCancel={() => setComposing(null)}
            />
          )}
          {composing?.for === "graft" && (
            <PickComposer
              key={JSON.stringify(composing)}
              pin={composing.pin}
              at={composing.at}
              rect={composing.rect}
              block={blockOf(composing.pin)}
              slots={scene.slots}
              current={composing.slot}
              bounds={bounds}
              onAdd={async (into, instruction) => {
                if (await act({ kind: "add_graft", from: composing.pin, into, instruction })) setComposing(null);
              }}
              onCancel={() => setComposing(null)}
            />
          )}
          {notice !== null && <Toast heading={notice.title} message={notice.detail} onClose={() => setNotice(null)} />}
        </section>
      </div>
    </TooltipProvider>
  );
}

/** Before the main window answers, or while it has no brainstorm open. */
function Waiting({ heard }: { heard: boolean }) {
  return (
    <div className="flex h-svh bg-canvas" data-preview-window="waiting">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AppWindow aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{heard ? "No brainstorm open" : "Connecting to Brainstorm"}</EmptyTitle>
          <EmptyDescription>
            {heard ? "Open a brainstorm in the main window and its canvas shows here." : "This window shows the canvas of Brainstorm's main window."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
