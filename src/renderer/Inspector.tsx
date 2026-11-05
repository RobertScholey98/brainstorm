import { JSONUIProvider, Renderer } from "@json-render/react";
import type { Spec } from "@json-render/core";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { HEX_COLOR_PATTERN } from "../core/props";
import type { AppearanceValue, BlockView, InapplicableOverride, OverrideMismatch, PropName, Props, SessionView } from "../core/types";
import { ControlScopeContext, controlRegistry, createBlockStore } from "./controls";

const WHY: Record<OverrideMismatch, string> = {
  prop_removed: "the block no longer has this setting",
  type_changed: "the setting changed type",
  out_of_range: "the value is outside the new range",
  option_removed: "that option was removed",
  block_removed: "the block was removed",
};

const isHex = (value: AppearanceValue): value is string => typeof value === "string" && HEX_COLOR_PATTERN.test(value);

export function Inspector({
  view,
  block,
  props,
  error,
  onSet,
  onReset,
  onDismiss,
  children,
}: {
  view: SessionView;
  block: BlockView | null;
  props: Props | null;
  error: string | null;
  onSet: (block: BlockView, prop: PropName, value: AppearanceValue) => void;
  onReset: (block: BlockView, prop: PropName) => void;
  onDismiss: (o: InapplicableOverride) => void;
  children: ReactNode;
}) {
  const blocks = view.iteration?.blocks ?? [];
  return (
    <aside className="flex min-h-0 w-inspector shrink-0 flex-col overflow-y-auto border-l bg-card" aria-label="Inspector">
      {view.overrides.inapplicable.length > 0 && <Inapplicable items={view.overrides.inapplicable} blocks={blocks} onDismiss={onDismiss} />}
      {block === null || props === null ? (
        <p className="px-4 py-4 text-sm text-fg-muted">Select a frame to adjust it.</p>
      ) : (
        <BlockControls key={block.id} view={view} block={block} props={props} error={error} onSet={onSet} onReset={onReset} />
      )}
      {children}
    </aside>
  );
}

function BlockControls({
  view,
  block,
  props,
  error,
  onSet,
  onReset,
}: {
  view: SessionView;
  block: BlockView;
  props: Props;
  error: string | null;
  onSet: (block: BlockView, prop: PropName, value: AppearanceValue) => void;
  onReset: (block: BlockView, prop: PropName) => void;
}) {
  const appearance = useMemo(
    () => Object.fromEntries(block.props.appearance.map((p) => [p.name, props[p.name]])) as Record<string, unknown>,
    [block, props],
  );
  const handlers = useRef({ onSet, block });
  handlers.current = { onSet, block };
  const store = useMemo(() => createBlockStore(appearance, (prop, value) => handlers.current.onSet(handlers.current.block, prop, value)), [block.id]);
  useEffect(() => store.sync(appearance), [store, appearance]);

  const scope = useMemo(
    () => ({
      block,
      overridden: new Set<string>(view.overrides.applicable.filter((o) => o.blockId === block.id).map((o) => o.prop)),
      reset: (prop: PropName) => onReset(block, prop),
    }),
    [block, view.overrides.applicable, onReset],
  );
  const slot = view.iteration?.slots.find((s) => s.id === block.slot);

  return (
    <div data-block={block.id}>
      <header className="border-b px-4 pt-3 pb-3">
        <div className="text-xs font-medium text-fg-muted">{slot?.title ?? block.slot}</div>
        <h2 className="truncate pt-0.5 text-sm font-semibold">{block.title}</h2>
        {error !== null && (
          <div className="pt-2">
            <Callout tone="danger" role="alert" heading="This block failed to render">
              <p>The error shows in its frame on the canvas.</p>
            </Callout>
          </div>
        )}
      </header>
      {block.props.appearance.length === 0 ? (
        <p className="px-4 py-4 text-sm text-fg-muted">This block has no adjustable settings.</p>
      ) : (
        <ControlScopeContext.Provider value={scope}>
          <JSONUIProvider registry={controlRegistry} store={store}>
            <Renderer spec={block.controls as unknown as Spec} registry={controlRegistry} />
          </JSONUIProvider>
        </ControlScopeContext.Provider>
      )}
    </div>
  );
}

function Inapplicable({
  items,
  blocks,
  onDismiss,
}: {
  items: readonly InapplicableOverride[];
  blocks: readonly BlockView[];
  onDismiss: (o: InapplicableOverride) => void;
}) {
  return (
    <section aria-label="Adjustments that no longer apply" className="px-3 pt-3" data-banner="inapplicable">
      <Callout tone="warning" role="status" heading={items.length === 1 ? "An adjustment no longer applies" : `${items.length} adjustments no longer apply`}>
      <ul className="grid gap-1">
        {items.map((item) => {
          const { override: o, reason } = item;
          const title = blocks.find((b) => b.id === o.blockId)?.title ?? o.blockId;
          return (
            <li key={`${o.blockId}/${o.prop}`} className="flex items-start gap-2" data-override={`${o.blockId}:${o.prop}`}>
              {isHex(o.value) && (
                <span aria-hidden className="mt-0.5 size-3 shrink-0 rounded-sm inset-ring inset-ring-fg/15" style={{ background: o.value }} />
              )}
              <span className="min-w-0">
                <span className="font-medium">
                  {o.prop} = {isHex(o.value) ? o.value.toUpperCase() : String(o.value)}
                </span>{" "}
                on {title}: {WHY[reason]}.
              </span>
              <Button variant="ghost" size="xs" className="-my-0.5 ml-auto" onClick={() => onDismiss(item)}>
                Dismiss
              </Button>
            </li>
          );
        })}
      </ul>
      </Callout>
    </section>
  );
}
