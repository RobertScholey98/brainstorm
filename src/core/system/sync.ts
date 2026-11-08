import { createHash } from "node:crypto";
import type { Checker } from "../check";
import { issue, type Issue } from "../types";
import { buildSystem } from "./build";
import { analyzeKitCss, flattenCss, htmlClasses, parseCss, readsColorToken } from "./css";
import { isTier, type ArgType, type CatalogEntry, type KitExportInfo, type StoryInfo, type SystemManifest, type Tier } from "./model";
import { sourceFile, type SystemSource } from "./source";

export type SyncedVersion = {
  readonly hash: string;
  readonly bundle: string;
  readonly css: string;
  readonly manifest: SystemManifest;
  readonly warnings: readonly Issue[];
  /** Every file the build read, for the fingerprint that tells auto-sync something changed (ADR 008). */
  readonly inputs: readonly string[];
};

export type SyncResult = { readonly ok: true; readonly value: SyncedVersion } | { readonly ok: false; readonly issues: readonly Issue[] };

/**
 * Builds a version of a design system from its source and checks it (ADR 007): the kit bundles, its CSS compiles, it
 * loads in the check sandbox, and every story renders there. A story that fails is reported and left out, so one broken
 * example doesn't keep a whole library away; a kit that can't build or load fails the sync.
 */
export async function syncSystem(source: SystemSource, checker: Checker): Promise<SyncResult> {
  const built = await buildSystem(source);
  if (!built.ok) return built;
  const { bundle, css, storyFiles } = built.value;
  const hash = createHash("sha256").update(bundle).update("\0").update(css).digest("hex");

  const inspected = await checker.inspectKit({ hash, bundle });
  if (inspected.kind !== "inspected") {
    const message =
      inspected.kind === "timeout"
        ? "the kit didn't finish loading and rendering its stories in time"
        : inspected.kind === "crashed"
          ? `the check crashed loading the kit: ${inspected.message}`
          : `the kit threw while loading: ${inspected.error.message}`;
    return { ok: false, issues: [issue("kit_load_failed", message, { file: sourceFile(source) })] };
  }

  const warnings: Issue[] = [...built.value.warnings];
  const styles = analyzeKitCss(css);
  const rules = flattenCss(parseCss(css));

  for (const f of inspected.failed) warnings.push(issue("story_failed", `the story file threw while loading: ${f.message}`, { file: f.file }));
  const stories: StoryInfo[] = inspected.stories.map((s) => ({
    id: s.id,
    file: s.file,
    exportName: s.exportName,
    title: s.title,
    name: s.name,
    component: s.component,
    args: safeJson(s.args),
    error: s.error,
    tags: s.tags,
    argTypes: safeJson(s.argTypes) as Record<string, ArgType>,
    htmlHash: s.html === null ? null : createHash("sha256").update(s.html).digest("hex").slice(0, 16),
  }));
  for (const s of inspected.stories) {
    if (s.error !== null) warnings.push(issue("story_failed", `"${s.title} / ${s.name}" didn't render: ${s.error}`, { file: s.file }));
    else if (s.html !== null && s.html.trim() === "") warnings.push(issue("story_empty", `"${s.title} / ${s.name}" renders nothing`, { file: s.file }));
  }

  const frame = source.frame !== null && inspected.exports.some((e) => e.name === source.frame) ? source.frame : null;
  if (source.frame !== null && frame === null) {
    warnings.push(issue("frame_missing", `the frame component "${source.frame}" isn't exported by the kit, so blocks render without it`, { file: sourceFile(source) }));
  }

  if (inspected.duplicates.length > 0) {
    warnings.push(issue("duplicate_export", `more than one tier file exports ${list(inspected.duplicates, 8)}; the kit keeps the first`, { file: sourceFile(source) }));
  }
  const tiers = Object.fromEntries(Object.entries(inspected.tiers).filter((e): e is [string, Tier] => isTier(e[1])));
  const catalog = catalogOf(inspected.exports, stories, inspected.generated, tiers);
  const htmlById = new Map(inspected.stories.map((s) => [s.id, s.html]));
  const unthemed = catalog.filter((entry) => {
    const htmls = entry.stories.map((id) => htmlById.get(id)).filter((h): h is string => typeof h === "string");
    return htmls.length > 0 && !readsColorToken(htmls.flatMap(htmlClasses), rules) && !htmls.some((h) => /style="[^"]*var\(--/.test(h));
  });
  for (const entry of unthemed) {
    warnings.push(issue("theme_ignored", `${entry.name}'s stories render nothing that reads a colour token, so a theme change reaches it only through the colour it inherits; check it in the gallery under each theme`, { file: sourceFile(source) }));
  }

  const storyless = catalog.filter((e) => e.stories.length === 0 && !e.generated).map((e) => e.name);
  if (storyless.length > 0) {
    warnings.push(
      issue("no_story", `${storyless.length} component${storyless.length === 1 ? " has" : "s have"} no story: ${list(storyless, 12)}`, {
        file: source.entry,
      }),
    );
  }
  if (!styles.theme.tokens.some((t) => t.kind === "color" && t.origin === "system")) {
    warnings.push(issue("no_tokens", "the stylesheet defines no colour tokens, so a theme has nothing to change", { file: source.css ?? sourceFile(source) }));
  }
  if (styles.offScale.length > 0) {
    const shown = styles.offScale.map((o) => `${o.className} (${o.property} ${o.value})`);
    warnings.push(issue("off_scale", `the kit writes ${shown.length} value${shown.length === 1 ? "" : "s"} off its token scales: ${list(shown, 8)}`, { file: source.css }));
  }

  return {
    ok: true,
    value: {
      hash,
      bundle,
      css,
      manifest: {
        exports: inspected.exports,
        generated: inspected.generated,
        frame,
        catalog,
        stories,
        storyFiles,
        styles: { axes: styles.theme.axes, tokens: styles.theme.tokens, classes: styles.classes, measured: styles.measured, surface: styles.surface },
      },
      warnings,
      inputs: built.value.inputs,
    },
  };
}

