import type { StateStore } from "@json-render/core";
import { defineRegistry, useBoundProp, type BaseComponentProps } from "@json-render/react";
import { RotateCcw } from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select as SelectRoot, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider as SliderBar } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Segmented as SegmentedControl } from "@/components/ui/segmented";
import { Hint } from "@/components/ui/tooltip";
import { controlCatalog } from "../core/controls";
import { HEX_COLOR_PATTERN } from "../core/props";
import type { AppearanceProp, AppearanceType, AppearanceValue, BlockView, PropName } from "../core/types";

type ControlScope = {
  readonly block: BlockView;
  readonly overridden: ReadonlySet<string>;
  readonly reset: (prop: PropName) => void;
};

export const ControlScopeContext = createContext<ControlScope | null>(null);

type ControlProps = BaseComponentProps<{ label: string | null; value: unknown }>;

type Spec<T extends AppearanceType> = Extract<AppearanceProp, { type: T }>;

type Bound<T extends AppearanceType> = {
  readonly scope: ControlScope;
  readonly spec: Spec<T>;
  readonly value: Spec<T>["default"];
  readonly setValue: (value: Spec<T>["default"]) => void;
  readonly label: string;
};

/** Range, step, unit and options always come from the spec, never from the control, so a control can't disagree with its prop. */
function useBound<T extends AppearanceType>({ props, bindings }: ControlProps, type: T): Bound<T> | null {
  const scope = useContext(ControlScopeContext);
  const [value, setValue] = useBoundProp<AppearanceValue>(props.value as AppearanceValue | undefined, bindings?.value);
  const name = bindings?.value?.slice(1);
  const spec = scope?.block.props.appearance.find((p) => p.name === name);
  if (scope === null || spec?.type !== type) return null;
  const typed = spec as Spec<T>;
  return {
    scope,
    spec: typed,
    value: (typeof value === typeof typed.default ? value : typed.default) as Spec<T>["default"],
    setValue: setValue as Bound<T>["setValue"],
    label: props.label ?? typed.label,
  };
}

function Row({ bound, trailing, children }: { bound: Pick<Bound<AppearanceType>, "scope" | "spec" | "label">; trailing?: ReactNode; children?: ReactNode }) {
  const { scope, spec, label } = bound;
  const overridden = scope.overridden.has(spec.name);
  return (
    <div className="grid gap-1.5" data-control={spec.name} data-overridden={overridden || undefined}>
      <div className="flex h-6 items-center gap-1.5">
        {overridden && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-fg" data-overridden-mark />}
        <span className="truncate text-sm font-medium">{label}</span>
        {overridden && (
          <Hint label="Reset to the agent's value">
            <Button variant="ghost" size="icon-xs" aria-label={`Reset ${label}`} onClick={() => scope.reset(spec.name)}>
              <RotateCcw aria-hidden />
            </Button>
          </Hint>
        )}
        <span className="ml-auto flex items-center">{trailing}</span>
      </div>
      {children}
    </div>
  );
}

const formatNumber = (value: number, step: number | null) => {
  const decimals = step === null ? 2 : Math.max(0, (String(step).split(".")[1] ?? "").length);
  return value.toFixed(decimals);
};

function Slider(control: ControlProps) {
  const bound = useBound(control, "number");
  if (bound === null) return null;
  const { spec, value, setValue, label } = bound;
  return (
    <Row
      bound={bound}
      trailing={
        <span className="text-xs tabular-nums text-fg-muted" data-value>
          {formatNumber(value, spec.step)}
          {spec.unit}
        </span>
      }
    >
      <SliderBar
        className="py-1.5"
        min={spec.min}
        max={spec.max}
        step={spec.step ?? (spec.max - spec.min) / 100}
        value={[value]}
        onValueChange={(v) => setValue((v as number[])[0] ?? value)}
        aria-label={label}
      />
    </Row>
  );
}

function Select(control: ControlProps) {
  const bound = useBound(control, "enum");
  if (bound === null) return null;
  const { spec, value, setValue, label } = bound;
  const items = spec.options.map((o) => ({ label: o, value: o }));
  return (
    <Row bound={bound}>
      <SelectRoot items={items} value={value} onValueChange={(v) => v !== null && setValue(v)}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </SelectRoot>
    </Row>
  );
}

function Segmented(control: ControlProps) {
  const bound = useBound(control, "enum");
  if (bound === null) return null;
  const { spec, value, setValue, label } = bound;
  return (
    <Row bound={bound}>
      <SegmentedControl value={value} onValueChange={setValue} options={spec.options.map((o) => ({ value: o, label: o }))} aria-label={label} />
    </Row>
  );
}

function Toggle(control: ControlProps) {
  const bound = useBound(control, "boolean");
  if (bound === null) return null;
  const { value, setValue, label } = bound;
  return <Row bound={bound} trailing={<Switch checked={value} onCheckedChange={(checked) => setValue(checked)} aria-label={label} />} />;
}

function Text(control: ControlProps) {
  const bound = useBound(control, "text");
  if (bound === null) return null;
  const { spec, value, setValue, label } = bound;
  return (
    <Row bound={bound}>
      {spec.multiline ? (
        <Textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} aria-label={label} />
      ) : (
        <Input type="text" value={value} onChange={(e) => setValue(e.target.value)} aria-label={label} />
      )}
    </Row>
  );
}

