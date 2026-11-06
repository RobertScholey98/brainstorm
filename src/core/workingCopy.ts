import { createHash } from "node:crypto";
import { z } from "zod";
import { ALLOWED_IMPORTS, CHECK_TIMEOUT_MS } from "./check/rules";
import { controlVocabulary, deriveControls, validateControls } from "./controls";
import { parseWith } from "./parse";
import { parsePropsSchema, PROP_TYPES } from "./props";
import {
  blockIdOf,
  isError,
  issue,
  parseIterationN,
  parseSessionId,
  parseSlotId,
  parseVariantKey,
  SLOT_ID_PATTERN,
  type BlockDraft,
  type BlockFiles,
  type BlockId,
  type ContentHash,
  type FileMap,
  type IterationContents,
  type IterationN,
  type Issue,
  type Parsed,
  type SessionId,
  type SlotId,
  type SlotManifest,
  type StoredBlock,
  type VariantKey,
  type WorkingCopyDraft,
  type WorkingCopyManifest,
} from "./types";

const MANIFEST = "brainstorm.json";
const GUIDE = "GUIDE.md";
const GITIGNORE = ".gitignore";
const IGNORED_ON_COMMIT = new Set([GUIDE, GITIGNORE]);

const FRAME_WIDTH = { min: 240, max: 1920, default: 390 } as const;
const FRAME_HEIGHT = { min: 100, max: 4000 } as const;

// Key order here is the canonical file order for the content hash.
const BLOCK_FILES = {
  "block.tsx": { key: "tsx", required: true, about: "the component" },
  "block.json": { key: "json", required: true, about: '`{ "title": "Neon wheel", "props": { "data": {…}, "appearance": {…} } }`' },
  "block.css": { key: "css", required: false, about: 'styles, served wrapped in `@scope ([data-bid="<slot>/<variant>"])`' },
  "controls.json": { key: "controls", required: false, about: "a json-render controls spec; absent means derived from the props" },
} as const satisfies Record<string, { key: keyof BlockFiles; required: boolean; about: string }>;

type BlockFileName = keyof typeof BLOCK_FILES;
const BLOCK_FILE_NAMES = Object.keys(BLOCK_FILES) as BlockFileName[];
const FILE_NAME_OF = Object.fromEntries(BLOCK_FILE_NAMES.map((name) => [BLOCK_FILES[name].key, name])) as Record<
  keyof BlockFiles,
  BlockFileName
>;
const isBlockFileName = (name: string): name is BlockFileName => Object.hasOwn(BLOCK_FILES, name);

/** Block files an older format read. They fail like any other unknown file, and the message tells the agent to stop. */
const RETIRED_FILES: Readonly<Record<string, string>> = {
  "about.md":
    "Brainstorm no longer reads variant notes, so delete about.md and write no more. Rob judges the designs on the canvas himself; keep each variant's hypothesis in its design, not in a note.",
};

const manifestShape = z.strictObject({
  format: z.literal(1),
  session: z.string(),
  base: z.number().nullable(),
  slots: z.array(
    z.strictObject({
      id: z.string(),
      title: z.string().min(1),
      frame: z
        .strictObject({
          width: z.number().int().min(FRAME_WIDTH.min).max(FRAME_WIDTH.max).default(FRAME_WIDTH.default),
          height: z.number().int().min(FRAME_HEIGHT.min).max(FRAME_HEIGHT.max).nullable().default(null),
        })
        .default({ width: FRAME_WIDTH.default, height: null }),
    }),
  ),
});

const blockJsonShape = z.strictObject({ title: z.string().min(1), props: z.unknown() });

/** CRLF and a BOM are editor noise; stored content and hashes use the normalized text. */
const normalize = (text: string): string => text.replace(/^﻿/, "").replace(/\r\n/g, "\n");

export function contentHash(files: BlockFiles): ContentHash {
  const present = BLOCK_FILE_NAMES.flatMap((name) => {
    const text = files[BLOCK_FILES[name].key];
    return text === null ? [] : [[name, text]];
  });
  return createHash("sha256").update(JSON.stringify(present)).digest("hex") as ContentHash;
}

function parseJson(text: string, file: string): { ok: true; value: unknown } | { ok: false; issue: Issue } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, issue: issue("invalid_json", (e as Error).message, { file }) };
  }
}

const inFile = (issues: readonly Issue[], file: string, prefix = ""): Issue[] =>
  issues.map((i) => ({ ...i, file, pointer: i.pointer === null ? null : prefix + i.pointer }));

type BlockDir = { slot: SlotId; variant: VariantKey; files: Partial<Record<BlockFileName, string>> };

