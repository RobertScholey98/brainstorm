import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { Brainstorm } from "../src/core/brainstorm";
import { createChecker } from "../src/core/check";
import type { BlockId, FeedbackId, FileMap, IterationN, PartName, PropName, Result, SessionId, ThreadId } from "../src/core/types";
import { FakeBridge } from "./fakeBridge";
import { wheelProps } from "./fixtures";

const checker = createChecker({ size: 2 });
afterAll(() => checker.close());

const AT = "2026-11-05T10:00:00.000Z";
const T1 = "11111111-1111-1111-1111-111111111111" as ThreadId;
const T2 = "22222222-2222-2222-2222-222222222222" as ThreadId;
const T3 = "33333333-3333-3333-3333-333333333333" as ThreadId;
const S = "s_wheel01" as SessionId;
const NEON = "wheel/neon" as BlockId;
const SHEET = "result/sheet" as BlockId;

const neonTsx = `export default function Wheel({ people, accent }) {
  return (
    <div style={{ color: accent }}>
      {people.map((p) => <span key={p.name} data-part={\`slice-\${p.name}\`}>{p.name}</span>)}
      <button data-part="spin-button">Spin</button>
    </div>
  );
}
`;
const sheetTsx = `export default function Sheet({ headline }) {
  return <section data-part="sheet">{headline}</section>;
}
`;
const neonJson = JSON.stringify({ title: "Neon wheel", props: wheelProps });
const sheetJson = JSON.stringify({ title: "Result sheet", props: { appearance: { headline: { type: "text", label: "Headline", default: "Kai" } } } });

type BlockSpec = { tsx: string; json: string; controls?: string };

function copy(base: number | null, blocks: Record<string, BlockSpec> = {}): FileMap {
  const all: Record<string, BlockSpec> = { "wheel/neon": { tsx: neonTsx, json: neonJson }, "result/sheet": { tsx: sheetTsx, json: sheetJson }, ...blocks };
  const files: Record<string, string> = {
    "brainstorm.json": JSON.stringify({
      format: 1,
      session: S,
      base,
      slots: [
        { id: "wheel", title: "The wheel" },
        { id: "result", title: "Result" },
      ],
    }),
    "GUIDE.md": "ignored",
  };
  for (const [id, spec] of Object.entries(all)) {
    files[`slots/${id}/block.tsx`] = spec.tsx;
    files[`slots/${id}/block.json`] = spec.json;
    if (spec.controls !== undefined) files[`slots/${id}/controls.json`] = spec.controls;
  }
  return files;
}

const data = <T,>(result: Result<T>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
};

async function setup() {
  const dbPath = join(mkdtempSync(join(tmpdir(), "bs-service-")), "brainstorm.db");
  const bridge = new FakeBridge();
  bridge.add(T1, "proj-a", "Design thread");
  bridge.add(T2, "proj-a", "Takeover thread");
  bridge.add(T3, "proj-b", "Other project");
  const ids = ["s_wheel01", "s_onbrd02", "s_onbrd03"] as SessionId[];
  const open = () => Brainstorm.open({ dbPath, bridge, checker, now: () => AT, newSessionId: () => ids.shift() ?? ("s_spare99" as SessionId) });
  const service = await open();
  return { service, bridge, open };
}

async function withIteration() {
  const ctx = await setup();
  data(await ctx.service.newSession({ title: "Chore wheel", brief: "Pick who does chores", thread: T1, projectPath: "C:\\repo" }));
  data(await ctx.service.commit({ session: S, thread: T1, files: copy(null), addresses: [], note: "first cut" }));
  return ctx;
}

const FRAME = { width: 390, height: null };
const SLOTS = [
  { id: "wheel", title: "The wheel", frame: FRAME },
  { id: "result", title: "Result", frame: FRAME },
];

