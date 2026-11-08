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
  parseProposedName,
  parseSessionId,
  PROPOSED_NAME_PATTERN,
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
  type ProposedDraft,
  type ProposedFiles,
  type ProposedName,
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
/** A session with a design system gets its catalog and story sources here on pull, to read; commit ignores the folder. */
const SYSTEM_DIR = "system/";

// Key order here is the canonical file order for a proposed component's content hash.
const PROPOSED_FILES = {
  "component.tsx": { key: "tsx", required: true, about: "the component, default-exported; it may import react, kit and other proposed components" },
  "component.json": { key: "json", required: true, about: '`{ "title": "Chore list", "description": "…", "example": { …props } }`' },
  "component.css": { key: "css", required: false, about: 'styles, served wrapped in `@scope ([data-proposed="<Name>"])`; only values the kit uses' },
} as const satisfies Record<string, { key: keyof ProposedFiles; required: boolean; about: string }>;

type ProposedFileName = keyof typeof PROPOSED_FILES;
const PROPOSED_FILE_NAMES = Object.keys(PROPOSED_FILES) as ProposedFileName[];
const isProposedFileName = (name: string): name is ProposedFileName => Object.hasOwn(PROPOSED_FILES, name);

const proposedJsonShape = z.strictObject({
  title: z.string().min(1),
  description: z.string().min(1),
  example: z.record(z.string(), z.json()).default({}),
});

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

