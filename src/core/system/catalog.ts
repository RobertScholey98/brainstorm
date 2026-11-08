import { FAMILY_LABEL, type Family } from "./css";
import type { SystemManifest } from "./model";
import { PRIMITIVE_DOCS, PRIMITIVE_NAMES, SPACE_DOC } from "./primitives";

const ARGS_MAX = 240;

const short = (value: unknown): string => {
  const text = JSON.stringify(value) ?? "{}";
  return text.length <= ARGS_MAX ? text : `${text.slice(0, ARGS_MAX)}…`;
};

/**
 * What an agent reads to build with a design system (ADR 007): every component with the stories that show it in use,
 * the layout and text primitives, and the values a proposed component may use. Written to `system/CATALOG.md` on pull.
 */
export function catalogMarkdown(name: string, n: number, manifest: SystemManifest): string {
  const storyById = new Map(manifest.stories.map((s) => [s.id, s]));
  const generated = new Set(manifest.generated);
  const lines: string[] = [
    `# ${name}, version ${n}`,
    "",
    'Import every component from `"kit"`: `import { Button, Card, Stack, Text } from "kit"`. Stories are in `system/stories/`, at the path each entry names.',
    "",
    "## Layout and text",
    "",
    SPACE_DOC,
    "",
    ...PRIMITIVE_NAMES.map((p) => (generated.has(p) ? `- \`${p}\` (Brainstorm's): ${PRIMITIVE_DOCS[p]}` : `- \`${p}\`: the library's own; see its stories below`)),
    "",
    "## Components",
    "",
  ];
  for (const entry of manifest.catalog.filter((e) => !e.generated)) {
    lines.push(`### ${entry.name}`);
    if (entry.parts.length > 0) lines.push(`Parts: ${entry.parts.map((p) => `\`${p}\``).join(", ")}`);
    for (const id of entry.stories) {
      const s = storyById.get(id);
      if (s === undefined) continue;
      const broken = s.error === null ? "" : " (doesn't render in Brainstorm)";
      lines.push(`- ${s.name}${broken}: \`system/stories/${s.file}\` export \`${s.exportName}\`, args ${short(s.args)}`);
    }
    if (entry.stories.length === 0) lines.push("- No story; read the library's source for its props.");
    lines.push("");
  }
  const others = manifest.exports.filter((e) => e.type !== "component").map((e) => e.name);
  if (others.length > 0) lines.push("## Other exports", "", others.map((o) => `\`${o}\``).join(", "), "");
  const { axes, tokens, measured } = manifest.styles;
  lines.push("## Theme", "");
  if (axes.length > 0) {
    lines.push(...axes.map((a) => `- \`${a.attribute}\`: ${a.values.join(", ")}${a.default === null ? "" : ` (default ${a.default})`}`), "");
  }
  const systemTokens = tokens.filter((t) => t.origin === "system").map((t) => `\`${t.name}\``);
  if (systemTokens.length > 0) lines.push(`Tokens: ${systemTokens.join(", ")}`, "");
  lines.push(
    "## Values a proposed component may use",
    "",
    "`component.css` reads the tokens above with `var()` and otherwise uses only the values the kit itself uses:",
    "",
  );
  for (const [family, values] of Object.entries(measured) as [Family, readonly string[]][]) {
    if (family === "color" || values.length === 0) continue;
    lines.push(`- ${FAMILY_LABEL[family]}: ${values.filter((v) => !v.startsWith("-")).join(", ")}`);
  }
  lines.push("- colours: read a colour token, such as `var(--primary)`", "");
  return lines.join("\n");
}
