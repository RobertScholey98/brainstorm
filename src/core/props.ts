import { z } from "zod";
import { parseWith, toPointer } from "./parse";
import {
  issue,
  parsePropName,
  type AppearanceProp,
  type AppearanceValue,
  type BlockId,
  type DataProp,
  type InapplicableOverride,
  type Issue,
  type Json,
  type Override,
  type OverrideMismatch,
  type Parsed,
  type PropName,
  type Props,
  type PropsSchema,
} from "./types";

export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** React consumes these before the component sees them. */
const RESERVED_PROP_NAMES = new Set(["key", "ref"]);

const label = z.string().min(1);

// GUIDE.md is generated from this table.
export const PROP_TYPES = {
  data: {
    fields: z.strictObject({ type: z.literal("data"), description: z.string().optional(), sample: z.json() }),
    rule: "What the block shows. `sample` is any JSON value; the block receives it in Brainstorm. Not controllable.",
  },
  number: {
    fields: z.strictObject({
      type: z.literal("number"),
      label,
      default: z.number(),
      min: z.number(),
      max: z.number(),
      step: z.number().positive().optional(),
      unit: z.string().optional(),
    }),
    rule: "`min` < `max`, and `default` within them.",
  },
  enum: {
    fields: z.strictObject({ type: z.literal("enum"), label, default: z.string(), options: z.array(z.string().min(1)) }),
    rule: "`options` non-empty and unique, `default` one of them.",
  },
  color: {
    fields: z.strictObject({ type: z.literal("color"), label, default: z.string() }),
    rule: "`default` is `#rrggbb`.",
  },
  boolean: {
    fields: z.strictObject({ type: z.literal("boolean"), label, default: z.boolean() }),
    rule: "",
  },
  text: {
    fields: z.strictObject({ type: z.literal("text"), label, default: z.string(), multiline: z.boolean().optional() }),
    rule: "",
  },
} as const;

const appearanceFields = z.discriminatedUnion("type", [
  PROP_TYPES.number.fields,
  PROP_TYPES.enum.fields,
  PROP_TYPES.color.fields,
  PROP_TYPES.boolean.fields,
  PROP_TYPES.text.fields,
]);

const schemaShape = z.strictObject({
  data: z.record(z.string(), PROP_TYPES.data.fields).optional(),
  appearance: z.record(z.string(), appearanceFields).optional(),
});