export function proposedHash(files: ProposedFiles): ContentHash {
  const present = PROPOSED_FILE_NAMES.flatMap((name) => {
    const text = files[PROPOSED_FILES[name].key];
    return text === null ? [] : [[name, text]];
  });
  return createHash("sha256").update(JSON.stringify(["proposed", ...present])).digest("hex") as ContentHash;
}

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
  const proposedDirs = new Map<string, Partial<Record<ProposedFileName, string>>>();
  const badIds = new Set<string>();
  let manifestText: string | null = null;

  for (const path of Object.keys(raw).sort()) {
    const text = normalize(raw[path] ?? "");
    if (path === MANIFEST) {
      manifestText = text;
      continue;
    }
    if (IGNORED_ON_COMMIT.has(path) || path.startsWith(SYSTEM_DIR)) continue;
    const parts = path.split("/");
    if (parts[0] === "proposed") {
      const [, nameRaw, fileName] = parts;
      if (parts.length !== 3 || nameRaw === undefined || fileName === undefined || !isProposedFileName(fileName)) {
        issues.push(
          issue("unexpected_file", `a proposed component is proposed/<Name>/{${PROPOSED_FILE_NAMES.join(",")}}, so this file would be dropped`, {
            file: path,
          }),
        );
        continue;
      }
      if (parseProposedName(nameRaw) === null) {
        if (!badIds.has(`proposed/${nameRaw}`)) {
          badIds.add(`proposed/${nameRaw}`);
          issues.push(issue("invalid_id", `"${nameRaw}" must match ${PROPOSED_NAME_PATTERN.source}, PascalCase like a component`, { file: `proposed/${nameRaw}` }));
        }
        continue;
      }
      const dir = proposedDirs.get(nameRaw) ?? {};
      dir[fileName] = text;
      proposedDirs.set(nameRaw, dir);
      continue;
    }
    const [top, slotRaw, variantRaw, name] = parts;
    if (parts.length !== 4 || top !== "slots" || !slotRaw || !variantRaw || !name || !isBlockFileName(name)) {
      const retired = top === "slots" && name !== undefined && Object.hasOwn(RETIRED_FILES, name) ? RETIRED_FILES[name] : undefined;
      issues.push(
        issue(
          "unexpected_file",
          retired ??
            `Brainstorm reads only ${MANIFEST}, slots/<slot>/<variant>/{${BLOCK_FILE_NAMES.join(",")}} and, with a design system, proposed/<Name>/{${PROPOSED_FILE_NAMES.join(",")}}, so this file would be dropped. Blocks can't import local files; inline helpers in block.tsx.`,
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

  const proposed: ProposedDraft[] = [];
  for (const [name, files] of [...proposedDirs].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const draft = parseProposed(name as ProposedName, files, issues);
    if (draft !== null) proposed.push(draft);
  }

  const all = [...issues, ...warnings];
  if (manifest === null || all.some(isError)) return { parsed: { ok: false, issues: all }, blocks };
  return { parsed: { ok: true, value: { manifest, blocks, proposed }, warnings }, blocks };
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

function parseProposed(name: ProposedName, files: Partial<Record<ProposedFileName, string>>, issues: Issue[]): ProposedDraft | null {
  const path = (file: ProposedFileName) => `proposed/${name}/${file}`;
  const before = issues.length;
  for (const file of PROPOSED_FILE_NAMES) {
    if (PROPOSED_FILES[file].required && files[file] === undefined) {
      issues.push(issue("missing_file", `${file} is required in every proposed component (${PROPOSED_FILES[file].about})`, { file: path(file) }));
    }
  }
  const tsx = files["component.tsx"];
  const jsonText = files["component.json"];
  if (tsx === undefined || jsonText === undefined) return null;
  const json = parseJson(jsonText, path("component.json"));
  if (!json.ok) {
    issues.push(json.issue);
    return null;
  }
  const shape = parseWith(proposedJsonShape, json.value, "invalid_proposed", { file: path("component.json") });
  if (!shape.ok) {
    issues.push(...shape.issues);
    return null;
  }
  if (issues.length > before) return null;
  const stored: ProposedFiles = { tsx, json: jsonText, css: files["component.css"] ?? null };
  return {
    name,
    hash: proposedHash(stored),
    files: stored,
    title: shape.data.title,
    description: shape.data.description,
    example: shape.data.example as ProposedDraft["example"],
  };
}

/** Reads a stored proposed component back. It passed this same parse when it was committed. */
export function readStoredProposed(name: ProposedName, files: ProposedFiles): ProposedDraft | null {
  const raw: Partial<Record<ProposedFileName, string>> = { "component.tsx": files.tsx, "component.json": files.json };
  if (files.css !== null) raw["component.css"] = files.css;
  return parseProposed(name, raw, []);
}

export function proposedFile(name: ProposedName, key: keyof ProposedFiles): string {
  const file = PROPOSED_FILE_NAMES.find((f) => PROPOSED_FILES[f].key === key) ?? "component.tsx";
  return `proposed/${name}/${file}`;
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
  return path === MANIFEST || IGNORED_ON_COMMIT.has(path) || path.startsWith("slots/") || path.startsWith("proposed/") || path.startsWith(SYSTEM_DIR);
}

/** What a session's design system adds to its working copy: a catalog to read, and the stories that show each component in use. */
export type SystemDocs = { readonly name: string; readonly catalog: string; readonly storyFiles: Readonly<Record<string, string>> };

export function emitWorkingCopy(session: SessionId, iteration: IterationContents | null, system: SystemDocs | null = null): FileMap {
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
    [GUIDE]: guide(session, system),
    [MANIFEST]: JSON.stringify(manifest, null, 2) + "\n",
  };
  for (const block of iteration?.blocks ?? []) {
    for (const name of BLOCK_FILE_NAMES) {
      const text = block.files[BLOCK_FILES[name].key];
      if (text !== null) files[`slots/${block.id}/${name}`] = text;
    }
  }
  for (const p of iteration?.proposed ?? []) {
    for (const name of PROPOSED_FILE_NAMES) {
      const text = p.files[PROPOSED_FILES[name].key];
      if (text !== null) files[`proposed/${p.name}/${name}`] = text;
    }
  }
  if (system !== null) {
    files[`${SYSTEM_DIR}CATALOG.md`] = system.catalog;
    for (const [path, text] of Object.entries(system.storyFiles)) files[`${SYSTEM_DIR}stories/${path}`] = text;
  }
  return files;
}

function fieldList(shape: Record<string, z.ZodType>): string {
  return Object.entries(shape)
    .filter(([key]) => key !== "type")
    .map(([key, schema]) => (schema.safeParse(undefined).success ? `${key}?` : key))
    .join(", ");
}

function systemGuide(system: SystemDocs): string[] {
  return [
    `## Design system: ${system.name}`,
    "",
    "This session builds only with its design system, so the design can be built from the real library. `system/CATALOG.md` lists every component with its props and stories, and `system/stories/` holds the stories that show each one in use. Both are regenerated on pull and ignored on commit.",
    "",
    '- A block imports components from `"kit"` (`import { Card, Button, Stack, Text } from "kit"`) and composes them. It writes no HTML tags, no `className` or `style` props, and no `block.css`; commit refuses each one.',
    "- Lay out with the kit's `Stack`, `Grid` and `Box`, and write text with `Text` and `Heading`. Their spacing and size props take steps on the system's scales.",
    '- When the kit has nothing that fits, write a **proposed component** in `proposed/<Name>/` and import it in a block as `import ChoreList from "proposed/ChoreList"`. Rob sees it labelled "not in system", and can promote it into the library.',
    ...PROPOSED_FILE_NAMES.map((name) => `  - \`${name}\` (${PROPOSED_FILES[name].required ? "required" : "optional"}): ${PROPOSED_FILES[name].about}.`),
    "  - It may write HTML, using only classes the kit's CSS defines and, in `component.css`, only the token variables and values the kit uses. Commit names any value off the kit's scales. No `style` prop.",
    "  - Prefer the kit's components inside it. Its `example` props must render it, as a story would.",
    "",
  ];
}

function guide(session: SessionId, system: SystemDocs | null = null): string {
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
    ...(system === null ? [] : systemGuide(system)),
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
