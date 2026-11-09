import { AlertTriangle, Check, CircleAlert, CircleHelp, CircleSlash, Clock, ExternalLink, Info, RefreshCw, RotateCw, Send, Sparkles, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { SubmitKey } from "@/components/ui/kbd";
import { FieldLabel } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverFooter, PopoverHeader, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { BlockedHint, Hint } from "@/components/ui/tooltip";
import { Truncate } from "@/components/ui/truncate";
import { Count } from "@/components/ui/count";
import { partLabel } from "../core/fork";
import { blockedMessage, requestFeedback } from "../core/machines";
import { actionRank, COLLAPSE, COMPACT, COMPACT_LABEL } from "./headerAction";
import { PHASE, TONE_TEXT } from "./status";
import { Elapsed } from "./SessionStatus";
import { PinNumber } from "./PinNumber";
import { useNow } from "./time";
import type { BlockId, BlockView, IterationN, RequestBody, RequestPhase, RequestPhaseAction, RequestScope, RobAction, SessionView } from "../core/types";

/** Vary, Confirm and Add slot have their own controls, so Regenerate offers the other three. */
type ScopeKind = "all" | "blocks" | "described";

const SCOPES: readonly { value: ScopeKind; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "blocks", label: "Selected blocks" },
  { value: "described", label: "Describe it" },
];

function scopeOf(kind: ScopeKind, chosen: readonly BlockId[]): RequestScope | null {
  if (kind === "all" || kind === "described") return { kind };
  const [first, ...rest] = chosen;
  return first === undefined ? null : { kind, blocks: [first, ...rest] };
}

function requestBody(scope: RequestScope | null, text: string): RequestBody | null {
  const freetext = text.trim() === "" ? null : text.trim();
  if (scope === null) return null;
  if (scope.kind === "described" || scope.kind === "add_slot") return freetext === null ? null : { scope, freetext };
  return { scope, freetext };
}

export function Regenerate({
  view,
  selected,
  past,
  send,
}: {
  view: SessionView;
  selected: BlockId | null;
  /** A past iteration on the canvas: history is read-only, so Regenerate waits for Back to latest. */
  past: IterationN | null;
  send: (action: RobAction) => Promise<SessionView | null>;
}) {
  const [open, setOpen] = useState(false);
  const gate = past === null ? view.regenerate : null;
  useEffect(() => {
    if (gate === null || !gate.ok) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "r") return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gate?.ok]);
  if (gate === null || !gate.ok) {
    return (
      <BlockedHint name="Regenerate" label={gate === null ? `Back to latest first. You are viewing iteration ${past}.` : blockedMessage(gate.reason, view.request?.request.n)} side="left" data-regenerate-blocked>
        <Button variant="accent" disabled data-regenerate-toggle>
          <RegenerateLabel />
        </Button>
      </BlockedHint>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* To the left, so it never covers the Inspector's heading under the bar. */}
      <Hint name="Regenerate" label="Ask the agent for a new iteration" shortcut="Ctrl+R" side="left">
        <PopoverTrigger render={<Button variant="accent" data-regenerate-toggle />}>
          <RegenerateLabel />
        </PopoverTrigger>
      </Hint>
      <PopoverContent size="md" align="end" data-regenerate-menu>
        <PopoverHeader heading="Regenerate" description={`${view.session.title} · a new iteration from the agent`} />
        <RegenerateForm view={view} selected={selected} onClose={() => setOpen(false)} send={send} />
      </PopoverContent>
    </Popover>
  );
}

/** Regenerate's one shape in every state, loading and blocked included; the header fit alone decides when its glyph goes. */
export function RegenerateLabel() {
  return (
    <>
      <Sparkles data-icon="inline-start" data-collapse={COLLAPSE.glyph} className="data-collapsed:hidden" aria-hidden />
      Regenerate
    </>
  );
}