function Colour(control: ControlProps) {
  const bound = useBound(control, "color");
  return bound === null ? null : <ColourField bound={bound} />;
}

/** A native colour well for dragging, plus a hex field that commits only a complete #rrggbb. */
function ColourField({ bound }: { bound: Bound<"color"> }) {
  const { value, setValue, label } = bound;
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (raw: string) => {
    const hex = (raw.startsWith("#") ? raw : `#${raw}`).toLowerCase();
    if (HEX_COLOR_PATTERN.test(hex)) setValue(hex);
  };
  return (
    <Row bound={bound}>
      <div className="flex h-7 items-center gap-2 rounded-md border border-border-strong pr-2 pl-1 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/50 dark:bg-border-strong/30">
        <input
          type="color"
          aria-label={`${label} colour`}
          className="size-5 cursor-pointer rounded-md border-0 bg-transparent p-0 [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border [&::-webkit-color-swatch]:border-fg/15 [&::-webkit-color-swatch-wrapper]:p-0"
          value={value}
          onChange={(e) => setValue(e.target.value.toLowerCase())}
        />
        <input
          type="text"
          aria-label={`${label} hex`}
          spellCheck={false}
          maxLength={7}
          className="min-w-0 flex-1 bg-transparent text-sm tabular-nums uppercase outline-none"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            commit(e.target.value);
          }}
          onBlur={() => setDraft(value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </div>
    </Row>
  );
}

function Section({ props, children }: BaseComponentProps<{ title: string | null }>) {
  const scope = useContext(ControlScopeContext);
  // A derived spec titles its one section with the block title, which the panel header already shows.
  const title = props.title === scope?.block.title ? null : props.title;
  return (
    <section className="grid gap-4 border-b px-4 pt-4 pb-5 last:border-b-0">
      {title !== null && <h3 className="text-xs font-semibold text-fg-muted">{title}</h3>}
      {children}
    </section>
  );
}

export const { registry: controlRegistry } = defineRegistry(controlCatalog, {
  components: { Section, Slider, Select, Segmented, Colour, Toggle, Text },
});

export type BlockStore = StateStore & { sync(values: Readonly<Record<string, unknown>>): void };

const shallowEqual = (a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.is(a[k], b[k]));
};

/**
 * The json-render state for one block: its effective appearance props keyed "/<prop>". `set` reports every write
 * so the caller can repaint the frame and save the override; `sync` takes in values that changed elsewhere.
 */
export function createBlockStore(initial: Readonly<Record<string, unknown>>, onSet: (prop: PropName, value: AppearanceValue) => void): BlockStore {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) l();
  };
  const write = (path: string, value: unknown) => {
    const prop = path.replace(/^\//, "");
    if (Object.is(snapshot[prop], value)) return false;
    snapshot = { ...snapshot, [prop]: value };
    onSet(prop as PropName, value as AppearanceValue);
    return true;
  };
  return {
    get: (path) => snapshot[path.replace(/^\//, "")],
    set: (path, value) => {
      if (write(path, value)) notify();
    },
    update: (updates) => {
      if (Object.entries(updates).map(([p, v]) => write(p, v)).some(Boolean)) notify();
    },
    getSnapshot: () => snapshot,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    sync: (values) => {
      if (shallowEqual(values, snapshot)) return;
      snapshot = values;
      notify();
    },
  };
}
