import { EyeOff, MessageSquarePlus, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { partLabel } from "../core/fork";
import { FEEDBACK_ACTIONS } from "../core/machines";
import type { BlockId, BlockView, CanvasRect, Feedback, FeedbackAction, FeedbackId, FeedbackStatus, Pin, RobAction } from "../core/types";
import { PinNumber } from "./PinNumber";
import { POPOVER_WIDTH } from "./placement";
import { useComposerPlace } from "./useComposerPlace";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { SubmitKey } from "@/components/ui/kbd";
import { OverlayHeader, OverlayPanel, PopoverFooter } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { BlockedHint, Hint } from "@/components/ui/tooltip";
import { Truncate } from "@/components/ui/truncate";
import { Count } from "@/components/ui/count";
import { overflows } from "@/components/ui/ink";
import type { FeedbackCue, Placement } from "./CanvasHost";

/** Where a pin is on the canvas. Only the frame can tell placed from detached; the rest the view knows. */
export type PinPlace = "placed" | "detached" | "hidden" | "removed";

export function pinPlace(f: Feedback, blocks: readonly BlockView[], active: ReadonlySet<BlockId>, placement: Placement): PinPlace {
  if (!blocks.some((b) => b.id === f.pin.blockId)) return "removed";
  if (!active.has(f.pin.blockId)) return "hidden";
  return placement.detached.has(f.id) ? "detached" : "placed";
}

const GROUPS: readonly { state: FeedbackStatus["state"]; title: string }[] = [
  { state: "open", title: "Open" },
  { state: "addressed", title: "Addressed" },
  { state: "confirmed", title: "Confirmed" },
];


/** The item sits under a heading that names its status, so the line says only what the heading doesn't. */
function statusLine(status: FeedbackStatus): string | null {
  switch (status.state) {
    case "open":
      return status.previouslyAddressedIn === null ? null : `Previously addressed in iteration ${status.previouslyAddressedIn}`;
    case "addressed":
      return `In iteration ${status.in}`;
    case "confirmed":
      return `Addressed in iteration ${status.addressedIn}`;
  }
}

const ACTION_LABEL: Record<FeedbackAction, string> = { confirm: "Confirm", reopen: "Reopen", edit: "Edit", delete: "Delete" };

const PLACE_NOTE: Record<Exclude<PinPlace, "placed">, string> = {
  detached: "Detached: its element is gone",
  hidden: "On a variant that isn't showing",
  removed: "Its block was removed",
};

export function FeedbackPanel({
  feedback,
  blocks,
  place,
  canPin,
  past = false,
  pinBlocked = "There is nothing on the canvas to pin to yet",
  picking,
  composing,
  asked = false,
  focused,
  echoed,
  onHover,
  onPickToggle,
  onOpen,
  send,
}: {
  feedback: readonly Feedback[];
  blocks: readonly BlockView[];
  place: (f: Feedback) => PinPlace;
  /** False before the first iteration, when the canvas has nothing to pin to. */
  canPin: boolean;
  /** A past iteration shows: the comments belong to the latest, so they read here and wait for Back to latest. */
  past?: boolean;
  /** Why Pin comment is off, when it is. */
  pinBlocked?: string;
  picking: boolean;
  /** Whether the pin composer is up, so the button reads open as every popover trigger does. */
  composing: boolean;
  /** A pick it asked for that couldn't start, while the canvas region asks how to go on: an edge only, short of pressed. */
  asked?: boolean;
  focused: FeedbackCue | null;
  /** The comment whose pin is under the pointer on the canvas, tinted as if the pointer were on it. */
  echoed: FeedbackId | null;
  /** The item under the pointer, so its pin can echo the hover on the canvas. */
  onHover: (id: FeedbackId | null) => void;
  onPickToggle: () => void;
  onOpen: (f: Feedback) => void;
  send: (action: RobAction) => Promise<unknown>;
}) {
  return (
    <section className="border-t" aria-label="Feedback" data-feedback-panel>
      <header className="flex items-center gap-2 pt-3 pb-2">
        <h2 className="text-base font-semibold">Feedback</h2>
        {feedback.length > 0 && <Count>{feedback.length}</Count>}
        {canPin ? (
          <Hint label="Pin a comment to an element. The agent sees it with your next Regenerate" side="left">
            <Button variant="outline" className="ml-auto" aria-pressed={picking} aria-expanded={composing} data-edge={asked || undefined} data-pick-toggle onClick={onPickToggle}>
              <MessageSquarePlus data-icon="inline-start" aria-hidden />
              {/* Pressed while a pick is on; the canvas bar's chip names the mode and its way out. */}
              Pin comment
            </Button>
          </Hint>
        ) : (
          <BlockedHint label={pinBlocked} side="left" className="ml-auto" data-pick-blocked>
            <Button variant="outline" disabled data-pick-toggle>
              <MessageSquarePlus data-icon="inline-start" aria-hidden />
              Pin comment
            </Button>
          </BlockedHint>
        )}
      </header>
      {feedback.length === 0 ? (
        <p className="pb-4 text-sm text-fg-muted" data-feedback-empty>
          No comments yet
        </p>
      ) : (
        GROUPS.map(({ state, title }) => {
          const items = feedback.filter((f) => f.status.state === state);
          if (items.length === 0) return null;
          return (
            <div key={state} inert={past} className={cn("pb-2", past && "opacity-60")} data-group={state}>
              <h3 className="flex items-center gap-1.5 pt-1 pb-1 text-xs font-medium">
                {title}
                <Count>{items.length}</Count>
              </h3>
              <ul>
                {items.map((f) => (
                  <FeedbackItem
                    key={f.id}
                    feedback={f}
                    block={blocks.find((b) => b.id === f.pin.blockId) ?? null}
                    place={place(f)}
                    focused={focused?.id === f.id}
                    reveal={focused?.id === f.id ? focused.seq : 0}
                    echoed={echoed === f.id}
                    onHover={onHover}
                    onOpen={() => onOpen(f)}
                    send={send}
                  />
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}

function FeedbackItem({
  feedback: f,
  block,
  place,
  focused,
  reveal,
  echoed,
  onHover,
  onOpen,
  send,
}: {
  feedback: Feedback;
  block: BlockView | null;
  place: PinPlace;
  focused: boolean;
  /** Which focus this is, so each one reveals the comment again. */
  reveal: number;
  echoed: boolean;
  onHover: (id: FeedbackId | null) => void;
  onOpen: () => void;
  send: (action: RobAction) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [metaCut, setMetaCut] = useState(false);
  const item = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const el = item.current;
    const pane = el?.closest<HTMLElement>("[data-slot=scroll-pane]");
    const section = el?.closest<HTMLElement>("[data-feedback-panel]");
    if (!focused || el == null || pane == null || section == null) return;
    const [box, r, s] = [pane.getBoundingClientRect(), el.getBoundingClientRect(), section.getBoundingClientRect()];
    if (r.top >= box.top && r.bottom <= box.bottom) return;
    // A reveal stops on a seam, never through a control: under the section's rule, which the pane head's then stands for,
    // when the comment fits below it, else the comment's top.
    const head = s.top + section.clientTop;
    const seam = r.bottom - head <= pane.clientHeight ? head : r.top;
    pane.scrollBy({ top: seam - box.top, behavior: "smooth" });
  }, [focused, reveal]);
  const line = statusLine(f.status);
  const where = pinWhere(f.pin, block);
  const run = (action: FeedbackAction) => {
    switch (action) {
      case "edit":
        return setEditing(true);
      case "delete":
        return setConfirming(true);
      case "confirm":
        return void send({ kind: "confirm_feedback", id: f.id });
      case "reopen":
        return void send({ kind: "reopen_feedback", id: f.id });
    }
  };

  return (
    <li
      ref={item}
      data-feedback={f.id}
      data-status={f.status.state}
      data-place={place}
      data-focused={focused || undefined}
      data-echoed={echoed || undefined}
      data-tint={focused || echoed || undefined}
      onPointerEnter={() => onHover(f.id)}
      onPointerLeave={() => onHover(null)}
      className="group relative -mx-1 rounded-lg px-1 py-2 hover:bg-hover/60 data-[echoed]:bg-hover/60 data-[focused]:bg-selected scrolling:mr-1"
    >
      <div className="flex gap-2">
        {/* On the first line of text: the comment's at rest, the field's while editing it. */}
        <PinNumber aria-hidden n={f.id} state={f.status.state} className={editing ? "mt-1.5" : "mt-px"} />
        {/* A field and its buttons stand 8 px off the fill's right edge, where text needs only 4. */}
        <div className={cn("min-w-0 flex-1", editing && "pr-1")}>
          {editing ? (
            <TextEditor
              row
              initial={f.text}
              submitLabel="Save"
              onCancel={() => setEditing(false)}
              onSubmit={async (text) => {
                await send({ kind: "edit_feedback", id: f.id, text });
                setEditing(false);
              }}
            />
          ) : (
            <button type="button" onClick={onOpen} className="block w-full text-left text-sm/snug whitespace-pre-wrap" data-feedback-text>
              {f.text}
            </button>
          )}
          {!editing && (
            <>
              {/* Out into the canvas, off the item's status and actions, and only when the line is cut. While Delete asks, the line asks the question, so it reads before its answers. */}
              <Hint label={where} side="left" disabled={!metaCut || confirming}>
                <Truncate
                  className={cn("pt-1 text-xs/snug", confirming ? "text-fg" : "text-fg-muted")}
                  onPointerEnter={(e) => setMetaCut(overflows(e.currentTarget))}
                  data-feedback-meta
                  data-feedback-question={confirming || undefined}
                >
                  {confirming ? "Delete this comment?" : where}
                </Truncate>
              </Hint>
              {line !== null && (
                <p className="text-xs/snug text-fg-muted" data-feedback-status>
                  {line}
                </p>
              )}
              {/* A lost pin is a fault, so amber; one on a variant that isn't showing is only where it is. */}
              {place === "hidden" ? (
                <p className="flex items-center gap-1 pt-0.5 text-xs/snug text-fg-muted" data-feedback-place>
                  <EyeOff aria-hidden className="size-3 shrink-0" />
                  {PLACE_NOTE[place]}
                </p>
              ) : (
                place !== "placed" && (
                  <p className="pt-0.5 text-xs/snug text-warning" data-feedback-place>
                    {PLACE_NOTE[place]}
                  </p>
                )
              )}
              {confirming ? (
                <DeleteConfirm
                  onDelete={() => void send({ kind: "delete_feedback", id: f.id })}
                  onCancel={() => {
                    flushSync(() => setConfirming(false));
                    item.current?.querySelector<HTMLElement>('[data-feedback-action="delete"]')?.focus();
                  }}
                />
              ) : (
                <div className="flex gap-2 pt-1.5 empty:hidden">
                  {FEEDBACK_ACTIONS[f.status.state].map((action) =>
                    action === "edit" ? (
                      // Held as wide as the Cancel that takes its place, so Delete stays under the pointer when it asks.
                      <span key={action} className="grid *:col-start-1 *:row-start-1">
                        <Button variant="outline" onClick={() => run(action)} data-feedback-action={action}>
                          {ACTION_LABEL[action]}
                        </Button>
                        <span aria-hidden className="invisible flex">
                          <Button variant="ghost">Cancel</Button>
                        </span>
                      </span>
                    ) : (
                      <Button key={action} variant={action === "delete" ? "destructive" : "outline"} onClick={() => run(action)} data-feedback-action={action}>
                        {ACTION_LABEL[action]}
                      </Button>
                    ),
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Delete asks once, in place, with Cancel focused so a second Enter keeps the comment. Cancel takes Edit's place and
 * Delete stays where it was, so the pointer that pressed Delete is still on it. The item's meta line asks the question above them.
 */
function DeleteConfirm({ onDelete, onCancel }: { onDelete: () => void; onCancel: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => cancel.current?.focus(), []);
  return (
    <div
      role="group"
      aria-label="Delete this comment?"
      className="flex items-center gap-2 pt-1.5"
      data-feedback-confirm
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <Button ref={cancel} variant="ghost" onClick={onCancel} data-feedback-cancel>
        Cancel
      </Button>
      <Button variant="destructive" onClick={onDelete} data-feedback-delete>
        Delete
      </Button>
    </div>
  );
}

/** Where a comment is pinned, the part read as words, as the vary popover names it ("Spin button", not "spin-button"). */
const pinWhere = (pin: Pin, block: BlockView | null | undefined) => `${block?.title ?? pin.blockId} · ${pin.part === null ? "whole block" : partLabel(pin.part)}`;

/** `overlay` puts the actions in the popover footer, for an editor that is a whole overlay rather than part of a row. */
export function TextEditor({
  initial,
  placeholder,
  submitLabel,
  overlay = false,
  row = false,
  onSubmit,
  onCancel,
}: {
  initial: string;
  placeholder?: string;
  submitLabel: string;
  overlay?: boolean;
  /** In a feedback row, beside its pin's disc: the field pads 6 px, so its first line sits where the disc can meet it. */
  row?: boolean;
  onSubmit: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    area.current?.focus();
    area.current?.setSelectionRange(text.length, text.length);
  }, []);
  const submit = async () => {
    if (text.trim() === "" || busy) return;
    setBusy(true);
    try {
      await onSubmit(text.trim());
    } finally {
      setBusy(false);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit();
  };
  const actions = (
    <>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <SubmitKey disabled={text.trim() === "" || busy}>
        <Button variant="accent" disabled={text.trim() === "" || busy} onClick={() => void submit()} data-editor-submit>
          {submitLabel}
        </Button>
      </SubmitKey>
    </>
  );
  const field = (
    <Textarea ref={area} rows={3} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} className={row ? "resize-none py-1.5" : "resize-none"} />
  );
  return overlay ? (
    <>
      {field}
      <PopoverFooter>{actions}</PopoverFooter>
    </>
  ) : (
    <div className="grid gap-2">
      {field}
      <div className="flex items-center justify-end gap-1.5">{actions}</div>
    </div>
  );
}

export function PinComposer({
  pin,
  at,
  rect,
  block,
  bounds,
  onSave,
  onCancel,
}: {
  pin: Pin;
  at: { x: number; y: number };
  rect: CanvasRect;
  block: BlockView | null;
  bounds: { width: number; height: number };
  onSave: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { ref, left, top } = useComposerPlace(at, rect, bounds, POPOVER_WIDTH.sm);
  return (
    <>
      {/* The pin to be, where the saved pin will land: on the element's top right corner, not over its text. */}
      <span
        aria-hidden
        className="pointer-events-none absolute z-popover grid size-5 place-items-center rounded-full rounded-bl-sm bg-accent text-accent-fg ring-2 ring-card"
        style={{ left: rect.x + rect.width - 10, top: rect.y - 10 }}
        data-composer-pin
      >
        <Plus className="size-3" />
      </span>
      <OverlayPanel ref={ref} role="dialog" aria-labelledby="composer-title" data-composer data-open="" style={{ left, top }}>
        <OverlayHeader id="composer-title" heading="New comment" description={pinWhere(pin, block)} />
        <TextEditor overlay initial="" placeholder="What should change here?" submitLabel="Pin comment" onSubmit={onSave} onCancel={onCancel} />
      </OverlayPanel>
    </>
  );
}
