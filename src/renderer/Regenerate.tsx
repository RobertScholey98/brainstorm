import { AlertTriangle, Check, CircleHelp, Clock, MessageSquare, Undo2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { blockedMessage, requestFeedback, takeoverPhrase } from "../core/machines";
import type { BlockId, BlockView, RequestBody, RequestPhase, RequestPhaseAction, RequestScope, RobAction, SessionView } from "../core/types";

type ScopeKind = RequestBody["scope"]["kind"];

const SCOPES: readonly { kind: ScopeKind; label: string }[] = [
  { kind: "all", label: "Everything" },
  { kind: "blocks", label: "Selected blocks" },
  { kind: "described", label: "Describe it" },
];

function scopeOf(kind: ScopeKind, chosen: readonly BlockId[]): RequestScope | null {
  if (kind !== "blocks") return { kind };
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
  send,
}: {
  view: SessionView;
  selected: BlockId | null;
  send: (action: RobAction) => Promise<SessionView | null>;
}) {
  const [open, setOpen] = useState(false);
  const gate = view.regenerate;
  if (!gate.ok) {
    return (
      <Tooltip>
        <TooltipTrigger render={<span tabIndex={0} />}>
          <Button variant="accent" size="sm" disabled data-regenerate-toggle>
            Regenerate
          </Button>
        </TooltipTrigger>
        <TooltipContent>{blockedMessage(gate.reason, view.request?.request.n)}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="accent" size="sm" title="Send a request to the T3 thread" data-regenerate-toggle />}>Regenerate</PopoverTrigger>
      <PopoverContent align="end" className="w-popover-md gap-3 p-3" data-regenerate-menu>
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
      <ToggleGroup
        variant="outline"
        size="sm"
        spacing={0}
        className="w-full"
        value={[kind]}
        onValueChange={(v) => v[0] !== undefined && setKind(v[0] as ScopeKind)}
        aria-label="Scope"
      >
        {SCOPES.map((s) => (
          <ToggleGroupItem key={s.kind} value={s.kind} className="flex-1" data-scope={s.kind}>
            {s.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {kind === "blocks" && (
        <div className="grid max-h-picker gap-2 overflow-y-auto" data-block-choices>
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
      {kind === "described" && <p className="text-fg-muted">Say what to change. The agent works out which blocks that means.</p>}

      <Textarea
        rows={3}
        value={text}
        aria-label="Free text"
        data-freetext
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && void submit()}
        placeholder={kind === "described" ? "Describe what to change" : "Anything to add? (optional)"}
        className="resize-none"
      />

      <div className="grid gap-1" data-attached-feedback>
        <h3 className="text-xs font-medium text-fg-muted">
          {attached.length === 0 ? "No open feedback in scope" : `Open feedback sent with it (${attached.length})`}
        </h3>
        {attached.map((f) => (
          <p key={f.id} className="flex gap-1.5 text-sm/snug" data-attached={f.id}>
            <span className="shrink-0 font-semibold tabular-nums text-accent">#{f.id}</span>
            <span className="min-w-0 truncate" title={f.text}>
              {f.text}
            </span>
            <span className="ml-auto shrink-0 text-fg-muted">{f.pin.part ?? "whole block"}</span>
          </p>
        ))}
      </div>

      <Separator />
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-fg-muted">Goes to the attached T3 thread</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="accent" size="sm" disabled={body === null || sending} onClick={() => void submit()} data-send>
          {sending && <Spinner data-icon="inline-start" />}
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>
    </>
  );
}

function BlockChoice({ block, showing, checked, onToggle }: { block: BlockView; showing: boolean; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-1.5 hover:bg-hover" data-choice={block.id}>
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <span className="truncate">{block.title}</span>
      <span className="ml-auto shrink-0 text-xs text-fg-muted">{showing ? "showing" : block.variant}</span>
    </label>
  );
}

function PhaseIcon({ phase }: { phase: RequestPhase["phase"] }) {
  const cls = "size-4 shrink-0";
  switch (phase) {
    case "sending":
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
      return <MessageSquare className={`${cls} text-info`} aria-hidden />;
    case "fulfilled":
      return <Check className={`${cls} text-success`} aria-hidden />;
    case "withdrawn":
      return <Undo2 className={`${cls} text-fg-muted`} aria-hidden />;
    case "send_failed":
    case "run_failed":
    case "previous_thread":
    case "thread_lost":
      return <AlertTriangle className={`${cls} ${phase === "previous_thread" ? "text-warning" : "text-danger"}`} aria-hidden />;
  }
}

const ACTION_LABEL: Record<RequestPhaseAction, string> = {
  retry: "Retry",
  resend: "Resend",
  withdraw: "Withdraw",
  open_thread: "Open thread",
  copy_phrase: "Copy phrase",
};

export function RequestStatus({ view, send }: { view: SessionView; send: (action: RobAction) => Promise<unknown> }) {
  const request = view.request;
  if (request === null) return null;
  const { phase } = request;
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm" data-request-phase={phase.phase}>
      <PhaseIcon phase={phase.phase} />
      <span className="truncate text-fg-muted" title={request.message} data-request-message>
        {request.message}
      </span>
      {phase.actions.length > 0 && (
        <span className="flex shrink-0 items-center gap-1">
          {phase.actions.map((action) => (
            <PhaseAction key={action} action={action} view={view} send={send} />
          ))}
        </span>
      )}
    </div>
  );
}

function PhaseAction({ action, view, send }: { action: RequestPhaseAction; view: SessionView; send: (action: RobAction) => Promise<unknown> }) {
  const label = ACTION_LABEL[action];
  switch (action) {
    case "retry":
    case "resend":
      return <ActionButton action={action} onClick={() => void send({ kind: "retry_request" })}>{label}</ActionButton>;
    case "withdraw":
      return <ActionButton action={action} onClick={() => void send({ kind: "withdraw_request" })}>{label}</ActionButton>;
    case "open_thread":
      return view.thread === null ? null : (
        <Button
          variant="outline"
          size="xs"
          nativeButton={false}
          render={<a href={view.thread.link} target="_blank" rel="noreferrer" />}
          data-request-action={action}
        >
          {label}
        </Button>
      );
    case "copy_phrase":
      return <CopyPhrase title={view.session.title} />;
  }
}

export function CopyPhrase({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <ActionButton action="copy_phrase" onClick={() => void navigator.clipboard.writeText(takeoverPhrase(title)).then(() => setCopied(true))}>
      {copied ? "Copied" : ACTION_LABEL.copy_phrase}
    </ActionButton>
  );
}

function ActionButton({ action, onClick, children }: { action: RequestPhaseAction; onClick: () => void; children: ReactNode }) {
  return (
    <Button variant="outline" size="xs" className="w-fit" onClick={onClick} data-request-action={action}>
      {children}
    </Button>
  );
}