export function parseWorkingCopy(raw: FileMap): Parsed<WorkingCopyDraft> {
  return scanWorkingCopy(raw).parsed;
}

/** parseWorkingCopy, plus the blocks that parsed even when others failed, so a caller can check them in the same round. */
export function scanWorkingCopy(raw: FileMap): { readonly parsed: Parsed<WorkingCopyDraft>; readonly blocks: readonly BlockDraft[] } {
  const issues: Issue[] = [];
  const dirs = new Map<string, BlockDir>();
  const badIds = new Set<string>();
  let manifestText: string | null = null;

  for (const path of Object.keys(raw).sort()) {
    const text = normalize(raw[path] ?? "");
    if (path === MANIFEST) {
      manifestText = text;
      continue;
    }
    if (IGNORED_ON_COMMIT.has(path)) continue;
    const parts = path.split("/");
    const [top, slotRaw, variantRaw, name] = parts;
    if (parts.length !== 4 || top !== "slots" || !slotRaw || !variantRaw || !name || !isBlockFileName(name)) {
      const retired = top === "slots" && name !== undefined && Object.hasOwn(RETIRED_FILES, name) ? RETIRED_FILES[name] : undefined;
      issues.push(
        issue(
          "unexpected_file",
          retired ??
            `Brainstorm reads only ${MANIFEST} and slots/<slot>/<variant>/{${BLOCK_FILE_NAMES.join(",")}}, so this file would be dropped. Blocks can't import local files; inline helpers in block.tsx.`,
          { file: path },
        ),
      );
      continue;
    }
    const slot = parseSlotId(slotRaw);
    const variant = parseVariantKey(variantRaw);
    if (slot === null || variant === null) {
      const dir = slot === null ? `slots/${slotRaw}` : `slots/${slotRaw}/${variantRaw}`;
      if (!badIds.has(dir)) {
        badIds.add(dir);
        issues.push(
          issue("invalid_id", `"${slot === null ? slotRaw : variantRaw}" must match ${SLOT_ID_PATTERN.source}`, { file: dir }),
        );
      }
      continue;
    }
    const key = `${slot}/${variant}`;
    const dir = dirs.get(key) ?? { slot, variant, files: {} };
    dir.files[name] = text;
    dirs.set(key, dir);
  }

  const manifest = manifestText === null ? null : parseManifest(manifestText, issues);
  if (manifestText === null) {
    issues.push(issue("missing_file", `${MANIFEST} is required; run brainstorm pull to recreate it`, { file: MANIFEST }));
  }

  if (manifest !== null) {
    const dirSlots = new Set([...dirs.values()].map((d) => d.slot as string));
    const listed = new Set(manifest.slots.map((s) => s.id as string));
    for (const slot of [...dirSlots].filter((s) => !listed.has(s))) {
      issues.push(
        issue("unlisted_slot", `slots/${slot} exists but "${slot}" is not listed in slots`, { file: MANIFEST, pointer: "/slots" }),
      );
    }
    manifest.slots.forEach((s, i) => {
      if (!dirSlots.has(s.id) && !badIds.has(`slots/${s.id}`)) {
        issues.push(
          issue("empty_slot", `slot "${s.id}" has no variants; add slots/${s.id}/<variant>/`, { file: MANIFEST, pointer: `/slots/${i}` }),
        );
      }
    });
  }

  const blocks: BlockDraft[] = [];
  const warnings: Issue[] = [];
  const order = manifest?.slots.map((s) => s.id as string) ?? [];
  const sortedDirs = [...dirs.values()].sort(
    (a, b) => order.indexOf(a.slot) - order.indexOf(b.slot) || (a.variant < b.variant ? -1 : a.variant > b.variant ? 1 : 0),
  );
  for (const dir of sortedDirs) {
    const block = parseBlock(dir, issues, warnings);
    if (block !== null) blocks.push(block);
  }

  const all = [...issues, ...warnings];
  if (manifest === null || all.some(isError)) return { parsed: { ok: false, issues: all }, blocks };
  return { parsed: { ok: true, value: { manifest, blocks }, warnings }, blocks };
}

