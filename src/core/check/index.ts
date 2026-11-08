import { availableParallelism } from "node:os";
import { builtFile } from "../packageRoot";
import { classifyOverrides, resolveProps } from "../props";
import { issue, isError, parsePartName, type BlockDraft, type BlockId, type ContentHash, type Issue, type NonEmpty, type Override, type PartName } from "../types";
import { createPool } from "./pool";
import { ALLOWED_IMPORTS, CHECK_TIMEOUT_MS } from "./rules";
import type { InspectOutcome, KitRef, ThrownError, WorkerJob, WorkerOutcome } from "./worker";

export type CheckResult =
  | { readonly kind: "ok"; readonly compiled: string; readonly parts: readonly PartName[]; readonly html: string; readonly warnings: readonly Issue[] }
  | { readonly kind: "failed"; readonly issues: readonly Issue[] };

/**
 * What a block may reach. A session with no design system checks against React alone; one with a system adds its kit
 * and the session's proposed components (ADR 007).
 */
export type CheckEnv = {
  readonly kit: KitRef | null;
  /** Proposed components' sources, by import specifier (`proposed/ChoreList`). */
  readonly proposed: Readonly<Record<string, string>>;
  readonly allowed: readonly string[];
};

export const PLAIN_ENV: CheckEnv = { kit: null, proposed: {}, allowed: ALLOWED_IMPORTS };

/** A kit loads and renders every story in one job, so it gets its own worker with a longer limit. */
export const INSPECT_TIMEOUT_MS = 120_000;

export type InspectResult = InspectOutcome | { readonly kind: "timeout" } | { readonly kind: "crashed"; readonly message: string };

export type Checker = {
  /** One result per distinct content hash. Issues name the first block with that hash, or the block whose overrides failed. */
  checkBlocks(
    blocks: readonly BlockDraft[],
    overridesByBlock: ReadonlyMap<BlockId, readonly Override[]>,
    env?: CheckEnv,
  ): Promise<Map<ContentHash, CheckResult>>;
  /** Compiles one source and renders its default export with `props`: a proposed component and its example. */
  checkSource(input: { source: string; file: string; props: Readonly<Record<string, unknown>>; env: CheckEnv }): Promise<CheckResult>;
  inspectKit(kit: KitRef): Promise<InspectResult>;
  close(): Promise<void>;
};

type CheckOutcome = Extract<WorkerOutcome, { kind: "compile_error" | "disallowed_imports" | "load_error" | "no_default_export" | "rendered" }>;

type Probe = { readonly file: string; readonly label: string; readonly props: unknown };

const BROWSER_GLOBALS = /^(window|document|navigator|location|localStorage|sessionStorage) is not defined$/;

