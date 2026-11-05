import { availableParallelism } from "node:os";
import { builtFile } from "../packageRoot";
import { classifyOverrides, resolveProps } from "../props";
import { issue, isError, parsePartName, type BlockDraft, type BlockId, type ContentHash, type Issue, type NonEmpty, type Override, type PartName } from "../types";
import { createPool } from "./pool";
import { ALLOWED_IMPORTS, CHECK_TIMEOUT_MS } from "./rules";
import type { CheckJob, CheckOutcome, ThrownError } from "./worker";

export type CheckResult =
  | { readonly kind: "ok"; readonly compiled: string; readonly parts: readonly PartName[]; readonly warnings: readonly Issue[] }
  | { readonly kind: "failed"; readonly issues: readonly Issue[] };

export type Checker = {
  /** One result per distinct content hash. Issues name the first block with that hash, or the block whose overrides failed. */
  checkBlocks(
    blocks: readonly BlockDraft[],
    overridesByBlock: ReadonlyMap<BlockId, readonly Override[]>,
  ): Promise<Map<ContentHash, CheckResult>>;
  close(): Promise<void>;
};

const BROWSER_GLOBALS = /^(window|document|navigator|location|localStorage|sessionStorage) is not defined$/;

export function createChecker(options: { size?: number; timeoutMs?: number } = {}): Checker {
  const timeoutMs = options.timeoutMs ?? CHECK_TIMEOUT_MS;
  const pool = createPool<CheckJob, CheckOutcome>({
    file: builtFile("check/worker.cjs"),
    size: options.size ?? Math.max(1, Math.min(4, availableParallelism() - 1)),
    timeoutMs,
  });

  async function checkHash(group: NonEmpty<BlockDraft>, overridesByBlock: ReadonlyMap<BlockId, readonly Override[]>) {
    const [first] = group;
    const file = (block: BlockDraft) => `slots/${block.id}/block.tsx`;
    const name = componentName(first.files.tsx);
    const probes = [
      { block: first, label: "with default props", props: resolveProps(first.props, []) },
      ...group.flatMap((block) => {
        const { applicable } = classifyOverrides(new Map([[block.id, block.props]]), overridesByBlock.get(block.id) ?? []);
        if (applicable.length === 0) return [];
        const label = `with Rob's overrides on ${block.id} (${applicable.map((o) => o.prop).join(", ")})`;
        return [{ block, label, props: resolveProps(block.props, applicable) }];
      }),
    ];

    const outcome = await pool.run({ source: first.files.tsx, renders: probes.map((p) => JSON.stringify(p.props)) });
    const fail = (...issues: Issue[]): CheckResult => ({ kind: "failed", issues });
    if (outcome.kind === "timeout") {
      return fail(
        issue("render_timeout", `${name} did not finish loading and rendering within ${timeoutMs / 1000} s; look for a loop that never ends`, {
          file: file(first),
        }),
      );
    }
    if (outcome.kind === "crashed") {
      return fail(issue("render_error", `${name} crashed the check: ${outcome.message}`, { file: file(first) }));
    }
    const result = outcome.result;
    switch (result.kind) {
      case "compile_error":
        return fail(issue("compile_error", result.message, { file: file(first), loc: { line: result.line, column: result.column } }));
      case "disallowed_imports":
        return fail(
          ...result.imports.map((spec) =>
            issue("disallowed_import", `imports "${spec}"; blocks may import only ${ALLOWED_IMPORTS.join(" and ")}`, {
              file: file(first),
              loc: locate(first.files.tsx, spec),
            }),
          ),
        );
      case "load_error":
        return fail(thrownIssue(result.error, name, "while loading the module", file(first)));
      case "no_default_export":
        return fail(
          issue("no_default_export", `block.tsx must default-export a function component; found ${result.found}`, { file: file(first) }),
        );
      case "rendered": {
        const issues: Issue[] = [];
        const duplicates = new Set<string>();
        let parts: PartName[] = [];
        result.renders.forEach((render, i) => {
          const probe = probes[i];
          if (probe === undefined) return;
          if (!render.ok) {
            issues.push(thrownIssue(render.error, name, probe.label, file(probe.block)));
            return;
          }
          const found = dataParts(render.html);
          if (i === 0) parts = [...new Set(found)];
          found.filter((p, j) => found.indexOf(p) !== j).forEach((p) => duplicates.add(p));
        });
        const warnings = [...duplicates].map((p) =>
          issue("duplicate_part", `data-part "${p}" appears more than once in one render; pins need each part to be unique`, {
            file: file(first),
          }),
        );
        return issues.some(isError) ? fail(...issues, ...warnings) : { kind: "ok" as const, compiled: result.compiled, parts, warnings };
      }
    }
  }

  return {
    async checkBlocks(blocks, overridesByBlock) {
      const groups = new Map<ContentHash, NonEmpty<BlockDraft>>();
      for (const block of blocks) {
        const group = groups.get(block.hash);
        groups.set(block.hash, group === undefined ? [block] : [...group, block]);
      }
      const entries = await Promise.all(
        [...groups].map(async ([hash, group]) => [hash, await checkHash(group, overridesByBlock)] as const),
      );
      return new Map(entries);
    },
    close: () => pool.close(),
  };
}

function thrownIssue(error: ThrownError, component: string, when: string, file: string): Issue {
  const global = error.name === "ReferenceError" ? BROWSER_GLOBALS.exec(error.message)?.[1] : undefined;
  return global !== undefined
    ? issue("browser_global", `${component} reads \`${global}\` ${when}; there is no ${global} during render, so move it into an effect`, {
        file,
      })
    : issue("render_error", `${component} threw ${when}: ${error.message}`, { file });
}

function componentName(source: string): string {
  const match = /export\s+default\s+(?:function\s+)?([A-Za-z_$][\w$]*)/.exec(source);
  return match?.[1] !== undefined && match[1] !== "function" ? match[1] : "The default export";
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#x27;": "'", "&lt;": "<", "&gt;": ">" };

function dataParts(html: string): PartName[] {
  return [...html.matchAll(/\sdata-part="([^"]*)"/g)].flatMap((m) => {
    const part = parsePartName((m[1] ?? "").replace(/&(amp|quot|#x27|lt|gt);/g, (e) => ENTITIES[e] ?? e));
    return part === null ? [] : [part];
  });
}

function locate(source: string, specifier: string): { line: number; column: number } | null {
  const index = [`"${specifier}"`, `'${specifier}'`].map((q) => source.indexOf(q)).find((i) => i >= 0);
  if (index === undefined) return null;
  const before = source.slice(0, index).split("\n");
  return { line: before.length, column: (before.at(-1)?.length ?? 0) + 1 };
}
