/**
 * The markdown subset an agent writes a brief in: paragraphs, `-` lists, bold, italic and inline code. Home shows a
 * brief as plain text, so only `markdownText` leaves this file, and nothing is ever parsed as HTML.
 */
type Inline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong"; readonly children: readonly Inline[] }
  | { readonly kind: "em"; readonly children: readonly Inline[] }
  | { readonly kind: "code"; readonly text: string };

type MarkdownBlock =
  | { readonly kind: "paragraph"; readonly inline: readonly Inline[] }
  | { readonly kind: "list"; readonly items: readonly (readonly Inline[])[] };

const LIST_ITEM = /^\s*-\s+/;

function parseMarkdown(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let items: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", inline: parseInline(paragraph.join(" ")) });
    if (items.length > 0) blocks.push({ kind: "list", items: items.map(parseInline) });
    paragraph = [];
    items = [];
  };
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line === "") {
      flush();
    } else if (LIST_ITEM.test(raw)) {
      if (paragraph.length > 0) flush();
      items.push(raw.replace(LIST_ITEM, "").trim());
    } else if (items.length > 0) {
      const last = items.length - 1;
      items[last] = `${items[last]} ${line}`;
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** The index of the delimiter that closes one opened at `from`, or -1. A closer can't follow a space. */
function closer(text: string, delimiter: string, from: number): number {
  for (let end = text.indexOf(delimiter, from); end !== -1; end = text.indexOf(delimiter, end + 1)) {
    if (end > from && text[end - 1] !== " " && (delimiter !== "_" || !isWordChar(text[end + 1]))) return end;
  }
  return -1;
}

function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let plain = "";
  const push = (node: Inline) => {
    if (plain !== "") out.push({ kind: "text", text: plain });
    plain = "";
    out.push(node);
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        push({ kind: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    const delimiter = text.startsWith("**", i) ? "**" : c === "*" || (c === "_" && !isWordChar(text[i - 1])) ? c : null;
    if (delimiter !== null && text[i + delimiter.length] !== " ") {
      const start = i + delimiter.length;
      const end = closer(text, delimiter, start);
      if (end !== -1) {
        const children = parseInline(text.slice(start, end));
        push(delimiter === "**" ? { kind: "strong", children } : { kind: "em", children });
        i = end + delimiter.length;
        continue;
      }
    }
    plain += c;
    i += 1;
  }
  if (plain !== "") out.push({ kind: "text", text: plain });
  return out;
}

const inlineText = (nodes: readonly Inline[]): string =>
  nodes.map((n) => (n.kind === "text" || n.kind === "code" ? n.text : inlineText(n.children))).join("");

/** The same text with the markup removed, for places that take only a string, such as a tooltip. */
export function markdownText(source: string): string {
  return parseMarkdown(source)
    .map((b) => (b.kind === "paragraph" ? inlineText(b.inline) : b.items.map((item) => `- ${inlineText(item)}`).join("\n")))
    .join("\n\n");
}
