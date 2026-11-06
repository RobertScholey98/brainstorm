import { AlertTriangle, Check, CircleAlert, CircleHelp, CircleSlash, Clock, ExternalLink, Info, RotateCw, Send, Trash2, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { chip } from "@/components/ui/chip";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverFooter, PopoverHeader, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Hint } from "@/components/ui/tooltip";
import { blockedMessage, requestFeedback, takeoverPhrase } from "../core/machines";
import { COMPACT, COMPACT_LABEL } from "./headerAction";
import type { BlockId, BlockView, IterationN, RequestBody, RequestPhase, RequestPhaseAction, RequestScope, RobAction, SessionView } from "../core/types";

/** Vary has its own pick and popover, so Regenerate offers the other three. */
type ScopeKind = Exclude<RequestBody["scope"]["kind"], "vary">;

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
  if (scope.kind === "described") return freetext === null ? null : { scope, freetext };
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
      <Hint label={gate === null ? `Back to latest to regenerate. You are viewing iteration ${past}.` : blockedMessage(gate.reason, view.request?.request.n)} side="left">
        <span tabIndex={0} data-regenerate-blocked>
          <Button variant="accent" disabled data-regenerate-toggle>
            Regenerate
          </Button>
        </span>
      </Hint>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* To the left, so it never covers the Inspector's heading under the bar. */}
      <Hint label="Ask the agent for a new iteration" shortcut="Ctrl+R" side="left">
        <PopoverTrigger render={<Button variant="accent" data-regenerate-toggle />}>Regenerate</PopoverTrigger>
      </Hint>
      <PopoverContent size="md" align="end" data-regenerate-menu>
        <PopoverHeader heading="Regenerate" description="Ask the agent for a new iteration." />
        <RegenerateForm view={view} selected={selected} onClose={() => setOpen(false)} send={send} />
      </PopoverContent>
    </Popover>
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
      <Textarea
        rows={3}
        value={text}
        aria-label="Free text"
        data-freetext
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && void submit()}
        placeholder={kind === "described" ? "What should change?" : "Anything to add? (optional)"}
        className="resize-none"
      />

      {kind === "blocks" && (
        <div className="grid gap-2" data-block-choices>
          {slots.map((slot) => (
            <fieldset key={slot.id} className="grid gap-0.5">
              <legend className="pb-0.5 text-xs font-medium text-fg-muted">{slot.title}</legend>
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
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
          {attached.length === 0 ? (
            "No open feedback in scope"
          ) : (
            <>
              Open feedback sent with it
              <Badge>{attached.length}</Badge>
            </>
          )}
        </h3>
        {attached.map((f) => (
          <p key={f.id} className="flex min-w-0 gap-1.5 text-sm/snug" data-attached={f.id}>
            <span className="shrink-0 font-semibold tabular-nums text-accent">#{f.id}</span>
            <Hint label={f.text} side="left">
              <span className="min-w-0 truncate">{f.text}</span>
            </Hint>
            <span className="ml-auto shrink-0 text-fg-muted">{f.pin.part ?? "whole block"}</span>
          </p>
        ))}
      </div>

      {/* A disabled Send can't show a Hint, so the footer says what it is waiting for. */}
      <PopoverFooter hint={<span data-send-hint>{missing ?? "Goes to the attached T3 thread"}</span>}>
        <Kbd disabled={body === null || sending}>Ctrl+Enter</Kbd>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="accent" disabled={body === null || sending} onClick={() => void submit()} data-send>
          {sending && <Spinner data-icon="inline-start" />}
          {sending ? "Sending…" : "Send"}
        </Button>
      </PopoverFooter>
    </>
  );
}

function BlockChoice({ block, showing, checked, onToggle }: { block: BlockView; showing: boolean; checked: boolean; onToggle: () => void }) {
  return (
    <label className="-mx-1.5 flex h-7 cursor-pointer items-center gap-2 rounded-md px-1.5 hover:bg-hover" data-choice={block.id} data-showing={showing || undefined}>
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <span className="truncate">{block.title}</span>
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

function PhaseIcon({ phase }: { phase: RequestPhase["phase"] }) {
  const cls = "size-4 shrink-0";
  switch (phase) {
    case "sending":
    case "starting":
      return <Spinner className={`${cls} text-accent`} aria-hidden data-progress />;
    case "working":
      return (
        <span aria-hidden className="relative grid size-4 shrink-0 place-items-center" data-progress>
          <span className="absolute size-2 animate-ping rounded-full bg-accent/60" />
          <span className="size-2 rounded-full bg-accent" />
        </span>
      );
    case "queued":
      return <Clock className={`${cls} text-fg-muted`} aria-hidden />;
    case "asking":
      return <CircleHelp className={`${cls} text-info`} aria-hidden />;
    case "no_change":
      return <Info className={`${cls} text-info`} aria-hidden />;
    case "fulfilled":
      return <Check className={`${cls} text-success`} aria-hidden />;
    case "withdrawn":
      // A state, not an action, so not the undo arrow a button would carry.
      return <CircleSlash className={`${cls} text-fg-muted`} aria-hidden />;
    case "send_failed":
    case "start_failed":
    case "run_failed":
      return <CircleAlert className={`${cls} text-danger`} aria-hidden />;
    case "previous_thread":
    case "thread_lost":
      return <AlertTriangle className={`${cls} text-warning`} aria-hidden />;
  }
}

const ACTION_LABEL: Record<RequestPhaseAction, string> = {
  retry: "Retry",
  resend: "Resend",
  withdraw: "Withdraw",
  open_thread: "Open thread",
  copy_phrase: "Copy phrase",
  discard: "Discard fork",
};

/** What each action does, for its hint once a narrow header leaves it its icon alone. */
const ACTION_HINT: Record<Exclude<RequestPhaseAction, "copy_phrase">, string> = {
  retry: "Send the request again",
  resend: "Send the request to the thread that took over",
  withdraw: "Withdraw the request",
  open_thread: "Open the attached thread in T3",
  discard: "Discard this fork",
};

const ACTION_ICON: Partial<Record<RequestPhaseAction, LucideIcon>> = {
  retry: RotateCw,
  resend: Send,
  withdraw: CircleSlash,
  open_thread: ExternalLink,
  discard: Trash2,
};

type Tone = "danger" | "warning" | "info";

/**
 * Phases that need more than the bar has room for: an error, the takeover phrase, the agent's reply, or what the next
 * step does. The bar names the phase and the strip under it says the rest, so nothing Rob has to read or copy is cut
 * off. The icon is the strip's tone icon, the same one the bar shows. `own` is an action the strip carries instead
 * of the bar, beside what it acts on.
 */
const DETAIL: Partial<Record<RequestPhase["phase"], { readonly label: string; readonly tone: Tone; readonly note?: string; readonly own?: RequestPhaseAction }>> = {
  send_failed: { label: "Send failed", tone: "danger" },
  start_failed: { label: "Start failed", tone: "danger" },
  run_failed: { label: "Run failed", tone: "danger", note: "The agent's run failed in T3. Open the thread to see why, or Retry." },
  thread_lost: { label: "Thread lost", tone: "warning", note: "This brainstorm's thread is gone. In a T3 thread on this project, say:", own: "copy_phrase" },
  previous_thread: { label: "Sent to the previous thread", tone: "warning", note: "Another thread took this brainstorm over. Resend sends the request to it." },
  no_change: { label: "No change", tone: "info", note: "The agent replied in T3 without changing the design." },
};

/** A phase's label takes its icon's tone, so a tone never means one thing in the icon and another in the words. */
const TONE_TEXT: Partial<Record<RequestPhase["phase"], string>> = {
  asking: "text-info",
  send_failed: "text-danger",
  start_failed: "text-danger",
  run_failed: "text-danger",
  thread_lost: "text-warning",
  previous_thread: "text-warning",
  no_change: "text-info",
  fulfilled: "text-success",
};

export function RequestStatus({ view }: { view: SessionView }) {
  const request = view.request;
  // A lost thread stays named once its request closes, since nothing can be sent until it is taken over.
  if (view.attachment.lostAt !== null && (request === null || request.phase.actions.length === 0)) {
    return (
      <div className="grid-phase grid items-center gap-2 text-sm" data-request-phase={request?.phase.phase} data-thread-lost>
        <PhaseIcon phase="thread_lost" />
        <span className={`truncate font-medium ${TONE_TEXT.thread_lost}`} data-request-label>
          {DETAIL.thread_lost?.label}
        </span>
      </div>
    );
  }
  if (request === null) return null;
  const { phase } = request;
  const detail = DETAIL[phase.phase];
  return (
    <div className="grid-phase grid items-center gap-2 text-sm" data-request-phase={phase.phase}>
      <PhaseIcon phase={phase.phase} />
      {detail === undefined ? (
        <span className={`truncate ${TONE_TEXT[phase.phase] ?? "text-fg-muted"}`} data-request-message>
          {request.message}
        </span>
      ) : (
        <span className={`truncate font-medium ${TONE_TEXT[phase.phase]}`} data-request-label>
          {detail.label}
        </span>
      )}
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
 * label changes length, so Withdraw sits at one x from queued to working.
 */
export function PhaseActions({ view, send, onDiscard }: { view: SessionView; send: (action: RobAction) => Promise<unknown>; onDiscard: () => void }) {
  return (
    <span className="flex shrink-0 items-center gap-2" data-phase-actions>
      {phaseActions(view).map((action) => (
        <PhaseAction key={action} action={action} view={view} send={send} onDiscard={onDiscard} />
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
      tone={detail.tone}
      layout="strip"
      role="status"
      actions={detail.own === "copy_phrase" ? <TakeoverPhrase title={view.session.title} /> : undefined}
      data-request-detail
    >
      <p className="select-text" data-request-message>
        {detail.note ?? view.request.message}
      </p>
    </Callout>
  );
}

function PhaseAction({
  action,
  view,
  send,
  onDiscard,
}: {
  action: RequestPhaseAction;
  view: SessionView;
  send: (action: RobAction) => Promise<unknown>;
  onDiscard: () => void;
}) {
  switch (action) {
    case "retry":
    case "resend":
      return <ActionButton action={action} onClick={() => void send({ kind: "retry_request" })} />;
    case "withdraw":
      return <ActionButton action={action} onClick={() => void send({ kind: "withdraw_request" })} />;
    case "open_thread":
      return <OpenThread view={view} />;
    case "copy_phrase":
      return <CopyPhrase title={view.session.title} />;
    case "discard":
      return <ActionButton action={action} onClick={onDiscard} />;
  }
}

function OpenThread({ view }: { view: SessionView }) {
  if (view.thread === null) return null;
  return (
    <Hint label={ACTION_HINT.open_thread} side="left">
      <Button variant="outline" className={COMPACT} nativeButton={false} render={<a href={view.thread.link} target="_blank" rel="noreferrer" />} data-request-action="open_thread">
        <ActionLabel action="open_thread" />
      </Button>
    </Hint>
  );
}

/**
 * The takeover phrase on its own line in mono, with Copy phrase beside it where there is room and under it where
 * there isn't. The quoted title keeps to one line, so the phrase never breaks inside it.
 */
export function TakeoverPhrase({ title }: { title: string }) {
  const phrase = takeoverPhrase(title);
  const at = phrase.indexOf('"');
  return (
    <>
      <p className={cn(chip, "rounded-sm px-1.5 py-1.5 font-mono text-xs text-balance text-fg select-all")} data-takeover-phrase>
        {phrase.slice(0, at)}
        <span className={title.length <= 24 ? "whitespace-nowrap" : undefined}>{phrase.slice(at)}</span>
      </p>
      <CopyPhrase title={title} />
    </>
  );
}

function CopyPhrase({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <Button variant="outline" onClick={() => void navigator.clipboard.writeText(takeoverPhrase(title)).then(() => setCopied(true))} data-request-action="copy_phrase">
      {/* Both labels share one cell, so the button keeps the wider one's width and nothing beside it moves. */}
      <span className="grid *:col-start-1 *:row-start-1" data-copied={copied || undefined}>
        <span className={copied ? "invisible" : undefined}>{ACTION_LABEL.copy_phrase}</span>
        <span className={copied ? "flex items-center justify-center gap-1" : "invisible flex items-center justify-center gap-1"} aria-live="polite">
          <Check aria-hidden className="size-3.5 text-success" />
          Copied
        </span>
      </span>
    </Button>
  );
}

/** Phase actions are full-height outline buttons, the same size as Regenerate and Export beside them. */
function ActionButton({ action, onClick }: { action: Exclude<RequestPhaseAction, "copy_phrase">; onClick: () => void }) {
  return (
    <Hint label={ACTION_HINT[action]} side="left">
      <Button variant="outline" className={COMPACT} onClick={onClick} data-request-action={action}>
        <ActionLabel action={action} />
      </Button>
    </Hint>
  );
}

/** An action's icon and name, the name given up for the icon alone in a narrow header, as Fork and Export do. */
function ActionLabel({ action }: { action: RequestPhaseAction }) {
  const Icon = ACTION_ICON[action];
  return (
    <>
      {Icon !== undefined && <Icon data-icon="inline-start" aria-hidden />}
      <span className={COMPACT_LABEL}>{ACTION_LABEL[action]}</span>
    </>
  );
}