function RegenerateForm({
  view,
  selected,
  onClose,
  send,
}: {
  view: SessionView;
  selected: BlockId | null;
  onClose: () => void;
  send: (action: RobAction) => Promise<SessionView | null>;
}) {
  const blocks = view.iteration?.blocks ?? [];
  const slots = view.iteration?.slots ?? [];
  const [kind, setKind] = useState<ScopeKind>("all");
  const [chosen, setChosen] = useState<ReadonlySet<BlockId>>(new Set(selected === null ? [] : [selected]));
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const scope = scopeOf(
    kind,
    blocks.filter((b) => chosen.has(b.id)).map((b) => b.id),
  );
  const body = requestBody(scope, text);
  const missing = body !== null ? null : kind === "blocks" ? "Pick a block to send" : "Describe the change to send";
  const attached = scope === null ? [] : requestFeedback(view.feedback, scope);
  const toggle = (id: BlockId) =>
    setChosen((c) => {
      const next = new Set(c);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const submit = async () => {
    if (body === null || sending) return;
    setSending(true);
    const result = await send({ kind: "regenerate", ...body });
    setSending(false);
    if (result !== null) onClose();
  };

  return (
    <>
      <Segmented value={kind} onValueChange={setKind} options={SCOPES} itemData="scope" aria-label="Scope" />
      {/* The field sits right under the scope, so neither moves when a scope adds its block list below. */}
      <label className="grid gap-1.5">
        <FieldLabel aside={kind === "described" ? undefined : "optional"}>Instruction</FieldLabel>
        <Textarea
          rows={3}
          value={text}
          data-freetext
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && void submit()}
          placeholder={kind === "described" ? "What should change?" : "Anything to add?"}
          className="resize-none"
        />
      </label>

      {kind === "blocks" && (
        <div className="grid gap-2" data-block-choices>
          {slots.map((slot) => (
            <fieldset key={slot.id} className="grid gap-0.5">
              <FieldLabel as="legend">{slot.title}</FieldLabel>
              {blocks
                .filter((b) => b.slot === slot.id)
                .map((b) => (
                  <BlockChoice key={b.id} block={b} showing={b.variant === slot.active} checked={chosen.has(b.id)} onToggle={() => toggle(b.id)} />
                ))}
            </fieldset>
          ))}
        </div>
      )}
      {kind === "all" && <p className="text-fg-muted">The agent may change any block, in every slot.</p>}
      {kind === "described" && <p className="text-fg-muted">The agent picks the blocks from what you write.</p>}

      <div className="grid min-w-0 gap-1" data-attached-feedback>
        <FieldLabel as="h3">
          {attached.length === 0 ? (
            "No open feedback in scope"
          ) : (
            <>
              Open feedback sent with it
              <Count>{attached.length}</Count>
            </>
          )}
        </FieldLabel>
        {attached.map((f) => (
          <p key={f.id} className="flex min-w-0 gap-1.5 text-sm/snug" data-attached={f.id}>
            <PinNumber n={f.id} state="open" />
            <Hint label={f.text} side="left">
              <Truncate>{f.text}</Truncate>
            </Hint>
            <span className="ml-auto shrink-0 text-fg-muted">{f.pin.part === null ? "whole block" : partLabel(f.pin.part)}</span>
          </p>
        ))}
      </div>

      {/* A disabled Send can't show a Hint, so the footer says what it is waiting for. */}
      <PopoverFooter hint={<span data-send-hint>{missing ?? "Goes to the T3 thread"}</span>}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <SubmitKey disabled={body === null || sending}>
          <Button variant="accent" disabled={body === null || sending} onClick={() => void submit()} data-send>
            {sending && <Spinner data-icon="inline-start" />}
            {sending ? "Sending…" : "Send"}
          </Button>
        </SubmitKey>
      </PopoverFooter>
    </>
  );
}

function BlockChoice({ block, showing, checked, onToggle }: { block: BlockView; showing: boolean; checked: boolean; onToggle: () => void }) {
  return (
    <label className="-mx-1.5 flex h-7 cursor-pointer items-center gap-2 rounded-md px-1.5 hover:bg-hover" data-choice={block.id} data-showing={showing || undefined}>
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <Truncate>{block.title}</Truncate>
      {/* The sidebar's mark for the showing variant, so the tag column only ever holds tags. */}
      {showing && (
        <span className="flex shrink-0 items-center">
          <span aria-hidden className="size-1.5 rounded-full bg-fg-muted" />
          <span className="sr-only">showing</span>
        </span>
      )}
      <span className="ml-auto shrink-0 text-xs text-fg-muted">{block.variant}</span>
    </label>
  );
}

/** The phase's glyph in its tone from the one phase table. */
function PhaseIcon({ phase }: { phase: RequestPhase["phase"] }) {
  const cls = `size-4 shrink-0 ${TONE_TEXT[PHASE[phase].tone]}`;
  switch (phase) {
    case "sending":
      return <Spinner className={cls} aria-hidden data-progress />;
    case "working":
      // A live dot in a 14 px halo, the optical size of the other phases' glyphs.
      return (
        <span aria-hidden className="relative grid size-4 shrink-0 place-items-center" data-progress>
          <span className="absolute size-2 animate-ping rounded-full bg-accent/60" />
          <span className="grid size-3.5 place-items-center rounded-full bg-accent/25" data-phase-glyph>
            <span className="size-2 rounded-full bg-accent" />
          </span>
        </span>
      );
    case "queued":
      return <Clock className={cls} aria-hidden />;
    case "asking":
      return <CircleHelp className={cls} aria-hidden />;
    case "no_change":
      return <Info className={cls} aria-hidden />;
    case "fulfilled":
      return <Check className={cls} aria-hidden />;
    case "withdrawn":
      // A state, not an action, so not the undo arrow a button would carry.
      return <CircleSlash className={cls} aria-hidden />;
    case "send_failed":
    case "run_failed":
      return <CircleAlert className={cls} aria-hidden />;
    case "previous_thread":
    case "thread_lost":
      return <AlertTriangle className={cls} aria-hidden />;
  }
}

const ACTION_LABEL: Record<RequestPhaseAction, string> = {
  retry: "Retry",
  resend: "Resend",
  withdraw: "Withdraw",
  open_thread: "Open thread",
  fresh_thread: "Start a fresh thread",
};

/** What each action does, for its hint once a narrow header leaves it its icon alone. */
const ACTION_HINT: Record<Exclude<RequestPhaseAction, "open_thread">, string> = {
  retry: "Send the request again",
  resend: "Send the request to the thread that took over",
  withdraw: "Withdraw the request",
  fresh_thread: "Carry on in a new T3 thread, and send the open request there",
};

const ACTION_ICON: Partial<Record<RequestPhaseAction, LucideIcon>> = {
  retry: RotateCw,
  resend: Send,
  withdraw: CircleSlash,
  open_thread: ExternalLink,
  fresh_thread: RefreshCw,
};

/**
 * Phases that need more than the bar has room for: an error, the agent's reply, or what the next step does. The bar
 * names the phase and the strip under it says the rest, in the phase's tone, so nothing Rob has to read is cut off.
 * `own` is an action the strip carries instead of the bar, beside what it acts on.
 */
const DETAIL: Partial<Record<RequestPhase["phase"], { readonly label: string; readonly note?: string; readonly own?: RequestPhaseAction }>> = {
  send_failed: { label: "Send failed" },
  run_failed: { label: "Run failed", note: "The agent's run failed in T3. Open the thread to see why, or Retry." },
  thread_lost: { label: "Thread lost", note: "This brainstorm's thread is gone. Start a fresh thread, and the open request goes to it." },
  previous_thread: { label: "Sent to the previous thread", note: "Another thread took this brainstorm over. Resend sends the request to it." },
  no_change: { label: "No change", note: "The agent replied in T3 without changing the design." },
};

/**
 * The request's phase in the header: its glyph, its words in the phase's tone, and how long it has been open, as the
 * sidebar counts it. A short header gives up the time first, then the long words for the phase's short name, since
 * the glyph and tone still say it and the strip keeps any detail.
 */
export function RequestStatus({ view }: { view: SessionView }) {
  const request = view.request;
  // A lost thread stays named once its request closes, since nothing can be sent until it is taken over.
  const lost = view.attachment.lostAt !== null && (request === null || request.phase.actions.length === 0);
  const counting = !lost && request !== null && PHASE[request.phase.phase].ended !== true;
  const now = useNow(counting ? 1_000 : undefined);
  if (!lost && request === null) return null;
  const phase = lost ? "thread_lost" : request!.phase.phase;
  const detail = DETAIL[phase];
  const long = detail?.label ?? request!.message;
  const short = PHASE[phase].short;
  return (
    <div
      className={`grid-phase grid items-center gap-2 text-sm ${TONE_TEXT[PHASE[phase].tone]}`}
      data-request-phase={request?.phase.phase}
      data-thread-lost={lost || undefined}
      data-collapse={short === long ? undefined : COLLAPSE.status}
    >
      <PhaseIcon phase={phase} />
      <Truncate
        className={cn(detail !== undefined && "font-medium", short !== long && "in-data-collapsed:hidden")}
        data-request-message={detail === undefined || undefined}
        data-request-label={detail !== undefined || undefined}
      >
        {long}
      </Truncate>
      {short !== long && (
        <Truncate className={cn("hidden in-data-collapsed:block", detail !== undefined && "font-medium")} data-request-short>
          {short}
        </Truncate>
      )}
      {counting && <Elapsed since={request!.request.sentAt ?? request!.request.createdAt} now={now} rank={COLLAPSE.elapsed} />}
    </div>
  );
}

/** The phase's actions that the bar shows; one the strip under the bar holds itself stays there. */
export function phaseActions(view: SessionView): readonly RequestPhaseAction[] {
  if (view.request === null) return [];
  const own = DETAIL[view.request.phase.phase]?.own;
  return view.request.phase.actions.filter((action) => action !== own);
}

/**
 * The request's actions, in the header's right cluster before Regenerate. Anchored there, they stay put as the phase's
 * label changes length, so Withdraw sits at one x from queued to working. The phase's recovery keeps its name longest
 * (`actionRank`).
 */
export function PhaseActions({ view, send }: { view: SessionView; send: (action: RobAction) => Promise<unknown> }) {
  const actions = phaseActions(view);
  return (
    <span className="flex shrink-0 items-center gap-2" data-phase-actions>
      {actions.map((action) => (
        <PhaseAction key={action} action={action} rank={actionRank(action)} view={view} send={send} />
      ))}
    </span>
  );
}

/** The full message of a phase the bar only names, as a strip under the top bar. */
export function RequestDetail({ view }: { view: SessionView }) {
  const detail = view.request === null ? undefined : DETAIL[view.request.phase.phase];
  if (view.request === null || detail === undefined) return null;
  return (
    <Callout
      tone={stripTone(view.request.phase.phase)}
      layout="strip"
      role="status"
      data-request-detail
    >
      <p className="select-text" data-request-message>
        {detail.note ?? view.request.message}
      </p>
    </Callout>
  );
}

/** A strip's tone is its phase's, from the one table; every phase with a strip is a status hue. */
function stripTone(phase: RequestPhase["phase"]): "danger" | "warning" | "info" {
  const tone = PHASE[phase].tone;
  return tone === "danger" || tone === "warning" ? tone : "info";
}

function PhaseAction({
  action,
  rank,
  view,
  send,
}: {
  action: RequestPhaseAction;
  rank: number;
  view: SessionView;
  send: (action: RobAction) => Promise<unknown>;
}) {
  switch (action) {
    case "retry":
    case "resend":
      return <ActionButton action={action} rank={rank} onClick={() => void send({ kind: "retry_request" })} />;
    case "withdraw":
      return <ActionButton action={action} rank={rank} onClick={() => void send({ kind: "withdraw_request" })} />;
    case "open_thread":
      return <OpenThread view={view} rank={rank} />;
    case "fresh_thread":
      return <ActionButton action={action} rank={rank} onClick={() => void send({ kind: "refresh_thread" })} />;
  }
}

function OpenThread({ view, rank }: { view: SessionView; rank: number }) {
  if (view.thread === null) return null;
  return (
    <Hint name={ACTION_LABEL.open_thread} label={`${view.thread.title}, in T3`} side="left">
      <Button variant="outline" className={COMPACT} nativeButton={false} render={<a href={view.thread.link} target="_blank" rel="noreferrer" />} data-collapse={rank} data-request-action="open_thread">
        <ActionLabel action="open_thread" />
      </Button>
    </Hint>
  );
}

/** Phase actions are full-height outline buttons, the same size as Regenerate and Export beside them. */
function ActionButton({ action, rank, onClick }: { action: keyof typeof ACTION_HINT; rank: number; onClick: () => void }) {
  return (
    <Hint name={ACTION_LABEL[action]} label={ACTION_HINT[action]} side="left">
      <Button variant="outline" className={COMPACT} onClick={onClick} data-collapse={rank} data-request-action={action}>
        <ActionLabel action={action} />
      </Button>
    </Hint>
  );
}

/** An action's icon and name, the name given up for the icon alone in a narrow header, as Export does. */
function ActionLabel({ action }: { action: RequestPhaseAction }) {
  const Icon = ACTION_ICON[action];
  return (
    <>
      {Icon !== undefined && <Icon data-icon="inline-start" aria-hidden />}
      <span className={COMPACT_LABEL}>{ACTION_LABEL[action]}</span>
    </>
  );
}
