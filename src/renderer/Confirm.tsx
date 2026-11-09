import { Check, GitBranch } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SubmitKey } from "@/components/ui/kbd";
import { FieldLabel } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverFooter, PopoverHeader, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { BlockedHint } from "@/components/ui/tooltip";
import { Truncate } from "@/components/ui/truncate";
import { confirmLines, confirmPlan } from "../core/main";
import { partLabel } from "../core/part";
import { blockIdOf, type BlockId, type BlockView, type IterationN, type Marks, type SlotView } from "../core/types";

/**
 * Confirm, at the foot of the sidebar (ADR 009). At the latest it locks Rob's marks in; on a past iteration it makes a
 * branch from there with them. The popover lists what each slot becomes before anything is sent.
 */
export function ConfirmButton({
  slots,
  blocks,
  marks,
  past,
  blocked,
  lost,
  onConfirm,
}: {
  slots: readonly SlotView[];
  blocks: readonly BlockView[];
  marks: Marks;
  /** The past iteration on the canvas, or null at the latest. */
  past: IterationN | null;
  /** Why nothing can be sent now: a request is open in the brainstorm, or the marks are locked. */
  blocked: string | null;
  /**
   * Why nothing can go to the agent now: the thread is gone. A confirm the app writes itself, with no grafts and no
   * instruction, still can (ADR 009).
   */
  lost: string | null;
  /** Sends; false keeps the popover open, since the failure already shows. */
  onConfirm: (instruction: string | null) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const plan = confirmPlan(slots, marks);
  const branching = past !== null;
  const label = branching ? "Confirm as a branch" : "Confirm";
  const nothing = plan === null && !branching ? "Nothing to confirm yet: give a design a thumbs up, trash an option or pick an element" : null;
  // With nothing marked, a branch can only ask the agent, by its instruction; with grafts, so does any confirm.
  const held = lost !== null && (plan === null || plan.grafts.length > 0) ? lost : null;
  const reason = blocked ?? held ?? nothing;
  const foot = useRef<HTMLButtonElement>(null);
  const trigger = (
    <Button ref={foot} variant="accent" className="w-full" disabled={reason !== null} data-confirm-toggle={branching ? "branch" : "latest"}>
      {branching ? <GitBranch data-icon="inline-start" aria-hidden /> : <Check data-icon="inline-start" aria-hidden />}
      {label}
    </Button>
  );
  if (reason !== null) {
    return (
      <BlockedHint label={reason} side="right" className="w-full" data-confirm-blocked>
        {trigger}
      </BlockedHint>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent size="md" side="right" align="end" alignOffset={() => clearOfStrip(foot.current)} data-confirm-menu>
        <PopoverHeader
          heading={label}
          description={
            branching
              ? `A new branch from iteration ${past}, on this brainstorm's thread. The main line stays as it is.`
              : "Main becomes the design going forward, and the other options go. Earlier iterations stay in history."
          }
        />
        <ConfirmForm slots={slots} blocks={blocks} marks={marks} branching={branching} lost={lost} onConfirm={onConfirm} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/** The popover's gap above the history strip, the popover's own gap from its trigger. */
const STRIP_GAP = 6;

/**
 * How far the popover rises from Confirm's foot so it ends above the history strip, which runs level with the sidebar's
 * foot, rather than sitting on the strip's edge. Nothing while the strip is shut or already below it.
 */
function clearOfStrip(trigger: HTMLElement | null): number {
  const strip = document.querySelector("[data-history]")?.getBoundingClientRect();
  if (trigger === null || strip === undefined) return 0;
  return Math.max(0, trigger.getBoundingClientRect().bottom - strip.top + STRIP_GAP);
}

function ConfirmForm({
  slots,
  blocks,
  marks,
  branching,
  lost,
  onConfirm,
  onClose,
}: {
  slots: readonly SlotView[];
  blocks: readonly BlockView[];
  marks: Marks;
  branching: boolean;
  lost: string | null;
  onConfirm: (instruction: string | null) => Promise<boolean>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const plan = confirmPlan(slots, marks);
  const lines = plan === null ? [] : confirmLines(slots, plan);
  const titleOf = (id: BlockId) => blocks.find((b) => b.id === id)?.title ?? id;
  const grafting = plan !== null && plan.grafts.length > 0;
  const instruction = text.trim() === "" ? null : text.trim();
  const toAgent = grafting || instruction !== null;
  // An instruction typed on a lost thread would go to the agent, so Confirm holds and a line above the footer says why.
  const held = toAgent ? lost : null;
  const ready = (plan !== null || instruction !== null) && held === null;

  const submit = async () => {
    if (!ready || sending) return;
    setSending(true);
    const ok = await onConfirm(branching ? instruction : null);
    setSending(false);
    if (ok) onClose();
  };
  // Ctrl+Enter sends while the popover is open, wherever focus sits in it, as the key beside Confirm says. The form is
  // mounted only while the popover shows, so the listener lives exactly as long.
  const latest = useRef(submit);
  useEffect(() => {
    latest.current = submit;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      void latest.current();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <div className="grid gap-1.5" data-confirm-lines={lines.length}>
        <FieldLabel as="h3">{branching ? "The branch starts with" : "Each slot becomes"}</FieldLabel>
        {lines.length === 0 ? (
          <p className="rounded-lg border border-border-strong bg-muted p-3 text-sm text-fg-muted">Every slot as it is on this iteration</p>
        ) : (
          <dl className="grid-carry grid gap-x-3 gap-y-2 rounded-lg border border-border-strong bg-muted p-3 text-sm/snug">
            {lines.map((line) => {
              const slot = slots.find((s) => s.id === line.slot)!;
              return (
                <div key={line.slot} className="contents" data-confirm-slot={line.slot}>
                  <dt className="flex min-w-0 text-xs text-fg-muted">
                    <Truncate>{slot.title}</Truncate>
                  </dt>
                  <dd className="grid min-w-0 gap-0.5">
                    <Truncate>{line.keeps.length === 1 ? titleOf(blockIdOf(slot.id, line.keeps[0]!)) : `${line.keeps.length} variants`}</Truncate>
                    {line.grafts.map((g, i) => (
                      <span key={i} className="grid text-xs" data-confirm-graft>
                        <Truncate>{`+ ${g.from.part === null ? titleOf(g.from.blockId) : partLabel(g.from.part)} from ${titleOf(g.from.blockId)}`}</Truncate>
                        {/* What Rob asked of the agent for it, whole, since this is the last look before it goes. */}
                        {g.instruction !== null && <span className="pl-3 break-words text-fg-muted">“{g.instruction}”</span>}
                      </span>
                    ))}
                    {line.dropped > 0 && (
                      <span className="text-xs text-fg-muted" data-confirm-dropped={line.dropped}>
                        {line.dropped === 1 ? "1 option goes" : `${line.dropped} options go`}
                      </span>
                    )}
                    {line.dropped === 0 && line.grafts.length === 0 && (
                      <span className="text-xs text-fg-muted" data-confirm-unchanged>
                        As it is
                      </span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </div>
      {branching && (
        <label className="grid gap-1.5">
          <FieldLabel aside="optional">What should the branch try?</FieldLabel>
          <Textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="A darker take on the result sheet"
            className="resize-none"
            data-confirm-instruction
          />
        </label>
      )}
      {/* Whole, on its own line, since the footer's hint has room only for a few words. */}
      {held !== null && (
        <p className="text-xs/snug text-warning" data-confirm-held>
          {held}
        </p>
      )}
      <PopoverFooter
        hint={
          <span data-confirm-hint>
            {toAgent ? "Goes to the agent" : "Applies at once"}
          </span>
        }
      >
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <SubmitKey disabled={!ready || sending}>
          <Button variant="accent" disabled={!ready || sending} onClick={() => void submit()} data-confirm-send>
            {sending && <Spinner data-icon="inline-start" />}
            {sending ? "Confirming…" : "Confirm"}
          </Button>
        </SubmitKey>
      </PopoverFooter>
    </>
  );
}