describe("commit", () => {
  test("creates a session attached to the caller, then an iteration that pull round-trips", async () => {
    const { service } = await setup();
    expect(await service.newSession({ title: "Chore wheel", brief: "Pick who does chores", thread: T1, projectPath: "C:\\repo" })).toEqual({
      ok: true,
      data: {
        session: { id: S, projectId: "proj-a", title: "Chore wheel", brief: "Pick who does chores", createdAt: AT },
        attachment: { session: S, threadId: T1, attachedAt: AT, lostAt: null },
      },
    });
    expect(await service.commit({ session: S, thread: T1, files: copy(null), addresses: [], note: "first cut" })).toEqual({
      ok: true,
      data: {
        created: true,
        warnings: [],
        iteration: { n: 1, threadId: T1, note: "first cut", createdAt: AT, slots: SLOTS, blocks: [SHEET, NEON], changed: [SHEET, NEON] },
      },
    });
    const pulled = data(await service.pull(S));
    expect(Object.keys(pulled).sort()).toEqual([
      ".gitignore",
      "GUIDE.md",
      "brainstorm.json",
      "slots/result/sheet/block.json",
      "slots/result/sheet/block.tsx",
      "slots/wheel/neon/block.json",
      "slots/wheel/neon/block.tsx",
    ]);
    expect(pulled["slots/wheel/neon/block.tsx"]).toBe(neonTsx);
    expect(JSON.parse(pulled["brainstorm.json"] ?? "")).toEqual({
      format: 1,
      session: S,
      base: 1,
      slots: [
        { id: "wheel", title: "The wheel", frame: { width: 390 } },
        { id: "result", title: "Result", frame: { width: 390 } },
      ],
    });
  });

  test("an unchanged commit is an idempotent replay, even when base was never rewritten", async () => {
    const { service } = await withIteration();
    for (const base of [1, null]) {
      expect(await service.commit({ session: S, thread: T1, files: copy(base), addresses: [], note: "again" })).toEqual({
        ok: true,
        data: {
          created: false,
          warnings: [],
          iteration: { n: 1, threadId: T1, note: "first cut", createdAt: AT, slots: SLOTS, blocks: [SHEET, NEON], changed: [SHEET, NEON] },
        },
      });
    }
  });

  test("a changed copy based on an older iteration is stale", async () => {
    const { service } = await withIteration();
    const edited = (headline: string) => ({ "result/sheet": { tsx: sheetTsx.replace("{headline}", headline), json: sheetJson } });
    expect(data(await service.commit({ session: S, thread: T1, files: copy(1, edited("A")), addresses: [], note: null })).iteration.changed).toEqual([SHEET]);
    expect(await service.commit({ session: S, thread: T1, files: copy(1, edited("B")), addresses: [], note: null })).toEqual({
      ok: false,
      error: {
        code: "stale_working_copy",
        message: "the working copy is based on iteration 1, but iteration 2 is the latest; pull again and reapply your edits",
        base: 1,
        latest: 2,
      },
    });
  });

  test("validation_failed returns parse and check errors together, and saves nothing", async () => {
    const { service } = await withIteration();
    const files = {
      ...copy(1, {
        "wheel/neon": { tsx: "export default function Wheel() { return <div>; }\n", json: neonJson },
        "result/sheet": { tsx: sheetTsx, json: JSON.stringify({ title: "Result sheet", props: { appearance: { headline: { type: "number", label: "H", default: 1, min: 5, max: 2 } } } }) },
      }),
      "slots/wheel/neon/helpers.ts": "export const x = 1;\n",
    };
    const result = await service.commit({ session: S, thread: T1, files, addresses: [], note: null });
    expect(result.ok ? null : result.error).toEqual({
      code: "validation_failed",
      message: "3 errors; nothing was saved",
      issues: [
        {
          severity: "error",
          code: "unexpected_file",
          file: "slots/wheel/neon/helpers.ts",
          loc: null,
          pointer: null,
          message:
            "Brainstorm reads only brainstorm.json and slots/<slot>/<variant>/{block.tsx,block.json,block.css,controls.json,about.md}, so this file would be dropped. Blocks can't import local files; inline helpers in block.tsx.",
        },
        {
          severity: "error",
          code: "invalid_prop",
          file: "slots/result/sheet/block.json",
          loc: null,
          pointer: "/props/appearance/headline/max",
          message: "max (2) must be greater than min (5)",
        },
        {
          severity: "error",
          code: "compile_error",
          file: "slots/wheel/neon/block.tsx",
          loc: { line: 1, column: 48 },
          pointer: null,
          message: "Unexpected token",
        },
      ],
    });
    expect(data(await service.pull(S))["slots/wheel/neon/block.tsx"]).toBe(neonTsx);
  });

  test("a commit from a thread that isn't attached names the owner", async () => {
    const { service } = await withIteration();
    data(await service.attach({ ref: "chore wheel", thread: T2 }));
    expect(await service.commit({ session: S, thread: T1, files: copy(1), addresses: [], note: null })).toEqual({
      ok: false,
      error: {
        code: "thread_not_attached",
        message: `session ${S} is attached to thread ${T2}, not ${T1}; run brainstorm session attach ${S} from this thread to take it over`,
        owner: T2,
      },
    });
  });

  test("returns every warning code", async () => {
    const { service } = await withIteration();
    data(await service.act(S, { kind: "set_override", blockId: NEON, prop: "spinSeconds" as PropName, value: 2 }));
    data(await service.act(S, { kind: "add_feedback", pin: { blockId: NEON, part: "spin-button" as PartName }, text: "too small" }));
    data(await service.act(S, { kind: "regenerate", scope: { kind: "blocks", blocks: [NEON] }, freetext: null }));

    const { spinSeconds: _dropped, ...appearance } = wheelProps.appearance;
    const neon = {
      tsx: `export default function Wheel({ people }) {
  return <div>{people.map((p) => <span key={p.name} data-part="slice">{p.name}</span>)}</div>;
}
`,
      json: JSON.stringify({ title: "Neon wheel", props: { data: wheelProps.data, appearance } }),
      controls: JSON.stringify({
        root: "main",
        elements: {
          main: { type: "Section", props: { title: "Look" }, children: ["accent"] },
          accent: { type: "Colour", props: { label: null, value: { $bindState: "/accent" } } },
        },
      }),
    };
    const sheet = { tsx: sheetTsx.replace("<section", "<section className=\"big\""), json: sheetJson };
    const result = data(await service.commit({ session: S, thread: T1, files: copy(1, { "wheel/neon": neon, "result/sheet": sheet }), addresses: [], note: null }));
    expect(result.warnings.map((w) => [w.code, w.file, w.message])).toEqual([
      ["uncontrolled_prop", "slots/wheel/neon/controls.json", `appearance prop "density" has no control, so Rob can't adjust it`],
      ["uncontrolled_prop", "slots/wheel/neon/controls.json", `appearance prop "showOdds" has no control, so Rob can't adjust it`],
      ["uncontrolled_prop", "slots/wheel/neon/controls.json", `appearance prop "headline" has no control, so Rob can't adjust it`],
      ["duplicate_part", "slots/wheel/neon/block.tsx", 'data-part "slice" appears more than once in one render; pins need each part to be unique'],
      [
        "override_dropped",
        "slots/wheel/neon/block.json",
        "Rob set spinSeconds = 2 on wheel/neon, and it no longer applies (prop_removed); he'll see it flagged",
      ],
      [
        "pin_lost",
        "slots/wheel/neon/block.tsx",
        'feedback #1 ("too small") is pinned to data-part "spin-button" in wheel/neon, which this commit no longer renders',
      ],
      ["out_of_scope", "slots/result/sheet/block.tsx", "result/sheet changed, but request 1 asked only for wheel/neon"],
      [
        "not_addressed",
        null,
        "request 1 asked about feedback #1, and this commit doesn't address it; pass --addresses 1 if it does",
      ],
    ]);
    expect(result.iteration.changed).toEqual([SHEET, NEON]);
  });

  test("--addresses marks feedback addressed and fulfils the open request", async () => {
    const { service } = await withIteration();
    data(await service.act(S, { kind: "add_feedback", pin: { blockId: NEON, part: null }, text: "louder" }));
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: "brighter" }));
    const louder = neonTsx.replace("Spin", "SPIN");
    const result = data(
      await service.commit({ session: S, thread: T1, files: copy(1, { "wheel/neon": { tsx: louder, json: neonJson } }), addresses: [1 as FeedbackId], note: null }),
    );
    expect(result.warnings).toEqual([]);
    const view = data(await service.view(S));
    expect(view.feedback.map((f) => [f.id, f.status])).toEqual([[1, { state: "addressed", in: 2 }]]);
    expect(view.request?.message).toBe("Iteration 2 · changed wheel/neon");
    expect(await service.commit({ session: S, thread: T1, files: copy(2, { "wheel/neon": { tsx: louder, json: neonJson } }), addresses: [1 as FeedbackId], note: null })).toMatchObject({
      ok: true,
      data: { created: false, iteration: { n: 2 } },
    });
  });
});