export function createChecker(options: { size?: number; timeoutMs?: number } = {}): Checker {
  const timeoutMs = options.timeoutMs ?? CHECK_TIMEOUT_MS;
  const worker = () => builtFile("check/worker.cjs");
  const pool = createPool<WorkerJob, WorkerOutcome>({
    file: worker(),
    size: options.size ?? Math.max(1, Math.min(4, availableParallelism() - 1)),
    timeoutMs,
  });
  let inspectPool: ReturnType<typeof createPool<WorkerJob, WorkerOutcome>> | null = null;

  async function run(source: string, primary: string, probes: readonly Probe[], env: CheckEnv): Promise<CheckResult> {
    const name = componentName(source);
    const fail = (...issues: Issue[]): CheckResult => ({ kind: "failed", issues });
    const outcome = await pool.run({
      kind: "check",
      source,
      renders: probes.map((p) => JSON.stringify(p.props)),
      allowed: env.allowed,
      kit: env.kit,
      proposed: env.proposed,
    });
    if (outcome.kind === "timeout") {
      return fail(
        issue("render_timeout", `${name} did not finish loading and rendering within ${timeoutMs / 1000} s; look for a loop that never ends`, {
          file: primary,
        }),
      );
    }
    if (outcome.kind === "crashed") return fail(issue("render_error", `${name} crashed the check: ${outcome.message}`, { file: primary }));
    const result = outcome.result as CheckOutcome;
    switch (result.kind) {
      case "compile_error":
        return fail(issue("compile_error", result.message, { file: primary, loc: { line: result.line, column: result.column } }));
      case "disallowed_imports":
        return fail(
          ...result.imports.map((spec) =>
            issue("disallowed_import", `imports "${spec}"; this file may import only ${importList(env.allowed)}`, {
              file: primary,
              loc: locate(source, spec),
            }),
          ),
        );
      case "load_error":
        return fail(thrownIssue(result.error, name, "while loading the module", primary));
      case "no_default_export":
        return fail(issue("no_default_export", `${primary.split("/").at(-1)} must default-export a function component; found ${result.found}`, { file: primary }));
      case "rendered": {
        const issues: Issue[] = [];
        const duplicates = new Set<string>();
        let parts: PartName[] = [];
        let html = "";
        result.renders.forEach((render, i) => {
          const probe = probes[i];
          if (probe === undefined) return;
          if (!render.ok) {
            issues.push(thrownIssue(render.error, name, probe.label, probe.file));
            return;
          }
          const found = dataParts(render.html);
          if (i === 0) {
            parts = [...new Set(found)];
            html = render.html;
          }
          found.filter((p, j) => found.indexOf(p) !== j).forEach((p) => duplicates.add(p));
        });
        const warnings = [...duplicates].map((p) =>
          issue("duplicate_part", `data-part "${p}" appears more than once in one render; pins need each part to be unique`, { file: primary }),
        );
        return issues.some(isError) ? fail(...issues, ...warnings) : { kind: "ok" as const, compiled: result.compiled, parts, html, warnings };
      }
    }
  }

  async function checkHash(group: NonEmpty<BlockDraft>, overridesByBlock: ReadonlyMap<BlockId, readonly Override[]>, env: CheckEnv) {
    const [first] = group;
    const file = (block: BlockDraft) => `slots/${block.id}/block.tsx`;
    const probes: Probe[] = [
      { file: file(first), label: "with default props", props: resolveProps(first.props, []) },
      ...group.flatMap((block) => {
        const { applicable } = classifyOverrides(new Map([[block.id, block.props]]), overridesByBlock.get(block.id) ?? []);
        if (applicable.length === 0) return [];
        const label = `with Rob's overrides on ${block.id} (${applicable.map((o) => o.prop).join(", ")})`;
        return [{ file: file(block), label, props: resolveProps(block.props, applicable) }];
      }),
    ];
    return run(first.files.tsx, file(first), probes, env);
  }

  return {
    async checkBlocks(blocks, overridesByBlock, env = PLAIN_ENV) {
      const groups = new Map<ContentHash, NonEmpty<BlockDraft>>();
      for (const block of blocks) {
        const group = groups.get(block.hash);
        groups.set(block.hash, group === undefined ? [block] : [...group, block]);
      }
      const entries = await Promise.all(
        [...groups].map(async ([hash, group]) => [hash, await checkHash(group, overridesByBlock, env)] as const),
      );
      return new Map(entries);
    },
    checkSource({ source, file, props, env }) {
      return run(source, file, [{ file, label: "with its example props", props }], env);
    },
    async inspectKit(kit) {
      inspectPool ??= createPool<WorkerJob, WorkerOutcome>({ file: worker(), size: 1, timeoutMs: INSPECT_TIMEOUT_MS });
      const outcome = await inspectPool.run({ kind: "inspect", kit });
      return outcome.kind === "done" ? (outcome.result as InspectOutcome) : outcome;
    },
    async close() {
      await Promise.all([pool.close(), inspectPool?.close()]);
    },
  };
}

const importList = (allowed: readonly string[]) =>
  allowed
    .filter((a) => a !== "react/jsx-runtime")
    .map((a) => `"${a}"`)
    .join(", ");

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
