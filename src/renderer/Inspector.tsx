import { JSONUIProvider, Renderer } from "@json-render/react";
import type { Spec } from "@json-render/core";
import { MessageSquare } from "lucide-react";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Count } from "@/components/ui/count";
import { Callout, CalloutItem } from "@/components/ui/callout";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { ScrollPane } from "@/components/ui/scroll-pane";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/ui/tooltip";
import { Truncate } from "@/components/ui/truncate";
import { HEX_COLOR_PATTERN } from "../core/props";
import type { AppearanceValue, BlockView, InapplicableOverride, IterationN, Override, OverrideMismatch, PropName, Props, SessionView } from "../core/types";
import { ControlScopeContext, controlRegistry, createBlockStore } from "./controls";
import type { PaneLimits } from "./hooks/use-pane-width";

const WHY: Record<OverrideMismatch, string> = {
  prop_removed: "the block no longer has this setting",
  type_changed: "the setting changed type",
  out_of_range: "the value is outside the new range",
  option_removed: "that option was removed",
  block_removed: "the block was removed",
};

const isHex = (value: AppearanceValue): value is string => typeof value === "string" && HEX_COLOR_PATTERN.test(value);

/** The setting's label while the block still declares it; once it is gone, its prop name read as words, "Spin seconds". */
function settingLabel(o: Override, blocks: readonly BlockView[]): string {
  const declared = blocks.find((b) => b.id === o.blockId)?.props.appearance.find((p) => p.name === o.prop)?.label;
  if (declared !== undefined) return declared;
  const words = o.prop.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The Inspector's column: its width, the drag handle on its left edge, a header that stays put, and its scrolling body.
 * The header sits outside the scroller on the card's surface, so content scrolls out of sight at its rule.
 */
function Column({ width, handle, header, children }: { width: number; handle?: ReactNode; header?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative flex min-h-0 shrink-0" style={{ width }}>
      {handle}
      <aside className="flex min-h-0 w-full flex-col border-l bg-card" aria-label="Inspector">
        {header}
        <ScrollPane data-inspector-body>{children}</ScrollPane>
      </aside>
    </div>
  );
}

/** One 40 px line, the canvas bar's height, so the two bars rule off at one height across the seam. */
function Header({ children }: { children: ReactNode }) {
  return <header className="flex h-10 shrink-0 items-center gap-2 border-b bg-card px-4" data-inspector-header>{children}</header>;
}

/**
 * The Inspector collapsed to a rail. The header's toggle already brings it back, so the rail holds only what is
 * waiting behind it: the open feedback, the comments the agent hasn't answered.
 */
export function InspectorRail({ open, onExpand }: { open: number; onExpand: () => void }) {
  return (
    <aside className="flex w-10 shrink-0 flex-col border-l bg-card" aria-label="Inspector" data-inspector-rail>
      {/* The canvas bar's height and rule, so the bar's line runs on to the card's edge. */}
      <div className="flex h-10 shrink-0 items-center justify-center border-b" data-rail-head>
        <Hint label={open === 0 ? "No open feedback" : open === 1 ? "1 open comment" : `${open} open comments`} side="left">
          {/* The count stands under its glyph: the 40 px rail has no room to set a corner count clear of it. */}
          <Button variant="ghost" size={open > 0 ? "icon-count" : "icon"} aria-label="Show the feedback" onClick={onExpand} data-rail-feedback>
            <MessageSquare aria-hidden />
            {open > 0 && (
              <Count className="leading-none" data-rail-count>
                {open}
              </Count>
            )}
          </Button>
        </Hint>
      </div>
    </aside>
  );
}

/** The Inspector while the brainstorm opens, shaped like a block's header and a few controls. */
export function InspectorSkeleton({ width }: { width: number }) {
  return (
    <Column
      width={width}
      header={
        <Header>
          <Skeleton className="h-4 w-1/2" data-inspector-loading />
          <Skeleton className="ml-auto h-3 w-12" />
        </Header>
      }
    >
      <div className="grid gap-5 py-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="grid gap-2">
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-7 w-full" />
          </div>
        ))}
      </div>
    </Column>
  );
}