describe("attach", () => {
  test("refuses a thread from another project", async () => {
    const { service } = await withIteration();
    expect(await service.attach({ ref: S, thread: T3 })).toEqual({
      ok: false,
      error: {
        code: "wrong_project",
        message: `session ${S} ("Chore wheel") belongs to project proj-a, but thread ${T3} is in project proj-b`,
        sessionProject: "proj-a",
        threadProject: "proj-b",
      },
    });
  });

  test("resolves an exact title, lists candidates for an ambiguous one, and records the takeover", async () => {
    const { service } = await withIteration();
    data(await service.newSession({ title: "Onboarding A", brief: "", thread: T1, projectPath: null }));
    data(await service.newSession({ title: "Onboarding B", brief: "", thread: T1, projectPath: null }));
    expect(await service.attach({ ref: "onboarding", thread: T2 })).toEqual({
      ok: false,
      error: {
        code: "ambiguous_title",
        message: '"onboarding" matches 2 sessions; attach by id',
        candidates: [
          { id: "s_onbrd02", title: "Onboarding A" },
          { id: "s_onbrd03", title: "Onboarding B" },
        ],
      },
    });
    expect(await service.attach({ ref: "CHORE WHEEL", thread: T2 })).toEqual({
      ok: true,
      data: {
        session: { id: S, projectId: "proj-a", title: "Chore wheel", brief: "Pick who does chores", createdAt: AT },
        attachment: { session: S, threadId: T2, attachedAt: AT, lostAt: null },
        previous: T1,
      },
    });
    expect(data(await service.attach({ ref: "boarding b", thread: T2 })).session.id).toBe("s_onbrd03");
    expect(await service.attach({ ref: "nothing like it", thread: T2 })).toEqual({
      ok: false,
      error: { code: "not_found", entity: "session", message: 'no session has the id or title "nothing like it"' },
    });
  });
});

