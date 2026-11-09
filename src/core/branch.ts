import type { AppearanceValue, PropName } from "./types";

/** `block.json` with `settings` as its appearance defaults. Only the defaults change, so the schema stays the agent's. */
export function bakeDefaults(json: string, settings: readonly { readonly prop: PropName; readonly value: AppearanceValue }[]): string {
  if (settings.length === 0) return json;
  const block = JSON.parse(json) as { props: { appearance: Record<string, { default: unknown }> } };
  for (const s of settings) {
    const spec = block.props.appearance[s.prop];
    if (spec !== undefined) spec.default = s.value;
  }
  return `${JSON.stringify(block, null, 2)}\n`;
}

const TITLE_MAX = 48;

/** A branch is named for what Rob asked of it: the instruction's first clause, cut at a word near 48 characters. */
export function branchTitle(instruction: string): string {
  const line = instruction.trim().split(/\r?\n/)[0] ?? "";
  const clause = line.split(/[,;:.!?]\s|\s[-–—]\s/)[0]?.trim() ?? "";
  const text = clause.length >= 3 ? clause : line;
  if (text.length <= TITLE_MAX) return text;
  const cut = text.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > 20 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
