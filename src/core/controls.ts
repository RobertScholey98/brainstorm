import { defineCatalog, validateSpec, type Spec } from "@json-render/core";
import { schema as reactSchema } from "@json-render/react/schema";
import { z } from "zod";
import { parseWith, toPointer } from "./parse";
import {
  issue,
  type AppearanceProp,
  type AppearanceType,
  type ControlElement,
  type ControlKind,
  type ControlsSpec,
  type Issue,
  type Parsed,
  type PropsSchema,
  type SectionElement,
} from "./types";

const SEGMENTED_MAX_OPTIONS = 3;

// One table drives the catalog, the binding check, derivation and the vocabulary text.
const CONTROLS = {
  Slider: { binds: "number", description: "a slider over the prop's min, max and step, showing its unit" },
  Select: { binds: "enum", description: "a dropdown of the prop's options" },
  Segmented: { binds: "enum", description: `a row of buttons, one per option; suits up to ${SEGMENTED_MAX_OPTIONS} options` },
  Colour: { binds: "color", description: "a colour picker with a hex field" },
  Toggle: { binds: "boolean", description: "an on/off switch" },
  Text: { binds: "text", description: "a text field, multi-line when the prop is multiline" },
} as const satisfies Record<ControlKind, { binds: AppearanceType; description: string }>;

const CONTROL_KINDS = Object.keys(CONTROLS) as ControlKind[];

const DERIVED_KIND: Record<AppearanceType, ControlKind> = {
  number: "Slider",
  enum: "Select",
  color: "Colour",
  boolean: "Toggle",
  text: "Text",
};

const derivedKind = (prop: AppearanceProp): ControlKind =>
  prop.type === "enum" && prop.options.length <= SEGMENTED_MAX_OPTIONS ? "Segmented" : DERIVED_KIND[prop.type];

const SECTION_DESCRIPTION = "groups controls under a title; its children are element keys";

const sectionProps = z.strictObject({ title: z.string().nullable().default(null) });
const controlProps = z.strictObject({
  label: z.string().nullable().default(null),
  value: z.strictObject({
    $bindState: z.string().regex(/^\/[a-z][A-Za-z0-9]*$/, 'expected "/<propName>"'),
  }),
});