describe("request phases", () => {
  const phase = async (service: Brainstorm) => {
    const r = data(await service.view(S)).request;
    return r === null ? null : { phase: r.phase.phase, actions: r.phase.actions, message: r.message };
  };

  test("queued, working, asking, run failed, no change, retry and fulfilled", async () => {
    const { service, bridge } = await withIteration();
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: "make the spin feel less random" }));
    expect(bridge.sent).toEqual([
      {
        thread: T1,
        message: `[brainstorm] session ${S} · request 1 · scope: all · freetext: "make the spin feel less random"\nHandle with the ux-brainstorm skill: run \`brainstorm context ${S}\`.`,
      },
    ]);
    await service.tick();
    expect(await phase(service)).toEqual({ phase: "queued", actions: ["open_thread", "withdraw"], message: "Queued in T3" });

    bridge.startRun(T1, "run:2");
    await service.tick();
    expect(await phase(service)).toEqual({ phase: "working", actions: ["open_thread", "withdraw"], message: "The agent is working" });

    bridge.startRun(T1, "run:2", 1);
    await service.tick();
    expect(await phase(service)).toEqual({ phase: "asking", actions: ["open_thread", "withdraw"], message: "The agent is asking something in T3" });

    bridge.endRun(T1, "failed");
    await service.tick();
    expect(await phase(service)).toEqual({ phase: "run_failed", actions: ["retry", "withdraw"], message: "The agent's run failed in T3" });

    bridge.endRun(T1, "completed");
    await service.tick();
    expect(await phase(service)).toEqual({
      phase: "no_change",
      actions: ["retry", "withdraw"],
      message: "The agent replied in T3 without changing the design",
    });

    data(await service.act(S, { kind: "retry_request" }));
    expect(bridge.sent.length).toBe(2);
    expect(await phase(service)).toEqual({ phase: "queued", actions: ["open_thread", "withdraw"], message: "Queued in T3" });

    const edited = { "wheel/neon": { tsx: neonTsx.replace("Spin", "Go"), json: neonJson } };
    data(await service.commit({ session: S, thread: T1, files: copy(1, edited), addresses: [], note: null }));
    expect(await phase(service)).toEqual({ phase: "fulfilled", actions: [], message: "Iteration 2 · changed wheel/neon" });
  });

  test("send failed, and a retry that finds the marker already arrived doesn't send twice", async () => {
    const { service, bridge } = await withIteration();
    bridge.sendMode = "fail";
    data(await service.act(S, { kind: "regenerate", scope: { kind: "described" }, freetext: "fewer colours" }));
    expect(await phase(service)).toEqual({
      phase: "send_failed",
      actions: ["retry", "withdraw"],
      message: "Couldn't send: t3 did not answer within 15 s. The request is saved.",
    });
    expect(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: null })).toEqual({
      ok: false,
      error: { code: "request_open", message: "request 1 is still open; withdraw it first", n: 1 },
    });

    bridge.sendMode = "deliver_then_fail";
    data(await service.act(S, { kind: "retry_request" }));
    expect(bridge.sent.length).toBe(1);
    bridge.sendMode = "deliver";
    data(await service.act(S, { kind: "retry_request" }));
    expect(bridge.sent.length).toBe(1);
    expect(await phase(service)).toEqual({ phase: "queued", actions: ["open_thread", "withdraw"], message: "Queued in T3" });

    data(await service.act(S, { kind: "withdraw_request" }));
    expect(await phase(service)).toEqual({ phase: "withdrawn", actions: [], message: "Withdrawn" });
  });

  test("previous thread after a takeover, and resend goes to the new thread", async () => {
    const { service, bridge } = await withIteration();
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: null }));
    data(await service.attach({ ref: S, thread: T2 }));
    expect(await phase(service)).toEqual({ phase: "previous_thread", actions: ["resend", "withdraw"], message: "Sent to the previous thread" });
    data(await service.act(S, { kind: "retry_request" }));
    expect(bridge.sent.map((s) => s.thread)).toEqual([T1, T2]);
    expect(await phase(service)).toEqual({ phase: "queued", actions: ["open_thread", "withdraw"], message: "Queued in T3" });
  });

  test("a missing thread loses the attachment, and seeing it again recovers", async () => {
    const { service, bridge } = await withIteration();
    data(await service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: null }));
    bridge.thread(T1).missing = true;
    await service.tick();
    expect(data(await service.view(S)).attachment.lostAt).toBe(AT);
    expect(await phase(service)).toEqual({
      phase: "thread_lost",
      actions: ["copy_phrase", "withdraw"],
      message: `This session's thread is gone. In a T3 thread on this project, say: pick up the brainstorm session titled "Chore wheel"`,
    });
    bridge.thread(T1).missing = false;
    await service.tick();
    expect(data(await service.view(S)).attachment.lostAt).toBe(null);
  });

  test("sending, and startup reconciliation of a send that never finished", async () => {
    const { service, bridge, open } = await withIteration();
    bridge.sendMode = "hang";
    const pending = service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: null });
    expect(await phase(service)).toEqual({ phase: "sending", actions: [], message: "Sending to T3…" });

    const restarted = await open();
    expect(await phase(restarted)).toEqual({
      phase: "send_failed",
      actions: ["retry", "withdraw"],
      message: "Couldn't send: Brainstorm stopped before the send finished. The request is saved.",
    });
    bridge.release();
    await pending;
    restarted.close();
  });

  test("startup reconciliation marks a send that arrived as sent", async () => {
    const { service, bridge, open } = await withIteration();
    bridge.sendMode = "hang";
    const pending = service.act(S, { kind: "regenerate", scope: { kind: "all" }, freetext: null });
    await Promise.resolve();
    bridge.thread(T1).messages.push({ role: "user", runId: null, text: `[brainstorm] session ${S} · request 1 · scope: all` });
    const restarted = await open();
    expect(await phase(restarted)).toEqual({ phase: "queued", actions: ["open_thread", "withdraw"], message: "Queued in T3" });
    bridge.release();
    await pending;
    restarted.close();
  });
});