/** Parses block.json `props`. Issue pointers are relative to that object; the caller places them in a file. */
export function parsePropsSchema(json: unknown): Parsed<PropsSchema> {
  const shape = parseWith(schemaShape, json, "invalid_prop", { file: null });
  if (!shape.ok) return shape;

  const issues: Issue[] = [];
  const at = (...path: string[]) => ({ pointer: toPointer(path) });

  const named = <T>(section: "data" | "appearance", entries: Record<string, T>) =>
    Object.entries(entries).flatMap(([raw, spec]) => {
      const name = parsePropName(raw);
      if (name === null || RESERVED_PROP_NAMES.has(raw)) {
        issues.push(
          issue(
            "invalid_prop",
            RESERVED_PROP_NAMES.has(raw)
              ? `"${raw}" is reserved by React; choose another name`
              : `"${raw}" is not a camelCase identifier`,
            at(section, raw),
          ),
        );
        return [];
      }
      return [{ name, spec }];
    });

  const data: DataProp[] = named("data", shape.data.data ?? {}).map(({ name, spec }) => ({
    name,
    type: "data",
    description: spec.description ?? null,
    sample: spec.sample as Json,
  }));

  const dataNames = new Set<string>(data.map((d) => d.name));
  const appearance: AppearanceProp[] = [];
  for (const { name, spec } of named("appearance", shape.data.appearance ?? {})) {
    const fail = (field: string, message: string) => issues.push(issue("invalid_prop", message, at("appearance", name, field)));
    if (dataNames.has(name)) {
      issues.push(
        issue("invalid_prop", `"${name}" is both a data and an appearance prop; the block gets one flat props object`, at("appearance", name)),
      );
    }
    switch (spec.type) {
      case "number": {
        if (!(spec.min < spec.max)) fail("max", `max (${spec.max}) must be greater than min (${spec.min})`);
        else if (spec.default < spec.min || spec.default > spec.max)
          fail("default", `default ${spec.default} is outside ${spec.min}–${spec.max}`);
        appearance.push({ ...spec, name, step: spec.step ?? null, unit: spec.unit ?? null });
        break;
      }
      case "enum": {
        const [first, ...rest] = spec.options;
        if (first === undefined) {
          fail("options", "options must not be empty");
          break;
        }
        const duplicate = spec.options.find((o, i) => spec.options.indexOf(o) !== i);
        if (duplicate !== undefined) fail("options", `option "${duplicate}" appears twice`);
        if (!spec.options.includes(spec.default)) fail("default", `default "${spec.default}" is not one of the options`);
        appearance.push({ ...spec, name, options: [first, ...rest] });
        break;
      }
      case "color": {
        if (!HEX_COLOR_PATTERN.test(spec.default)) fail("default", `default "${spec.default}" is not #rrggbb`);
        appearance.push({ ...spec, name });
        break;
      }
      case "boolean":
        appearance.push({ ...spec, name });
        break;
      case "text":
        appearance.push({ ...spec, name, multiline: spec.multiline ?? false });
        break;
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: { data, appearance }, warnings: [] };
}

export type ValueCheck =
  | { readonly ok: true; readonly value: AppearanceValue }
  | { readonly ok: false; readonly reason: Exclude<OverrideMismatch, "prop_removed" | "block_removed"> };

/** Validates Rob's write, and decides on read whether a stored override still fits its prop. */
export function parseAppearanceValue(prop: AppearanceProp, value: unknown): ValueCheck {
  switch (prop.type) {
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, reason: "type_changed" };
      return value < prop.min || value > prop.max ? { ok: false, reason: "out_of_range" } : { ok: true, value };
    case "enum":
      if (typeof value !== "string") return { ok: false, reason: "type_changed" };
      return prop.options.includes(value) ? { ok: true, value } : { ok: false, reason: "option_removed" };
    case "color":
      return typeof value === "string" && HEX_COLOR_PATTERN.test(value) ? { ok: true, value } : { ok: false, reason: "type_changed" };
    case "boolean":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false, reason: "type_changed" };
    case "text":
      return typeof value === "string" ? { ok: true, value } : { ok: false, reason: "type_changed" };
  }
}

export function classifyOverrides(
  schemas: ReadonlyMap<BlockId, PropsSchema>,
  overrides: readonly Override[],
): { applicable: Override[]; inapplicable: InapplicableOverride[] } {
  const applicable: Override[] = [];
  const inapplicable: InapplicableOverride[] = [];
  for (const override of overrides) {
    const reason = mismatch(schemas.get(override.blockId), override);
    if (reason === null) applicable.push(override);
    else inapplicable.push({ override, reason });
  }
  return { applicable, inapplicable };
}

function mismatch(schema: PropsSchema | undefined, override: Override): OverrideMismatch | null {
  if (schema === undefined) return "block_removed";
  const prop = schema.appearance.find((p) => p.name === override.prop);
  if (prop === undefined) {
    return schema.data.some((d) => d.name === override.prop) ? "type_changed" : "prop_removed";
  }
  const check = parseAppearanceValue(prop, override.value);
  return check.ok ? null : check.reason;
}

export function resolveProps(schema: PropsSchema, applicable: readonly Override[]): Props {
  const props: Record<string, Json> = {};
  for (const d of schema.data) props[d.name] = d.sample;
  for (const a of schema.appearance) props[a.name] = a.default;
  for (const o of applicable) props[o.prop] = o.value;
  return props;
}

export function appearanceProp(schema: PropsSchema, name: PropName): AppearanceProp | undefined {
  return schema.appearance.find((p) => p.name === name);
}