function parseManifest(text: string, issues: Issue[]): WorkingCopyManifest | null {
  const json = parseJson(text, MANIFEST);
  if (!json.ok) {
    issues.push(json.issue);
    return null;
  }
  const shape = parseWith(manifestShape, json.value, "invalid_manifest", { file: MANIFEST });
  if (!shape.ok) {
    issues.push(...shape.issues);
    return null;
  }
  const before = issues.length;
  const session = parseSessionId(shape.data.session);
  if (session === null) {
    issues.push(issue("invalid_manifest", `"${shape.data.session}" is not a session id`, { file: MANIFEST, pointer: "/session" }));
  }
  const base = shape.data.base === null ? null : parseIterationN(shape.data.base);
  if (shape.data.base !== null && base === null) {
    issues.push(issue("invalid_manifest", "base must be a positive integer or null", { file: MANIFEST, pointer: "/base" }));
  }
  const seen = new Set<string>();
  const slots: SlotManifest[] = [];
  shape.data.slots.forEach((s, i) => {
    const id = parseSlotId(s.id);
    if (id === null) {
      issues.push(issue("invalid_id", `"${s.id}" must match ${SLOT_ID_PATTERN.source}`, { file: MANIFEST, pointer: `/slots/${i}/id` }));
    } else if (seen.has(id)) {
      issues.push(issue("invalid_manifest", `slot "${id}" is listed twice`, { file: MANIFEST, pointer: `/slots/${i}/id` }));
    } else {
      seen.add(id);
      slots.push({ id, title: s.title, frame: s.frame });
    }
  });
  if (issues.length > before || session === null) return null;
  return { format: 1, session, base, slots };
}

function parseBlock(dir: BlockDir, issues: Issue[], warnings: Issue[]): BlockDraft | null {
  const path = (name: BlockFileName) => `slots/${dir.slot}/${dir.variant}/${name}`;
  const before = issues.length;
  for (const name of BLOCK_FILE_NAMES) {
    if (BLOCK_FILES[name].required && dir.files[name] === undefined) {
      issues.push(issue("missing_file", `${name} is required in every block (${BLOCK_FILES[name].about})`, { file: path(name) }));
    }
  }
  const tsx = dir.files["block.tsx"];
  const jsonText = dir.files["block.json"];
  if (tsx === undefined || jsonText === undefined) return null;

  const json = parseJson(jsonText, path("block.json"));
  if (!json.ok) {
    issues.push(json.issue);
    return null;
  }
  const shape = parseWith(blockJsonShape, json.value, "invalid_block", { file: path("block.json") });
  if (!shape.ok) {
    issues.push(...shape.issues);
    return null;
  }
  const props = parsePropsSchema(shape.data.props ?? {});
  if (!props.ok) {
    issues.push(...inFile(props.issues, path("block.json"), "/props"));
    return null;
  }

  const controlsText = dir.files["controls.json"] ?? null;
  let controls = deriveControls(props.value, shape.data.title);
  if (controlsText !== null) {
    const controlsJson = parseJson(controlsText, path("controls.json"));
    if (!controlsJson.ok) {
      issues.push(controlsJson.issue);
      return null;
    }
    const parsed = validateControls(controlsJson.value, props.value);
    if (!parsed.ok) {
      issues.push(...inFile(parsed.issues, path("controls.json")));
      return null;
    }
    warnings.push(...inFile(parsed.warnings, path("controls.json")));
    controls = parsed.value;
  }

  if (issues.length > before) return null;
  const files: BlockFiles = {
    tsx,
    json: jsonText,
    css: dir.files["block.css"] ?? null,
    controls: controlsText,
  };
  return {
    id: blockIdOf(dir.slot, dir.variant),
    slot: dir.slot,
    variant: dir.variant,
    hash: contentHash(files),
    files,
    title: shape.data.title,
    props: props.value,
    controls,
  };
}

/** Reads a stored block back into its parsed form. Stored blocks passed this same parse when they were committed. */
export function readStoredBlock(block: StoredBlock): BlockDraft | null {
  const [slot, variant] = block.id.split("/");
  const s = parseSlotId(slot ?? "");
  const v = parseVariantKey(variant ?? "");
  if (s === null || v === null) return null;
  const files: BlockDir["files"] = {};
  for (const name of BLOCK_FILE_NAMES) {
    const text = block.files[BLOCK_FILES[name].key];
    if (text !== null) files[name] = text;
  }
  return parseBlock({ slot: s, variant: v, files }, [], []);
}

const manifestJson = (files: FileMap): Record<string, unknown> | null => {
  const text = files[MANIFEST];
  if (text === undefined) return null;
  const json = parseJson(normalize(text), MANIFEST);
  return json.ok && typeof json.value === "object" && json.value !== null && !Array.isArray(json.value)
    ? (json.value as Record<string, unknown>)
    : null;
};

export function workingCopySession(files: FileMap): SessionId | null {
  const session = manifestJson(files)?.session;
  return typeof session === "string" ? parseSessionId(session) : null;
}

/** The files to write so the copy records `base` after a commit. Empty when the manifest is unreadable. */
export function withBase(files: FileMap, base: IterationN): FileMap {
  const manifest = manifestJson(files);
  return manifest === null ? {} : { [MANIFEST]: JSON.stringify({ ...manifest, base }, null, 2) + "\n" };
}

