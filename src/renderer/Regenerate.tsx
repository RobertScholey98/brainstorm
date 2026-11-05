import { AlertTriangle, Check, CircleHelp, Clock, Loader2, MessageSquare, Undo2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { requestFeedback, takeoverPhrase } from "../core/machines";
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

export function RegenerateMenu({
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
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !(e.target as Element).closest?.("[data-regenerate-toggle]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);

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
    <div
      ref={panel}
      role="dialog"
      aria-label="Regenerate"
      data-regenerate-menu
      className="absolute top-[calc(100%+6px)] right-0 z-30 grid w-[360px] gap-3 rounded-lg border border-border bg-background p-3 text-[12px] shadow-[0_16px_40px_-16px_rgb(0_0_0/0.4)]"
    >
      <div role="radiogroup" aria-label="Scope" className="flex rounded-md bg-muted p-0.5">
        {SCOPES.map((s) => (
          <button
            key={s.kind}
            type="button"
            role="radio"
            aria-checked={kind === s.kind}
            data-scope={s.kind}
            onClick={() => setKind(s.kind)}
            className="h-7 flex-1 rounded-[5px] font-medium text-muted-foreground aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-[0_0_0_1px_var(--border),0_1px_2px_rgb(0_0_0/0.08)]"
          >
            {s.label}
          </button>
        ))}
      </div>

      {kind === "blocks" && (
        <div className="grid max-h-[220px] gap-2 overflow-y-auto" data-block-choices>
          {slots.map((slot) => (
            <fieldset key={slot.id} className="grid gap-0.5">
              <legend className="pb-0.5 text-[11px] font-medium text-muted-foreground">{slot.title}</legend>
              {blocks
                .filter((b) => b.slot === slot.id)
                .map((b) => (
                  <BlockChoice key={b.id} block={b} showing={b.variant === slot.active} checked={chosen.has(b.id)} onToggle={() => toggle(b.id)} />
                ))}
            </fieldset>
          ))}
        </div>
      )}
      {kind === "all" && <p className="leading-relaxed text-muted-foreground">The agent may change any block, in every slot.</p>}
      {kind === "described" && <p className="leading-relaxed text-muted-foreground">Say what to change. The agent works out which blocks that means.</p>}

      <textarea
        rows={3}
        value={text}
        aria-label="Free text"
        data-freetext
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && void submit()}
        placeholder={kind === "described" ? "Describe what to change" : "Anything to add? (optional)"}
        className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-[12.5px] leading-snug outline-none placeholder:text-muted-foreground focus:border-primary"
      />

      <div className="grid gap-1" data-attached-feedback>
        <h3 className="text-[11px] font-medium text-muted-foreground">
          {attached.length === 0 ? "No open feedback in scope" : `Open feedback sent with it (${attached.length})`}
        </h3>
        {attached.map((f) => (
          <p key={f.id} className="flex gap-1.5 leading-snug" data-attached={f.id}>
            <span className="shrink-0 font-semibold tabular-nums text-primary">#{f.id}</span>
            <span className="min-w-0 truncate" title={f.text}>
              {f.text}
            </span>
            <span className="ml-auto shrink-0 text-muted-foreground">{f.pin.part ?? "whole block"}</span>
          </p>
        ))}
      </div>

      <div className="flex items-center gap-1.5 border-t border-border pt-3">
        <span className="text-[11px] text-muted-foreground">Goes to the attached T3 thread</span>
        <button type="button" onClick={onClose} className="ml-auto h-7 rounded-md px-2.5 font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
          Cancel
        </button>
        <button
          type="button"
          disabled={body === null || sending}
          onClick={() => void submit()}
          data-send
          className="flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 font-medium text-primary-foreground disabled:opacity-45"
        >
          {sending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}

function BlockChoice({ block, showing, checked, onToggle }: { block: BlockView; showing: boolean; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1.5 hover:bg-accent" data-choice={block.id}>
      <input type="checkbox" checked={checked} onChange={onToggle} className="size-3.5 accent-[var(--primary)]" />
      <span className="truncate text-[12.5px]">{block.title}</span>
      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{showing ? "showing" : block.variant}</span>
    </label>
  );
}

function PhaseIcon({ phase }: { phase: RequestPhase["phase"] }) {
  const cls = "size-3.5 shrink-0";
  switch (phase) {
    case "sending":
      return <Loader2 className={`${cls} animate-spin text-primary`} aria-hidden data-progress />;
    case "working":
      return (
        <span aria-hidden className="relative grid size-3.5 shrink-0 place-items-center" data-progress>
          <span className="absolute size-2 animate-ping rounded-full bg-primary/60" />
          <span className="size-2 rounded-full bg-primary" />
        </span>
      );
    case "queued":
      return <Clock className={`${cls} text-muted-foreground`} aria-hidden />;
    case "asking":
      return <CircleHelp className={`${cls} text-warning`} aria-hidden />;
    case "no_change":
      return <MessageSquare className={`${cls} text-warning`} aria-hidden />;
    case "fulfilled":
      return <Check className={`${cls} text-confirmed`} aria-hidden />;
    case "withdrawn":
      return <Undo2 className={`${cls} text-muted-foreground`} aria-hidden />;
    case "send_failed":
    case "run_failed":
    case "previous_thread":
    case "thread_lost":
      return <AlertTriangle className={`${cls} ${phase === "previous_thread" ? "text-warning" : "text-destructive"}`} aria-hidden />;
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
    <div className="flex min-w-0 items-center gap-2" data-request-phase={phase.phase}>
      <PhaseIcon phase={phase.phase} />
      <span className="truncate" title={request.message} data-request-message>
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
      return <BarButton action={action} onClick={() => void send({ kind: "retry_request" })}>{label}</BarButton>;
    case "withdraw":
      return <BarButton action={action} onClick={() => void send({ kind: "withdraw_request" })}>{label}</BarButton>;
    case "open_thread":
      return view.thread === null ? null : (
        <a
          href={view.thread.link}
          target="_blank"
          rel="noreferrer"
          data-request-action={action}
          className="flex h-6 items-center rounded-[5px] px-2 text-[12px] font-medium text-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:bg-accent"
        >
          {label}
        </a>
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
    <BarButton
      action="copy_phrase"
      onClick={() => void navigator.clipboard.writeText(takeoverPhrase(title)).then(() => setCopied(true))}
    >
      {copied ? "Copied" : ACTION_LABEL.copy_phrase}
    </BarButton>
  );
}

function BarButton({ action, onClick, children }: { action: RequestPhaseAction; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-request-action={action}
      className="h-6 rounded-[5px] px-2 text-[12px] font-medium text-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:bg-accent"
    >
      {children}
    </button>
  );
}
