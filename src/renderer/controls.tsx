import type { StateStore } from "@json-render/core";
import { defineRegistry, useBoundProp, type BaseComponentProps } from "@json-render/react";
import { shadcnComponents as ui } from "@json-render/shadcn";
import { RotateCcw } from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { controlCatalog } from "../core/controls";
import { HEX_COLOR_PATTERN } from "../core/props";
import type { AppearanceProp, AppearanceValue, BlockView, PropName } from "../core/types";

type ControlScope = {
  readonly block: BlockView;
  readonly overridden: ReadonlySet<string>;
  readonly reset: (prop: PropName) => void;
};

export const ControlScopeContext = createContext<ControlScope | null>(null);

type ControlProps = BaseComponentProps<{ label: string | null; value: unknown }>;

/** The appearance prop a control binds. Range, step, unit and options always come from here, never from the control. */
function useBound<T extends AppearanceProp["type"]>(
  bindings: ControlProps["bindings"],
  type: T,
): { scope: ControlScope; spec: Extract<AppearanceProp, { type: T }> } | null {
  const scope = useContext(ControlScopeContext);
  const name = bindings?.value?.slice(1);
  const spec = scope?.block.props.appearance.find((p) => p.name === name);
  return scope === null || spec?.type !== type ? null : { scope, spec: spec as Extract<AppearanceProp, { type: T }> };
}

function Row({
  spec,
  label,
  scope,
  trailing,
  children,
}: {
  spec: AppearanceProp;
  label: string | null;
  scope: ControlScope;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  const text = label ?? spec.label;
  const overridden = scope.overridden.has(spec.name);
  return (
    <div className="grid gap-1.5" data-control={spec.name} data-overridden={overridden || undefined}>
      <div className="flex min-h-6 items-center gap-1.5">
        <span className="truncate text-[12px] font-medium text-foreground">{text}</span>
        {overridden && (
          <button
            type="button"
            className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            title={`Reset ${text} to the block's default`}
            aria-label={`Reset ${text}`}
            onClick={() => scope.reset(spec.name)}
          >
            <RotateCcw className="size-3" aria-hidden />
          </button>
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

function Slider({ props, bindings, emit, on }: ControlProps) {
  const bound = useBound(bindings, "number");
  if (bound === null) return null;
  const { scope, spec } = bound;
  const value = typeof props.value === "number" ? props.value : spec.default;
  return (
    <Row
      spec={spec}
      label={props.label}
      scope={scope}
      trailing={
        <span className="text-[12px] tabular-nums text-muted-foreground" data-value>
          {formatNumber(value, spec.step)}
          {spec.unit}
        </span>
      }
    >
      <ui.Slider
        props={{ label: null, min: spec.min, max: spec.max, step: spec.step ?? (spec.max - spec.min) / 100, value }}
        bindings={bindings}
        emit={emit}
        on={on}
      />
    </Row>
  );
}

function Select({ props, bindings, emit, on }: ControlProps) {
  const bound = useBound(bindings, "enum");
  if (bound === null) return null;
  const { scope, spec } = bound;
  return (
    <Row spec={spec} label={props.label} scope={scope}>
      <ui.Select
        props={{ label: "", name: spec.name, options: [...spec.options], placeholder: null, value: String(props.value ?? spec.default), checks: null, validateOn: null }}
        bindings={bindings}
        emit={emit}
        on={on}
      />
    </Row>
  );
}

function Segmented({ props, bindings, emit, on }: ControlProps) {
  const bound = useBound(bindings, "enum");
  if (bound === null) return null;
  const { scope, spec } = bound;
  return (
    <Row spec={spec} label={props.label} scope={scope}>
      <div className="segmented">
        <ui.ToggleGroup
          props={{ items: spec.options.map((o) => ({ label: o, value: o })), type: "single", value: String(props.value ?? spec.default) }}
          bindings={bindings}
          emit={emit}
          on={on}
        />
      </div>
    </Row>
  );
}

function Toggle({ props, bindings, emit, on }: ControlProps) {
  const bound = useBound(bindings, "boolean");
  if (bound === null) return null;
  const { scope, spec } = bound;
  return (
    <Row
      spec={spec}
      label={props.label}
      scope={scope}
      trailing={
        <ui.Switch
          props={{ label: "", name: `control-${spec.name}`, checked: props.value === true, checks: null, validateOn: null }}
          bindings={bindings}
          emit={emit}
          on={on}
        />
      }
    />
  );
}

function Text({ props, bindings, emit, on }: ControlProps) {
  const bound = useBound(bindings, "text");
  if (bound === null) return null;
  const { scope, spec } = bound;
  const value = typeof props.value === "string" ? props.value : spec.default;
  return (
    <Row spec={spec} label={props.label} scope={scope}>
      {spec.multiline ? (
        <ui.Textarea
          props={{ label: "", name: `control-${spec.name}`, placeholder: null, rows: 3, value, checks: null, validateOn: null }}
          bindings={bindings}
          emit={emit}
          on={on}
        />
      ) : (
        <ui.Input
          props={{ label: "", name: `control-${spec.name}`, type: "text", placeholder: null, value, checks: null, validateOn: null }}
          bindings={bindings}
          emit={emit}
          on={on}
        />
      )}
    </Row>
  );
}

/** A native colour well for dragging, plus a hex field that commits only a complete #rrggbb. */
function Colour({ props, bindings }: ControlProps) {
  const bound = useBound(bindings, "color");
  const [value, setValue] = useBoundProp<string>(typeof props.value === "string" ? props.value : undefined, bindings?.value);
  const current = value ?? bound?.spec.default ?? "#000000";
  const [draft, setDraft] = useState(current);
  useEffect(() => setDraft(current), [current]);
  if (bound === null) return null;
  const { scope, spec } = bound;
  const commit = (raw: string) => {
    const hex = (raw.startsWith("#") ? raw : `#${raw}`).toLowerCase();
    if (HEX_COLOR_PATTERN.test(hex)) setValue(hex);
  };
  return (
    <Row spec={spec} label={props.label} scope={scope}>
      <div className="flex h-8 items-center gap-2 rounded-md border border-input bg-background pr-2 pl-1 focus-within:border-primary">
        <input
          type="color"
          aria-label={`${props.label ?? spec.label} colour`}
          className="size-6 cursor-pointer rounded-sm border-0 bg-transparent p-0 [&::-webkit-color-swatch]:rounded-[3px] [&::-webkit-color-swatch]:border [&::-webkit-color-swatch]:border-black/15 [&::-webkit-color-swatch-wrapper]:p-0"
          value={current}
          onChange={(e) => setValue(e.target.value.toLowerCase())}
        />
        <input
          type="text"
          aria-label={`${props.label ?? spec.label} hex`}
          spellCheck={false}
          maxLength={7}
          className="min-w-0 flex-1 bg-transparent text-[12px] tabular-nums uppercase outline-none"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            commit(e.target.value);
          }}
          onBlur={() => setDraft(current)}
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
    <section className="grid gap-3.5 border-b border-border px-4 pt-3.5 pb-4 last:border-b-0">
      {title !== null && <h3 className="text-[12px] font-semibold text-foreground">{title}</h3>}
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