export function blockFile(id: BlockId, key: keyof BlockFiles): string {
  return `slots/${id}/${FILE_NAME_OF[key]}`;
}

/** Whether `pull` owns this path: it replaces `slots/` wholesale and rewrites the generated files. */
export function ownedByPull(path: string): boolean {
  return path === MANIFEST || IGNORED_ON_COMMIT.has(path) || path.startsWith("slots/");
}

export function emitWorkingCopy(session: SessionId, iteration: IterationContents | null): FileMap {
  const manifest = {
    format: 1,
    session,
    base: iteration?.n ?? null,
    slots: (iteration?.slots ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      frame: s.frame.height === null ? { width: s.frame.width } : s.frame,
    })),
  };
  const files: Record<string, string> = {
    [GITIGNORE]: "*\n",
    [GUIDE]: guide(session),
    [MANIFEST]: JSON.stringify(manifest, null, 2) + "\n",
  };
  for (const block of iteration?.blocks ?? []) {
    for (const name of BLOCK_FILE_NAMES) {
      const text = block.files[BLOCK_FILES[name].key];
      if (text !== null) files[`slots/${block.id}/${name}`] = text;
    }
  }
  return files;
}

function fieldList(shape: Record<string, z.ZodType>): string {
  return Object.entries(shape)
    .filter(([key]) => key !== "type")
    .map(([key, schema]) => (schema.safeParse(undefined).success ? `${key}?` : key))
    .join(", ");
}

function guide(session: SessionId): string {
  const propTypes = Object.entries(PROP_TYPES).map(
    ([type, { fields, rule }]) => `- \`"${type}"\`: ${fieldList(fields.shape)}.${rule ? ` ${rule}` : ""}`,
  );
  return [
    `# Brainstorm working copy for ${session}`,
    "",
    "This folder only moves files between you and Brainstorm, which stores nothing here. Edit the files, then run",
    `\`brainstorm validate ${session} --from <this folder>\`, then \`brainstorm commit ${session} --from <this folder>\`.`,
    "`brainstorm pull` replaces `slots/` wholesale. This guide and `.gitignore` are regenerated and ignored on commit.",
    "",
    "## Layout",
    "",
    `- \`${MANIFEST}\`: \`{ "format": 1, "session", "base", "slots": [{ "id", "title", "frame": { "width", "height" } }] }\`. Leave \`base\` alone: a commit whose base is behind the latest iteration is refused, so pull again.`,
    `- \`slots/<slot>/<variant>/\` is one block, with id \`<slot>/<variant>\`. Slot and variant ids match \`${SLOT_ID_PATTERN.source}\`.`,
    ...BLOCK_FILE_NAMES.map((name) => `  - \`${name}\` (${BLOCK_FILES[name].required ? "required" : "optional"}): ${BLOCK_FILES[name].about}.`),
    "- Any other file is an error, so nothing you expect to ship is silently dropped.",
    "",
    "## Slots",
    "",
    `- Every \`slots/<slot>\` directory is listed in \`${MANIFEST}\` \`slots\`, and every listed slot has at least one variant. Frames render in \`slots\` order.`,
    `- \`frame.width\` is an integer ${FRAME_WIDTH.min}–${FRAME_WIDTH.max}, default ${FRAME_WIDTH.default}. \`frame.height\` is an integer ${FRAME_HEIGHT.min}–${FRAME_HEIGHT.max}, or absent for auto.`,
    "",
    "## block.tsx",
    "",
    "- A default-exported function component. It receives data samples, then appearance defaults, then Rob's overrides, as one flat props object.",
    `- It may import only ${ALLOWED_IMPORTS.map((i) => `\`${i}\``).join(" and ")}. TypeScript types are stripped, not checked.`,
    `- It must render without throwing, with defaults and with Rob's overrides, within ${CHECK_TIMEOUT_MS / 1000} s. No \`window\` or \`document\` during render; effects are fine.`,
    '- Mark meaningful elements with `data-part="<name>"`, unique within the render. Rob pins feedback to them. Never write `data-bid`.',
    "",
    "## Props (`block.json` `props`)",
    "",
    "- `data` props are what the block shows. `appearance` props are what Rob adjusts. Both are optional objects keyed by camelCase prop name.",
    "- Data and appearance names are disjoint. `key` and `ref` are reserved. Fields marked `?` are optional.",
    ...propTypes,
    "",
    "## Controls (`controls.json`)",
    "",
    controlVocabulary(),
    "",
  ].join("\n");
}
