import { blockIdOf, type BlockView, type SessionId, type SessionListing, type SlotId, type SlotView, type VariantKey } from "../core/types";
import { Markdown } from "./Markdown";
import { markdownText } from "./markdownSubset";

export function Sidebar({
  sessions,
  current,
  onSession,
  slots,
  blocks,
  selectedSlot,
  onSlot,
  onVariant,
}: {
  sessions: readonly SessionListing[];
  current: SessionId | null;
  onSession: (id: SessionId) => void;
  slots: readonly SlotView[];
  blocks: readonly BlockView[];
  selectedSlot: SlotId | null;
  onSlot: (slot: SlotId) => void;
  onVariant: (slot: SlotId, variant: VariantKey) => void;
}) {
  return (
    <nav className="flex min-h-0 flex-col overflow-y-auto border-r border-border bg-panel" aria-label="Sessions and slots">
      <section className="border-b border-border px-2 pt-3 pb-2">
        <h2 className="px-2 pb-1.5 text-[11px] font-medium text-muted-foreground">Sessions</h2>
        {sessions.length === 0 ? (
          <p className="px-2 pb-2 text-[12px] leading-relaxed text-muted-foreground">
            No sessions yet. Run /ux-brainstorm in a T3 thread to start one.
          </p>
        ) : (
          <ul className="grid gap-px">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  aria-current={s.id === current || undefined}
                  onClick={() => onSession(s.id)}
                  className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent aria-[current]:bg-accent aria-[current]:font-medium"
                >
                  <span className="truncate">{s.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {slots.map((slot) => (
        <SlotSection
          key={slot.id}
          slot={slot}
          blocks={blocks}
          selected={slot.id === selectedSlot}
          onSlot={() => onSlot(slot.id)}
          onVariant={(v) => onVariant(slot.id, v)}
        />
      ))}
    </nav>
  );
}

function SlotSection({
  slot,
  blocks,
  selected,
  onSlot,
  onVariant,
}: {
  slot: SlotView;
  blocks: readonly BlockView[];
  selected: boolean;
  onSlot: () => void;
  onVariant: (variant: VariantKey) => void;
}) {
  return (
    <section className="border-b border-border px-2 pt-3 pb-2" data-slot={slot.id}>
      <button
        type="button"
        onClick={onSlot}
        className="flex w-full items-baseline gap-2 px-2 pb-1.5 text-left text-[11px] font-medium text-muted-foreground data-[selected]:text-primary"
        data-selected={selected || undefined}
      >
        <span className="truncate">{slot.title}</span>
        <span className="ml-auto shrink-0 tabular-nums">{slot.variants.length} variants</span>
      </button>
      <div role="radiogroup" aria-label={`${slot.title} variant`} className="grid gap-px">
        {slot.variants.map((variant) => {
          const block = blocks.find((b) => b.id === blockIdOf(slot.id, variant));
          const active = variant === slot.active;
          return (
            <div key={variant} className="rounded-md data-[active]:bg-background data-[active]:shadow-[0_0_0_1px_var(--border)]" data-active={active || undefined}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                data-variant={variant}
                onClick={() => onVariant(variant)}
                title={active || !block?.about ? undefined : markdownText(block.about)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent aria-checked:hover:bg-transparent"
              >
                <span
                  aria-hidden
                  className="grid size-3.5 shrink-0 place-items-center rounded-full border border-input aria-checked:border-primary"
                  aria-checked={active}
                >
                  {active && <span className="size-1.5 rounded-full bg-primary" />}
                </span>
                <span className="truncate data-[active]:font-medium" data-active={active || undefined}>
                  {block?.title ?? variant}
                </span>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{variant}</span>
              </button>
              {active && block?.about && (
                <div className="grid gap-1.5 pt-0.5 pr-2 pb-2.5 pl-7.5 text-[12px] leading-[1.45] text-muted-foreground" data-about>
                  <Markdown source={block.about} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