const list = (items: readonly string[], max: number) => (items.length <= max ? items.join(", ") : `${items.slice(0, max).join(", ")} and ${items.length - max} more`);

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/**
 * One entry per component a story is about, named by the export the story's meta names (else its title's last part),
 * with the exports that share its name as parts: Card takes CardHeader and CardTitle. Components no story is about get
 * entries of their own.
 */
export function catalogOf(
  exports: readonly KitExportInfo[],
  stories: readonly StoryInfo[],
  generated: readonly string[],
  tiers: Readonly<Record<string, Tier>> = {},
): CatalogEntry[] {
  const components = exports.filter((e) => e.type === "component").map((e) => e.name);
  const exported = new Set(exports.map((e) => e.name));
  const heads = new Map<string, string[]>();
  for (const s of stories) {
    const fromTitle = (s.title.split("/").at(-1) ?? s.title).replace(/[^A-Za-z0-9]/g, "");
    const head = s.component ?? (exported.has(fromTitle) ? fromTitle : (s.title.split("/").at(-1) ?? s.title));
    heads.set(head, [...(heads.get(head) ?? []), s.id]);
  }
  const headNames = [...heads.keys()].sort((a, b) => b.length - a.length);
  const owner = (name: string) => headNames.find((h) => name !== h && name.startsWith(h) && /^[A-Z]/.test(name.slice(h.length)));
  const parts = new Map<string, string[]>();
  const loose: string[] = [];
  for (const name of components) {
    if (heads.has(name)) continue;
    const o = owner(name);
    if (o === undefined) loose.push(name);
    else parts.set(o, [...(parts.get(o) ?? []), name]);
  }
  const looseHeads = loose.filter((name) => !loose.some((other) => other !== name && name.startsWith(other) && /^[A-Z]/.test(name.slice(other.length))));
  const looseParts = new Map(looseHeads.map((h) => [h, loose.filter((n) => n !== h && n.startsWith(h) && /^[A-Z]/.test(n.slice(h.length)))]));
  const generatedSet = new Set(generated);
  const byId = new Map(stories.map((s) => [s.id, s]));
  // A tier tag on any of its stories wins, then the tier of the file that exports it, else a primitive (ADR 008).
  const tierOf = (name: string, ids: readonly string[]): Tier =>
    ids.flatMap((id) => byId.get(id)?.tags ?? []).find(isTier) ?? tiers[name] ?? "primitive";
  return [
    ...[...heads].map(([name, ids]) => ({ name, parts: parts.get(name) ?? [], stories: ids, generated: false, tier: tierOf(name, ids) })),
    ...looseHeads.map((name) => ({ name, parts: looseParts.get(name) ?? [], stories: [], generated: generatedSet.has(name), tier: tierOf(name, []) })),
  ].sort((a, b) => Number(a.generated) - Number(b.generated) || a.name.localeCompare(b.name));
}
