import type { ReactNode } from "react";
import { Code } from "@/components/ui/kbd";
import { parseMarkdown, type Inline, type MarkdownBlock } from "./markdownSubset";

function InlineNodes({ nodes }: { nodes: readonly Inline[] }): ReactNode {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case "text":
        return n.text;
      case "strong":
        return (
          <strong key={i} className="font-semibold text-fg">
            <InlineNodes nodes={n.children} />
          </strong>
        );
      case "em":
        return (
          <em key={i}>
            <InlineNodes nodes={n.children} />
          </em>
        );
      case "code":
        return (
          <Code key={i}>{n.text}</Code>
        );
    }
  });
}

/** Renders the about.md subset as React elements, so block text can never become markup. */
export function Markdown({ source, blocks = parseMarkdown(source) }: { source: string; blocks?: readonly MarkdownBlock[] }) {
  return blocks.map((block, i) =>
    block.kind === "paragraph" ? (
      <p key={i}>
        <InlineNodes nodes={block.inline} />
      </p>
    ) : (
      <ul key={i} className="grid list-disc gap-0.5 pl-4">
        {block.items.map((item, j) => (
          <li key={j}>
            <InlineNodes nodes={item} />
          </li>
        ))}
      </ul>
    ),
  );
}