describe("overrides on read", () => {
  test("an override survives, goes inapplicable when its prop is removed, and applies again when the prop returns", async () => {
    const { service } = await withIteration();
    const accent = { blockId: NEON, prop: "accent" as PropName, value: "#00ff00", setAt: AT };
    data(await service.act(S, { kind: "set_override", blockId: NEON, prop: accent.prop, value: "#00ff00" }));
    const effective = async () => {
      const view = data(await service.view(S));
      return {
        applicable: view.overrides.applicable,
        inapplicable: view.overrides.inapplicable,
        accent: view.iteration?.blocks.find((b) => b.id === NEON)?.effectiveProps.accent,
      };
    };
    expect(await effective()).toEqual({ applicable: [accent], inapplicable: [], accent: "#00ff00" });

    const { accent: _removed, ...appearance } = wheelProps.appearance;
    const withoutAccent = { tsx: neonTsx, json: JSON.stringify({ title: "Neon wheel", props: { data: wheelProps.data, appearance } }) };
    data(await service.commit({ session: S, thread: T1, files: copy(1, { "wheel/neon": withoutAccent }), addresses: [], note: null }));
    expect(await effective()).toEqual({ applicable: [], inapplicable: [{ override: accent, reason: "prop_removed" }], accent: undefined });

    data(await service.commit({ session: S, thread: T1, files: copy(2), addresses: [], note: null }));
    expect(await effective()).toEqual({ applicable: [accent], inapplicable: [], accent: "#00ff00" });
  });

  test("Rob's writes are checked against the prop", async () => {
    const { service } = await withIteration();
    expect(await service.act(S, { kind: "set_override", blockId: NEON, prop: "spinSeconds" as PropName, value: 9 })).toEqual({
      ok: false,
      error: { code: "invalid_action", message: "9 doesn't fit spinSeconds (out_of_range)" },
    });
  });
});