export function Inspector({
  width,
  limits,
  onWidth,
  view,
  blocks,
  readOnly,
  block,
  props,
  error,
  onSet,
  onReset,
  onDismiss,
  children,
}: {
  width: number;
  limits: PaneLimits;
  onWidth: (width: number) => void;
  view: SessionView;
  /** The blocks on the canvas: the latest iteration's, or the past one's Rob is looking at. */
  blocks: readonly BlockView[];
  /** The past iteration on the canvas, whose settings show but can't change. */
  readOnly: IterationN | null;
  block: BlockView | null;
  props: Props | null;
  error: string | null;
  onSet: (block: BlockView, prop: PropName, value: AppearanceValue) => void;
  onReset: (block: BlockView, prop: PropName) => void;
  onDismiss: (o: InapplicableOverride) => void;
  children: ReactNode;
}) {
  // It covers the whole session, removed blocks included, so it shows whatever is selected, under the block's header.
  const banner = view.overrides.inapplicable.length > 0 && <Inapplicable items={view.overrides.inapplicable} blocks={blocks} shown={block} onDismiss={onDismiss} />;
  const slot = block === null ? undefined : view.iteration?.slots.find((s) => s.id === block.slot);
  const past = readOnly !== null && (
    <div className="pt-3" data-inspector-past={readOnly}>
      <Callout tone="info">
        <p>Iteration {readOnly} is read-only. Its settings travel with a fork.</p>
      </Callout>
    </div>
  );
  return (
    <Column
      width={width}
      handle={<ResizeHandle edge="left" value={width} min={limits.min} max={limits.max} reset={limits.fallback} onValueChange={onWidth} aria-label="Inspector width" />}
      header={
        block !== null && props !== null ? (
          <Header>
            <h2 className="flex min-w-0 text-base font-semibold">
              <Truncate>{block.title}</Truncate>
            </h2>
            <span className="ml-auto shrink-0 text-xs text-fg-muted">{slot?.title ?? block.slot}</span>
          </Header>
        ) : (
          // With no block to name, the header row still holds, so the column keeps its top rule and its text's place.
          <Header>
            <h2 className="min-w-0 text-base font-semibold text-fg-muted">
              <Truncate>Settings</Truncate>
            </h2>
          </Header>
        )
      }
    >
      {block === null || props === null ? (
        <>
          {past}
          {banner}
          <p className="py-4 text-sm/relaxed text-fg-muted" data-inspector-empty>
            {view.iteration === null ? "Each block's settings show here once the agent commits the first iteration." : "Select a frame to adjust it."}
          </p>
        </>
      ) : (
        <>
          {past}
          <BlockControls key={block.id} view={view} block={block} props={props} error={error} banner={banner} readOnly={readOnly !== null} onSet={onSet} onReset={onReset} />
        </>
      )}
      {children}
    </Column>
  );
}

function BlockControls({
  view,
  block,
  props,
  error,
  banner,
  readOnly,
  onSet,
  onReset,
}: {
  view: SessionView;
  block: BlockView;
  props: Props;
  error: string | null;
  banner: ReactNode;
  readOnly: boolean;
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
      reset: readOnly ? null : (prop: PropName) => onReset(block, prop),
    }),
    [block, view.overrides.applicable, onReset, readOnly],
  );
  return (
    <div data-block={block.id}>
      {error !== null && (
        <div className="pt-3">
          <Callout tone="danger" role="alert" heading="Render failed">
            <p>Its frame on the canvas shows why.</p>
          </Callout>
        </div>
      )}
      {banner}
      {block.props.appearance.length === 0 ? (
        <p className="py-4 text-sm text-fg-muted">This block has no adjustable settings.</p>
      ) : (
        // A past iteration's controls show its values but take no input, so history stays as it was.
        <div inert={readOnly} className={readOnly ? "opacity-60" : undefined} data-controls-readonly={readOnly || undefined}>
          <ControlScopeContext.Provider value={scope}>
            <JSONUIProvider registry={controlRegistry} store={store}>
              <Renderer spec={block.controls as unknown as Spec} registry={controlRegistry} />
            </JSONUIProvider>
          </ControlScopeContext.Provider>
        </div>
      )}
    </div>
  );
}

/** `shown` is the block the Inspector's header names, whose own settings need no "On <block>" to say where they were. */
function Inapplicable({
  items,
  blocks,
  shown,
  onDismiss,
}: {
  items: readonly InapplicableOverride[];
  blocks: readonly BlockView[];
  shown: BlockView | null;
  onDismiss: (o: InapplicableOverride) => void;
}) {
  return (
    <section aria-label="Settings that no longer apply" className="pt-3" data-banner="inapplicable">
      <Callout tone="warning" role="status" heading={items.length === 1 ? "A setting no longer applies" : `${items.length} settings no longer apply`}>
        <ul className="grid gap-2">
          {items.map((item) => {
            const { override: o, reason } = item;
            const title = blocks.find((b) => b.id === o.blockId)?.title ?? o.blockId;
            return (
              <CalloutItem
                key={`${o.blockId}/${o.prop}`}
                data-override={`${o.blockId}:${o.prop}`}
                actions={
                  <Button variant="outline" onClick={() => onDismiss(item)}>
                    Dismiss
                  </Button>
                }
              >
                <span className="flex items-center gap-1.5 text-fg">
                  {isHex(o.value) && <span aria-hidden className="size-3 shrink-0 rounded-sm inset-ring inset-ring-fg/15" style={{ background: o.value }} />}
                  {settingLabel(o, blocks)}: {isHex(o.value) ? o.value.toUpperCase() : String(o.value)}
                </span>
                {o.blockId === shown?.id ? `${WHY[reason][0]!.toUpperCase()}${WHY[reason].slice(1)}.` : `On ${title}: ${WHY[reason]}.`}
              </CalloutItem>
            );
          })}
        </ul>
      </Callout>
    </section>
  );
}
