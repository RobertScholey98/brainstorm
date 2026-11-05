import type { ReactNode } from "react";
import { parseMarkdown, type Inline } from "./markdownSubset";

function InlineNodes({ nodes }: { nodes: readonly Inline[] }): ReactNode {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case "text":
        return n.text;
      case "strong":
        return (
          <strong key={i} className="font-semibold text-foreground">
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
          <code key={i} className="rounded-[3px] bg-muted px-1 font-mono text-[11px]">
            {n.text}
          </code>
        );
    }
  });
}

/** Renders the about.md subset as React elements, so block text can never become markup. */
export function Markdown({ source }: { source: string }) {
  return parseMarkdown(source).map((block, i) =>
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