describe("context", () => {
  test("reports the open request and ends with the exact next commands", async () => {
    const { service } = await withIteration();
    data(await service.act(S, { kind: "add_feedback", pin: { blockId: NEON, part: "spin-button" as PartName }, text: "too small" }));
    data(await service.act(S, { kind: "set_override", blockId: SHEET, prop: "headline" as PropName, value: "Roz" }));
    data(await service.act(S, { kind: "regenerate", scope: { kind: "blocks", blocks: [NEON] }, freetext: "bigger button" }));
    const context = data(await service.context(S, T2));
    expect({ ...context, controlVocabulary: undefined, latest: context.latest?.n }).toEqual({
      session: { id: S, title: "Chore wheel", brief: "Pick who does chores" },
      latest: 1 as IterationN,
      attached: false,
      attachedThread: T1,
      request: {
        scope: { kind: "blocks", blocks: [NEON] },
        freetext: "bigger button",
        n: 1,
        base: 1,
        feedback: [
          {
            id: 1,
            pin: { blockId: NEON, part: "spin-button" },
            text: "too small",
            createdIn: 1,
            createdAt: AT,
            history: [],
            status: { state: "open", previouslyAddressedIn: null },
          },
        ],
        overrides: [],
      },
      feedback: {
        open: [
          {
            id: 1,
            pin: { blockId: NEON, part: "spin-button" },
            text: "too small",
            createdIn: 1,
            createdAt: AT,
            history: [],
            status: { state: "open", previouslyAddressedIn: null },
          },
        ],
        addressed: [],
      },
      controlVocabulary: undefined,
      next: [`brainstorm session attach ${S}`, `brainstorm pull ${S}`, `brainstorm validate ${S}`, `brainstorm commit ${S} --addresses 1`],
    });
  });
});
