/**
 * Component Story Format, read the way Storybook renders it. It takes React as an argument and imports nothing, so the
 * check worker's sandbox and the canvas frame both bundle it with their own React.
 */

type ReactLike = {
  createElement: (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => unknown;
};

type Decorator = (story: () => unknown, context: StoryContext) => unknown;

type Meta = {
  readonly title?: unknown;
  readonly component?: unknown;
  readonly args?: unknown;
  readonly argTypes?: unknown;
  readonly tags?: unknown;
  readonly render?: unknown;
  readonly decorators?: unknown;
};

type StoryContext = { readonly args: Record<string, unknown>; readonly name: string; readonly title: string };

export type StoryRecord = {
  /** `<file>#<export>`, stable across syncs while the file and export keep their names. */
  readonly id: string;
  readonly file: string;
  readonly exportName: string;
  /** Storybook's title, such as `Components/Button`. */
  readonly title: string;
  /** The story's display name, such as `With icon`. */
  readonly name: string;
  readonly meta: Meta;
  readonly story: unknown;
};

const startCase = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

const fileTitle = (file: string) => startCase((file.split("/").at(-1) ?? file).replace(/\.stories\.[jt]sx?$/, ""));

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

/** Every story in every loaded module, in file then export order. A module that throws on load is reported, not fatal. */
export function listStories(modules: Readonly<Record<string, () => unknown>>): {
  stories: StoryRecord[];
  failed: { file: string; message: string }[];
} {
  const stories: StoryRecord[] = [];
  const failed: { file: string; message: string }[] = [];
  for (const [file, load] of Object.entries(modules)) {
    let mod: Record<string, unknown>;
    try {
      mod = asRecord(load());
    } catch (e) {
      failed.push({ file, message: e instanceof Error ? e.message : String(e) });
      continue;
    }
    const meta = asRecord(mod.default) as Meta;
    const title = typeof meta.title === "string" ? meta.title : fileTitle(file);
    for (const [exportName, story] of Object.entries(mod)) {
      if (exportName === "default" || exportName.startsWith("__")) continue;
      if (typeof story !== "object" && typeof story !== "function") continue;
      if (story === null) continue;
      const named = asRecord(story);
      const name = typeof named.name === "string" && typeof story === "object" ? named.name : typeof named.storyName === "string" ? named.storyName : startCase(exportName);
      stories.push({ id: `${file}#${exportName}`, file, exportName, title, name, meta, story });
    }
  }
  return { stories, failed };
}

export function storyArgs(record: StoryRecord): Record<string, unknown> {
  return { ...asRecord(record.meta.args), ...asRecord(asRecord(record.story).args) };
}

/** Storybook `tags` from the meta and the story, such as `"composite"` (ADR 008). */
export function storyTags(record: StoryRecord): string[] {
  const tags = [...asArray(asRecord(record.meta).tags), ...asArray(asRecord(record.story).tags)].filter((t): t is string => typeof t === "string");
  return [...new Set(tags)];
}

type ArgTypeOut = { control: "text" | "number" | "boolean" | "select" | null; options: (string | number | boolean)[] | null; description: string | null };

/**
 * A story's `argTypes`, from its meta and itself, as the controls the workbench draws. Storybook infers controls from
 * TypeScript too; Brainstorm has only what the story says and the arg's own value, so the rest stay text or none.
 */
export function storyArgTypes(record: StoryRecord): Record<string, ArgTypeOut> {
  const merged: Record<string, Record<string, unknown>> = {};
  for (const source of [asRecord(asRecord(record.meta).argTypes), asRecord(asRecord(record.story).argTypes)]) {
    for (const [name, value] of Object.entries(source)) merged[name] = { ...merged[name], ...asRecord(value) };
  }
  const out: Record<string, ArgTypeOut> = {};
  for (const [name, t] of Object.entries(merged)) {
    const options = Array.isArray(t.options) ? t.options.filter((o): o is string | number | boolean => ["string", "number", "boolean"].includes(typeof o)) : null;
    const raw = t.control;
    const kind = typeof raw === "string" ? raw : typeof raw === "object" && raw !== null ? asRecord(raw).type : raw === false ? "none" : undefined;
    const control =
      kind === "none"
        ? null
        : kind === "boolean"
          ? "boolean"
          : kind === "number" || kind === "range"
            ? "number"
            : kind === "select" || kind === "radio" || kind === "inline-radio" || (options !== null && options.length > 0)
              ? "select"
              : kind === "text"
                ? "text"
                : null;
    out[name] = { control, options: options !== null && options.length > 0 ? options : null, description: typeof t.description === "string" ? t.description : null };
  }
  return out;
}

/** The element Storybook would render for a story: its render function, else meta's, else the component with args. */
export function storyElement(React: ReactLike, record: StoryRecord, overrides: Record<string, unknown> = {}): unknown {
  const story = asRecord(record.story);
  const args = { ...storyArgs(record), ...overrides };
  const context: StoryContext = { args, name: record.name, title: record.title };
  const render =
    typeof record.story === "function"
      ? (record.story as (a: unknown, c: unknown) => unknown)
      : typeof story.render === "function"
        ? (story.render as (a: unknown, c: unknown) => unknown)
        : typeof record.meta.render === "function"
          ? (record.meta.render as (a: unknown, c: unknown) => unknown)
          : null;
  const base = (): unknown => {
    if (render !== null) return React.createElement(function StoryRender() {
      return render(args, context);
    });
    if (record.meta.component === undefined || record.meta.component === null) throw new Error(`${record.id} has no render function and its meta names no component`);
    return React.createElement(record.meta.component, args);
  };
  const decorators = [...asArray(story.decorators), ...asArray(record.meta.decorators)].filter(
    (d): d is Decorator => typeof d === "function",
  );
  return decorators.reduce<() => unknown>((inner, decorate) => () => {
    const Inner = () => inner();
    return React.createElement(function Decorated() {
      return decorate(Inner, context);
    });
  }, base)();
}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

/** A story's args as JSON the agent can read: functions and elements become a note, nothing throws. */
export function describeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const seen = new Set<unknown>();
  const describe = (value: unknown, depth: number): unknown => {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "function") return "[function]";
    if (typeof value !== "object" || depth > 4 || seen.has(value)) return "[value]";
    if ("$$typeof" in (value as object)) return "[element]";
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 12).map((v) => describe(v, depth + 1));
    return Object.fromEntries(Object.entries(value as object).slice(0, 30).map(([k, v]) => [k, describe(v, depth + 1)]));
  };
  return describe(args, 0) as Record<string, unknown>;
}