export const controlCatalog = defineCatalog(reactSchema, {
  components: {
    Section: { props: sectionProps, description: SECTION_DESCRIPTION, slots: ["default"] },
    ...(Object.fromEntries(
      CONTROL_KINDS.map((kind) => [kind, { props: controlProps, description: CONTROLS[kind].description }]),
    ) as Record<ControlKind, { props: typeof controlProps; description: string }>),
  },
  actions: {},
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Parses controls.json against the catalog and the block's props. Pointers are into controls.json. */
export function validateControls(raw: unknown, props: PropsSchema): Parsed<ControlsSpec> {
  const invalid = (message: string, path: string[] = []) =>
    ({ ok: false, issues: [issue("invalid_controls", message, { pointer: toPointer(path) })] }) as const;

  if (!isRecord(raw) || !isRecord(raw.elements)) return invalid('expected { "root": "<key>", "elements": { … } }');
  const extraKey = Object.keys(raw).find((k) => k !== "root" && k !== "elements");
  if (extraKey !== undefined) return invalid(`unexpected key "${extraKey}"`, [extraKey]);

  const elements: Record<string, unknown> = {};
  for (const [key, el] of Object.entries(raw.elements)) {
    elements[key] = isRecord(el) && el.children === undefined ? { ...el, children: [] } : el;
  }
  const normalized = { root: raw.root, elements };

  const structural = validateSpec(normalized as Spec, { checkOrphans: true }).issues;
  if (structural.length > 0) {
    return {
      ok: false,
      issues: structural.map((si) =>
        issue("invalid_controls", si.message, { pointer: si.elementKey === undefined ? "" : toPointer(["elements", si.elementKey]) }),
      ),
    };
  }
  const catalogCheck = controlCatalog.validate(normalized);
  const spec = catalogCheck.data;
  if (spec === undefined) {
    return {
      ok: false,
      issues: (catalogCheck.error?.issues ?? []).map((zi) => issue("invalid_controls", zi.message, { pointer: toPointer(zi.path) })),
    };
  }

  // catalog.validate checks structure and type names only, so props are checked against the same catalog schemas here.
  const issues: Issue[] = [];
  const parsed: Record<string, SectionElement | ControlElement> = {};
  const bound = new Set<string>();
  for (const [key, el] of Object.entries(spec.elements)) {
    const at = (...path: string[]) => ({ pointer: toPointer(["elements", key, ...path]) });
    const extra = Object.keys(el).find((k) => k !== "type" && k !== "props" && k !== "children");
    if (extra !== undefined) {
      issues.push(issue("invalid_controls", `unexpected key "${extra}"; controls support type, props and children`, at(extra)));
      continue;
    }
    if (el.type === "Section") {
      const p = parseWith(sectionProps, el.props, "invalid_controls", { file: null, pointerPrefix: at("props").pointer });
      if (!p.ok) issues.push(...p.issues);
      else parsed[key] = { type: "Section", props: p.data, children: el.children ?? [] };
      continue;
    }
    const kind = el.type as ControlKind;
    if ((el.children ?? []).length > 0) issues.push(issue("invalid_controls", `${kind} cannot have children`, at("children")));
    const p = parseWith(controlProps, el.props, "invalid_controls", { file: null, pointerPrefix: at("props").pointer });
    if (!p.ok) {
      issues.push(...p.issues);
      continue;
    }
    parsed[key] = { type: kind, props: p.data, children: [] };
    const target = p.data.value.$bindState.slice(1);
    const prop = props.appearance.find((a) => a.name === target);
    const bindAt = at("props", "value", "$bindState");
    if (prop === undefined) {
      const isData = props.data.some((d) => d.name === target);
      issues.push(
        issue(
          "bad_binding",
          isData
            ? `${kind} binds "${target}", a data prop; only appearance props are controllable`
            : `${kind} binds "${target}", which is not an appearance prop`,
          bindAt,
        ),
      );
    } else if (CONTROLS[kind].binds !== prop.type) {
      issues.push(
        issue("bad_binding", `${kind} binds ${CONTROLS[kind].binds} props, but "${target}" is ${prop.type}`, bindAt),
      );
    } else {
      bound.add(target);
    }
  }

  const warnings = props.appearance
    .filter((a) => !bound.has(a.name))
    .map((a) =>
      issue("uncontrolled_prop", `appearance prop "${a.name}" has no control, so Rob can't adjust it`),
    );

  if (issues.length > 0) return { ok: false, issues: [...issues, ...warnings] };
  return { ok: true, value: { root: spec.root, elements: parsed }, warnings };
}

const DERIVED_ROOT = "section";

/** What an absent controls.json means: one Section, one control per appearance prop in schema order. */
export function deriveControls(props: PropsSchema, title: string): ControlsSpec {
  const elements: Record<string, SectionElement | ControlElement> = {};
  const children = props.appearance.map((prop) => {
    const key = `control-${prop.name}`;
    elements[key] = { type: derivedKind(prop), props: { label: null, value: { $bindState: `/${prop.name}` } }, children: [] };
    return key;
  });
  return { root: DERIVED_ROOT, elements: { [DERIVED_ROOT]: { type: "Section", props: { title }, children }, ...elements } };
}

/** The agent-facing reference for controls.json, generated from the catalog table. */
export function controlVocabulary(): string {
  const derivedFor = (type: AppearanceType) =>
    type === "enum" ? `Segmented with up to ${SEGMENTED_MAX_OPTIONS} options, otherwise ${DERIVED_KIND.enum}` : DERIVED_KIND[type];
  return [
    'controls.json is a json-render spec: { "root": "<key>", "elements": { "<key>": { "type": …, "props": { … }, "children": ["<key>", …] } } }.',
    'Bind a control to an appearance prop with "value": { "$bindState": "/<prop>" }. The control kind must match the prop type.',
    "Range, step, unit and options always come from the prop spec, never from the control. \"label\": null shows the prop's label.",
    "",
    `- Section { "title": string | null }, with children: ${SECTION_DESCRIPTION}.`,
    ...CONTROL_KINDS.map((k) => `- ${k} { "label": string | null, "value": { "$bindState": "/<${CONTROLS[k].binds} prop>" } }: ${CONTROLS[k].description}.`),
    "",
    "Without controls.json, Brainstorm derives one Section titled with the block title, holding one control per appearance prop in schema order: " +
      (Object.keys(DERIVED_KIND) as AppearanceType[]).map((t) => `${t} → ${derivedFor(t)}`).join("; ") +
      ".",
    "An explicit spec that leaves an appearance prop without a control gets an uncontrolled_prop warning.",
  ].join("\n");
}
