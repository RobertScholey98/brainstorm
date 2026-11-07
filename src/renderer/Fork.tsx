import { ExternalLink, GitBranch } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverFooter, PopoverHeader, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Hint } from "@/components/ui/tooltip";
import { carryOver } from "../core/fork";
import type { ContentHash, ForkInput, IterationView, SessionView, VariantKey } from "../core/types";
import { COLLAPSE, COMPACT, COMPACT_LABEL } from "./headerAction";
import { PinNumber } from "./PinNumber";

const SETTINGS_SHOWN = 3;

/**
 * Fork, beside Regenerate. It forks the iteration on the canvas, with the variants showing there: the latest one as
 * Rob left it, or a past one with the variants he picked while looking at it. The popover lists what carries over,
 * from the same `carryOver` the service writes with.
 */
export function ForkButton({
  view,
  iteration,
  past,
  blockErrors,
  fork,
}: {
  view: SessionView;
  /** The iteration on the canvas, with each slot's `active` the variant showing. */
  iteration: IterationView | null;
  past: boolean;
  blockErrors: ReadonlyMap<ContentHash, string>;
  /** Makes the fork and opens it; false keeps the popover open, since the failure already shows. */
  fork: (input: ForkInput) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const label = past && iteration !== null ? `Fork iteration ${iteration.n}` : "Fork";
  if (iteration === null) {
    return (
      <Hint label="Fork needs a first iteration" side="left">
        <span tabIndex={0} data-fork-blocked>
          <Button variant="outline" disabled className={COMPACT} data-collapse={COLLAPSE.fork} data-fork-toggle>
            <GitBranch data-icon="inline-start" aria-hidden />
            <span className={COMPACT_LABEL}>Fork</span>
          </Button>
        </span>
      </Hint>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint label={`Start a new brainstorm from iteration ${iteration.n}, in a new T3 thread`} side="left">
        <PopoverTrigger render={<Button variant="outline" className={COMPACT} data-collapse={COLLAPSE.fork} data-fork-toggle />}>
          <GitBranch data-icon="inline-start" aria-hidden />
          <span className={COMPACT_LABEL}>{label}</span>
        </PopoverTrigger>
      </Hint>
      <PopoverContent size="md" align="end" data-fork-menu>
        <PopoverHeader heading={`Fork iteration ${iteration.n}`} description={`${view.session.title} · a new brainstorm with one variant per slot`} />
        <ForkForm view={view} iteration={iteration} blockErrors={blockErrors} fork={fork} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

function ForkForm({
  view,
  iteration,
  blockErrors,
  fork,
  onClose,
}: {
  view: SessionView;
  iteration: IterationView;
  blockErrors: ReadonlyMap<ContentHash, string>;
  fork: (input: ForkInput) => Promise<boolean>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const picks = useMemo(() => Object.fromEntries(iteration.slots.map((s) => [s.id, s.active])) as Record<string, VariantKey>, [iteration]);
  const carried = useMemo(() => {
    // Rob's settings are kept per block, so a past iteration's blocks take the ones that still name their props.
    const all = [...view.overrides.applicable, ...view.overrides.inapplicable.map((i) => i.override)];
    const result = carryOver({ slots: iteration.slots, blocks: iteration.blocks, picks, applicable: all, feedback: view.feedback });
    return result.ok ? result.value : { slots: [], settings: [], pins: [] };
  }, [view, iteration, picks]);
  const broken = carried.slots.flatMap(({ blockId, title }) => {
    const hash = iteration.blocks.find((b) => b.id === blockId)?.hash;
    return hash !== undefined && blockErrors.has(hash) ? [title] : [];
  });
  const instruction = text.trim();

  const submit = async () => {
    if (instruction === "" || sending) return;
    setSending(true);
    const ok = await fork({ from: iteration.n, picks, instruction });
    setSending(false);
    if (ok) onClose();
  };
  useEffect(() => setText(""), [iteration.n]);

  const shown = carried.settings.slice(0, SETTINGS_SHOWN).map((s) => s.text).join(" · ");
  const more = carried.settings.length - SETTINGS_SHOWN;
  return (
    <>
      <label className="grid gap-1.5">
        <span className="text-xs font-medium">Instruction</span>
        <Textarea
          rows={3}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && void submit()}
          placeholder="What should the fork try?"
          className="resize-none"
          data-fork-instruction
        />
      </label>
      <div className="grid gap-1.5" data-fork-carries>
        <h3 className="text-xs font-medium">Carries over</h3>
        <dl className="grid-carry grid gap-x-3 gap-y-2 rounded-lg bg-muted p-3 text-sm/snug">
          {carried.slots.map(({ slot, title }) => (
            <div key={slot.id} className="contents" data-carry-slot={slot.id}>
              <dt className="truncate text-xs text-fg-muted">{slot.title}</dt>
              <dd className="grid min-w-0 gap-0.5">
                <span className="truncate">{title}</span>
                <span className="text-xs text-fg-muted">{slot.variants.length === 1 ? "its only variant" : "the variant showing"}</span>
              </dd>
            </div>
          ))}
          <dt className="text-xs text-fg-muted">Settings</dt>
          <dd className="grid min-w-0 gap-0.5" data-carry-settings={carried.settings.length}>
            {carried.settings.length === 0 ? (
              <span className="text-fg-muted">None changed, so the defaults carry over</span>
            ) : (
              <>
                <span>{shown}</span>
                <span className="text-xs text-fg-muted">{more > 0 ? `and ${more} more, baked in as defaults` : "baked in as defaults"}</span>
              </>
            )}
          </dd>
          <dt className="text-xs text-fg-muted">Open pins</dt>
          <dd className="grid min-w-0 gap-1" data-carry-pins={carried.pins.length}>
            {carried.pins.length === 0 ? (
              <span className="text-fg-muted">None on these variants</span>
            ) : (
              carried.pins.map((f) => (
                <span key={f.id} className="flex min-w-0 items-start gap-1.5">
                  <PinNumber n={f.id} state="open" />
                  <span className="min-w-0 truncate">{f.text}</span>
                </span>
              ))
            )}
          </dd>
        </dl>
      </div>
      {broken.length > 0 && (
        <Callout tone="warning" data-fork-broken>
          <p>
            {broken.join(" and ")} failed to render on the canvas. If your settings break it, the fork is refused; reset the setting or show
            another variant.
          </p>
        </Callout>
      )}
      <PopoverFooter
        hint={
          <span className="flex items-center gap-1.5" data-fork-hint>
            <ExternalLink aria-hidden className="size-3.5" />
            {instruction === "" ? "Say what the fork should try" : "Starts a new T3 thread"}
          </span>
        }
      >
        <Kbd disabled={instruction === "" || sending}>Ctrl+Enter</Kbd>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="accent" disabled={instruction === "" || sending} onClick={() => void submit()} data-fork-send>
          {sending && <Spinner data-icon="inline-start" />}
          {sending ? "Forking…" : "Send"}
        </Button>
      </PopoverFooter>
    </>
  );
}
