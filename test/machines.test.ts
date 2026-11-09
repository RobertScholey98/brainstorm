import { describe, expect, test } from "vitest";
import {
  blockedMessage,
  canAppend,
  foldFeedback,
  formatRefreshMessage,
  formatRequestMessage,
  keptMains,
  observeRequest,
  originText,
  parseRequestMarker,
  phaseMessage,
  requestPhase,
  scopeText,
} from "../src/core/machines";
import type {
  ConfirmScope,
  Attachment,
  BlockId,
  FeedbackEvent,
  FeedbackId,
  IterationN,
  Observation,
  PartName,
  Request,
  RequestN,
  RequestScope,
  RequestState,
  RunId,
  SlotId,
  SessionId,
  ThreadId,
  ThreadMessage,
  ThreadSnapshot,
  VariantKey,
} from "../src/core/types";

const it = (n: number) => n as IterationN;
const address = (n: number, at = "t"): FeedbackEvent => ({ kind: "address", iteration: it(n), at });
const confirm = (at = "t"): FeedbackEvent => ({ kind: "confirm", at });
const reopen = (at = "t"): FeedbackEvent => ({ kind: "reopen", at });

describe("foldFeedback", () => {
  test("new feedback is open and never addressed", () => {
    expect(foldFeedback([])).toEqual({ state: "open", previouslyAddressedIn: null });
  });

  test("address, re-address, confirm", () => {
    expect(foldFeedback([address(2)])).toEqual({ state: "addressed", in: 2 });
    expect(foldFeedback([address(2), address(3)])).toEqual({ state: "addressed", in: 3 });
    expect(foldFeedback([address(2), address(3), confirm("2026-11-05T12:00:00Z")])).toEqual({
      state: "confirmed",
      addressedIn: 3,
      at: "2026-11-05T12:00:00Z",
    });
  });

  test("reopen from addressed or confirmed remembers the last addressing iteration", () => {
    expect(foldFeedback([address(2), reopen()])).toEqual({ state: "open", previouslyAddressedIn: 2 });
    expect(foldFeedback([address(2), confirm(), reopen(), address(4), reopen()])).toEqual({
      state: "open",
      previouslyAddressedIn: 4,
    });
  });

  test("skips events that were illegal when they happened", () => {
    expect(foldFeedback([confirm(), reopen()])).toEqual({ state: "open", previouslyAddressedIn: null });
    expect(foldFeedback([address(2), confirm("c1"), address(3), confirm("c2")])).toEqual({
      state: "confirmed",
      addressedIn: 2,
      at: "c1",
    });
  });

  test("canAppend guards writes per status", () => {
    const open = foldFeedback([]);
    const addressed = foldFeedback([address(1)]);
    const confirmed = foldFeedback([address(1), confirm()]);
    const table = [open, addressed, confirmed].map((s) => [
      s.state,
      canAppend(s, "address"),
      canAppend(s, "confirm"),
      canAppend(s, "reopen"),
    ]);
    expect(table).toEqual([
      ["open", true, false, false],
      ["addressed", true, true, true],
      ["confirmed", false, false, true],
    ]);
  });
});

const session = "s_8f2k3a" as SessionId;
const threadA = "aaaaaaaa-1111-2222-3333-444455556666" as ThreadId;
const threadB = "bbbbbbbb-1111-2222-3333-444455556666" as ThreadId;

const request = (state: RequestState, threadId = threadA): Request => ({
  session,
  n: 5 as RequestN,
  scope: { kind: "blocks", blocks: ["wheel/neon" as BlockId, "result/sheet" as BlockId] },
  freetext: "make the spin feel less random",
  feedbackIds: [4 as FeedbackId, 7 as FeedbackId],
  base: it(4),
  threadId,
  state,
  sentAt: null,
  createdAt: "2026-11-05T10:00:00Z",
});

const attached: Attachment = { session, threadId: threadA, attachedAt: "t", lostAt: null };
const lost: Attachment = { ...attached, lostAt: "2026-11-05T11:00:00Z" };

const seen = (
  state: RequestState,
  attachment: Attachment,
  observation: Observation | null,
  threadId = threadA,
) => {
  const phase = requestPhase(request(state, threadId), attachment, observation, false);
  return {
    phase: phase.phase,
    actions: phase.actions,
    message: phaseMessage(phase, { title: "Chore wheel", changed: ["Neon wheel"] }),
  };
};

describe("requestPhase, one test per design.md row", () => {
  const sent: RequestState = { state: "sent" };

  test("sending", () => {
    expect(seen({ state: "sending" }, attached, null)).toEqual({ phase: "sending", actions: [], message: "Sending to T3" });
  });

  test("send_failed", () => {
    expect(seen({ state: "send_failed", error: "t3 exited 1" }, attached, null)).toEqual({
      phase: "send_failed",
      actions: ["retry", "open_thread", "withdraw"],
      message: "Couldn't send (t3 exited 1). The request is saved.",
    });
  });

  test("while another branch's request holds the shared thread, Retry and Resend wait", () => {
    const busy = (state: RequestState, threadId = threadA) => requestPhase(request(state, threadId), attached, null, true);
    expect(busy({ state: "send_failed", error: "t3 exited 1" })).toEqual({ phase: "send_failed", error: "t3 exited 1", actions: ["open_thread", "withdraw"] });
    expect(busy(sent, threadB)).toEqual({ phase: "previous_thread", actions: ["open_thread", "withdraw"] });
  });

  test("send_failed to a lost thread offers no way to open it", () => {
    expect(seen({ state: "send_failed", error: "thread not found" }, lost, null).actions).toEqual(["retry", "withdraw"]);
  });

  test("sent, request thread is not the attached thread", () => {
    expect(seen(sent, attached, { kind: "running", pendingRequestCount: 0 }, threadB)).toEqual({
      phase: "previous_thread",
      actions: ["resend", "open_thread", "withdraw"],
      message: "Sent to the previous thread",
    });
  });

  test("sent, attachment lost", () => {
    expect(seen(sent, lost, { kind: "running", pendingRequestCount: 0 })).toEqual({
      phase: "thread_lost",
      actions: ["fresh_thread", "withdraw"],
      message: "This brainstorm's thread is gone. Start a fresh thread, and the open request goes to it.",
    });
  });

  test("sent, no observation yet or marker not seen", () => {
    const queued = { phase: "queued", actions: ["open_thread", "withdraw"], message: "Queued in T3" };
    expect(seen(sent, attached, null)).toEqual(queued);
    expect(seen(sent, attached, { kind: "not_seen" })).toEqual(queued);
    expect(seen(sent, attached, { kind: "queued" })).toEqual(queued);
  });

  test("sent, marker in active run with a pending request", () => {
    expect(seen(sent, attached, { kind: "running", pendingRequestCount: 1 })).toEqual({
      phase: "asking",
      actions: ["open_thread", "withdraw"],
      message: "Agent asking in T3",
    });
  });

  test("sent, marker in active run", () => {
    expect(seen(sent, attached, { kind: "running", pendingRequestCount: 0 })).toEqual({
      phase: "working",
      actions: ["open_thread", "withdraw"],
      message: "Agent working",
    });
  });

  test("sent, marker's run ended and the thread failed", () => {
    expect(seen(sent, attached, { kind: "ended", failed: true })).toEqual({
      phase: "run_failed",
      actions: ["retry", "open_thread", "withdraw"],
      message: "The agent's run failed in T3",
    });
  });

  test("sent, marker's run ended with no commit", () => {
    expect(seen(sent, attached, { kind: "ended", failed: false })).toEqual({
      phase: "no_change",
      actions: ["retry", "open_thread", "withdraw"],
      message: "The agent replied in T3 without changing the design",
    });
  });

  test("fulfilled", () => {
    expect(seen({ state: "fulfilled", iteration: it(5) }, lost, { kind: "ended", failed: true })).toEqual({
      phase: "fulfilled",
      actions: [],
      message: "Iteration 5 · changed Neon wheel",
    });
  });

  test("fulfilled names two changed blocks, then counts the rest", () => {
    const fulfilled = requestPhase(request({ state: "fulfilled", iteration: it(3) }), attached, null, false);
    const message = (changed: string[]) => phaseMessage(fulfilled, { title: "Chore wheel", changed });
    expect([message([]), message(["Neon wheel", "Card"]), message(["Neon wheel", "Card", "Slot reel", "Receipt"])]).toEqual([
      "Iteration 3 · no blocks changed",
      "Iteration 3 · changed Neon wheel, Card",
      "Iteration 3 · changed Neon wheel, Card and 2 more",
    ]);
  });

  test("a fulfilled vary counts the new variants that landed, by the element", () => {
    const fulfilled = requestPhase(request({ state: "fulfilled", iteration: it(4) }), attached, null, false);
    const variants = [
      { key: "spin-button-a", title: "Spin button A" },
      { key: "spin-button-b", title: "Spin button B" },
    ] as unknown as Extract<RequestScope, { kind: "vary" }>["variants"];
    const vary = (part: string | null) => ({ kind: "vary", target: { blockId: "wheel/neon", part }, variants }) as unknown as RequestScope;
    const message = (scope: RequestScope, changed: string[]) => phaseMessage(fulfilled, { title: "Chore wheel", changed, scope });
    expect([
      message(vary("spin-button"), ["Spin button A", "Spin button B"]),
      message(vary(null), ["Spin button A"]),
      message(vary("spin-button"), ["Neon wheel"]),
    ]).toEqual(["Iteration 4 · 2 new variants of Spin button", "Iteration 4 · 1 new variant", "Iteration 4 · changed Neon wheel"]);
  });

  test("withdrawn has no actions", () => {
    expect(seen({ state: "withdrawn" }, attached, null)).toEqual({ phase: "withdrawn", actions: [], message: "Request withdrawn" });
  });
});

test("blockedMessage says why Regenerate is shut, after the hint's lead name", () => {
  expect([blockedMessage("no_iteration", undefined), blockedMessage("request_open", 3 as RequestN), blockedMessage("thread_lost", undefined)]).toEqual([
    "Needs a first iteration",
    "Request 3 is still open",
    "This brainstorm's thread is gone. Start a fresh thread from the top bar.",
  ]);
});

describe("observeRequest", () => {
  const run = (n: number) => `run:thread:a:ordinal:${n}` as RunId;
  const marker = formatRequestMessage(request({ state: "sent" }));
  const user = (text: string, runId: RunId | null): ThreadMessage => ({ role: "user", runId, text });
  const assistant = (runId: RunId): ThreadMessage => ({ role: "assistant", runId, text: "Done." });
  const snapshot = (
    messages: ThreadMessage[],
    thread: { activeRunId: RunId | null; latestRunId: RunId | null; status?: "running" | "completed" | "failed"; pending?: number },
  ): ThreadSnapshot => ({
    thread: {
      threadId: threadA,
      projectId: "p" as never,
      title: "Chore wheel",
      link: "https://app.t3.codes/threads/a",
      status: thread.status ?? "completed",
      activeRunId: thread.activeRunId,
      latestRunId: thread.latestRunId,
      pendingRequestCount: thread.pending ?? 0,
    },
    messages,
  });
  const observe = (s: ThreadSnapshot) => observeRequest(session, 5 as RequestN, s);

  test("not seen when no user message carries this request's marker", () => {
    const other = formatRequestMessage({ ...request({ state: "sent" }), n: 4 as RequestN });
    expect(observe(snapshot([user(other, run(1)), assistant(run(1))], { activeRunId: null, latestRunId: run(1) }))).toEqual({
      kind: "not_seen",
    });
  });

  test("running when the marker's run is the active run", () => {
    expect(
      observe(snapshot([user(marker, run(2))], { activeRunId: run(2), latestRunId: run(2), status: "running", pending: 1 })),
    ).toEqual({ kind: "running", pendingRequestCount: 1 });
  });

  test("queued when the marker waits behind the active run", () => {
    expect(
      observe(snapshot([user("earlier", run(1)), user(marker, run(2))], { activeRunId: run(1), latestRunId: run(1), status: "running" })),
    ).toEqual({ kind: "queued" });
    expect(observe(snapshot([user(marker, null)], { activeRunId: run(1), latestRunId: run(1) }))).toEqual({ kind: "queued" });
  });

  test("ended, failed only when the marker's run is the latest and the thread failed", () => {
    expect(observe(snapshot([user(marker, run(2)), assistant(run(2))], { activeRunId: null, latestRunId: run(2), status: "failed" }))).toEqual({
      kind: "ended",
      failed: true,
    });
    expect(
      observe(snapshot([user(marker, run(2)), user("next", run(3))], { activeRunId: null, latestRunId: run(3), status: "failed" })),
    ).toEqual({ kind: "ended", failed: false });
  });

  test("a resent marker is judged by its last occurrence", () => {
    expect(
      observe(snapshot([user(marker, run(1)), user(marker, run(2))], { activeRunId: run(2), latestRunId: run(2), status: "running" })),
    ).toEqual({ kind: "running", pendingRequestCount: 0 });
  });
});

describe("the [brainstorm] message", () => {
  test("formats the design.md example", () => {
    expect(formatRequestMessage(request({ state: "sending" }))).toBe(
      '[brainstorm] session s_8f2k3a · request 5 · scope: wheel/neon, result/sheet · feedback: #4 #7 · freetext: "make the spin feel less random"\n' +
        "Handle with the use-brainstorm skill: run `brainstorm context s_8f2k3a`.",
    );
  });

  test("omits empty feedback and free text, and keeps the marker on one line", () => {
    const base = request({ state: "sending" });
    expect(formatRequestMessage({ ...base, scope: { kind: "all" }, feedbackIds: [], freetext: null }).split("\n")[0]).toBe(
      "[brainstorm] session s_8f2k3a · request 5 · scope: all",
    );
    expect(formatRequestMessage({ ...base, scope: { kind: "described" }, feedbackIds: [], freetext: 'say "hi"\nthen go' }).split("\n")[0]).toBe(
      '[brainstorm] session s_8f2k3a · request 5 · scope: described · freetext: "say \\"hi\\"\\nthen go"',
    );
  });

  test("parseRequestMarker reads back what formatRequestMessage wrote", () => {
    expect(parseRequestMarker(formatRequestMessage(request({ state: "sending" })))).toEqual({ session: "s_8f2k3a", n: 5 });
    expect(parseRequestMarker("please [brainstorm] session s_abc123 · request 12 · scope: all")).toEqual({ session: "s_abc123", n: 12 });
    expect(parseRequestMarker("[brainstorm] session nope · request 5")).toBe(null);
    expect(parseRequestMarker("just chatting")).toBe(null);
  });
});

describe("branches, confirms and fresh threads", () => {
  test("a branch's first request says where it left, on the thread the agent already has", () => {
    const first = formatRequestMessage(
      { ...request({ state: "sending" }), n: 1 as RequestN, scope: { kind: "all" }, feedbackIds: [], freetext: "slot machine" },
      { fork: { parent: "s_parent1" as SessionId, from: 3 as IterationN } },
    );
    expect(first).toBe(
      '[brainstorm] session s_8f2k3a · request 1 · branch of s_parent1 iteration 3 · scope: all · freetext: "slot machine"\n' +
        "Handle with the use-brainstorm skill: run `brainstorm context s_8f2k3a`.",
    );
    expect(parseRequestMarker(first)).toEqual({ session: "s_8f2k3a", n: 1 });
  });

  test("a confirm's scope names Main, what goes into it and what goes", () => {
    const confirm = {
      kind: "confirm" as const,
      mains: [{ slot: "wheel" as SlotId, variant: "neon" as VariantKey }],
      grafts: [{ from: { blockId: "wheel/calm" as BlockId, part: "spin-button" as PartName }, into: "wheel" as SlotId, instruction: null }],
      drop: ["wheel/calm" as BlockId],
    };
    expect(scopeText(confirm)).toBe("confirm main wheel/neon; graft wheel/calm [spin-button] into wheel; drop wheel/calm");
    expect(scopeText({ ...confirm, mains: [], grafts: [] })).toBe("confirm; drop wheel/calm");
    expect(scopeText({ kind: "add_slot" })).toBe("add_slot");
  });

  test("a confirm's history line leads with the Main it kept, by title, and counts several", () => {
    const wheel = { slot: "wheel" as SlotId, variant: "neon" as VariantKey };
    const result = { slot: "result" as SlotId, variant: "sheet" as VariantKey };
    const drops = ["wheel/calm", "wheel/reel", "wheel/flat", "wheel/dial", "wheel/slot"] as BlockId[];
    const confirm: ConfirmScope = { kind: "confirm", mains: [wheel, result], grafts: [], drop: drops };
    expect(keptMains(confirm), "a slot that kept its only variant isn't news").toEqual(["wheel/neon"]);
    const origin = (scope: ConfirmScope, kept: string[]) => originText({ kind: "request", n: 1 as RequestN, body: { scope, freetext: null }, changed: [], kept });
    expect(origin(confirm, ["Neon wheel"])).toBe("Kept Neon wheel · 5 options dropped");
    const both = { ...confirm, drop: [...drops, "result/plain" as BlockId] };
    expect(keptMains(both)).toEqual(["wheel/neon", "result/sheet"]);
    expect(origin(both, ["Neon wheel", "Result sheet"])).toBe("Kept 2 Mains · 6 options dropped");
    const graft: ConfirmScope = { ...confirm, drop: [], grafts: [{ from: { blockId: "wheel/calm" as BlockId, part: "spin-button" as PartName }, into: "wheel" as SlotId, instruction: null }] };
    expect(keptMains(graft)).toEqual(["wheel/neon"]);
    expect(origin(graft, ["Neon wheel"])).toBe("Kept Neon wheel · 1 element brought in");
    expect(origin({ ...confirm, mains: [] }, []), "trashes in a slot with no Main keep no Main").toBe("Confirmed · 5 options dropped");
    expect(phaseMessage({ phase: "fulfilled", iteration: 4 as IterationN, actions: [] }, { title: "Chore wheel", changed: [], kept: ["Neon wheel"], scope: confirm })).toBe(
      "Iteration 4 · Kept Neon wheel · 5 options dropped",
    );
  });

  test("a fresh thread's first message has the new agent attach and read the brainstorm, with no request to answer", () => {
    const message = formatRefreshMessage(session, "Chore wheel", null);
    expect(message).toBe(
      '[brainstorm] session s_8f2k3a · fresh thread for "Chore wheel"\n' +
        "Handle with the use-brainstorm skill: this thread is new, so run `brainstorm session attach s_8f2k3a`, then `brainstorm context s_8f2k3a`, and reply in one line once you have read it.",
    );
    expect(parseRequestMarker(message), "nothing for the request machinery to wait on").toBe(null);
  });
});

describe("vary and history text", () => {
  const vary = {
    kind: "vary" as const,
    target: { blockId: "wheel/neon" as BlockId, part: "spin-button" as PartName },
    variants: [
      { key: "spin-button-a" as VariantKey, title: "Spin button A" },
      { key: "spin-button-b" as VariantKey, title: "Spin button B" },
    ] as const,
  };

  test("a vary's scope names the target and the keys it asks for", () => {
    expect(scopeText(vary)).toBe("vary wheel/neon [spin-button] as spin-button-a, spin-button-b");
    expect(scopeText({ ...vary, target: { ...vary.target, part: null } })).toBe("vary wheel/neon as spin-button-a, spin-button-b");
  });

  test("originText says where each iteration came from", () => {
    expect(originText({ kind: "brief" })).toBe("First designs, from the brief");
    expect(originText({ kind: "fork", parent: "Chore wheel", from: 2 as IterationN })).toBe("Branched from iteration 2");
    expect(originText({ kind: "agent", note: null })).toBe("The agent's own commit");
    expect(originText({ kind: "agent", note: "tidied" })).toBe("tidied");
    expect(originText({ kind: "request", n: 1 as RequestN, body: { scope: { kind: "all" }, freetext: null }, changed: ["Neon wheel", "Slot reel", "Assignment card"], kept: [] })).toBe(
      "Changed Neon wheel, Slot reel and 1 more",
    );
    expect(
      originText({ kind: "request", n: 1 as RequestN, body: { scope: { kind: "blocks", blocks: ["wheel/neon" as BlockId] }, freetext: null }, changed: ["Neon wheel"], kept: [] }),
    ).toBe("Changed Neon wheel");
    expect(originText({ kind: "request", n: 1 as RequestN, body: { scope: { kind: "blocks", blocks: ["wheel/neon" as BlockId] }, freetext: null }, changed: [], kept: [] })).toBe(
      "No blocks changed",
    );
    expect(originText({ kind: "request", n: 1 as RequestN, body: { scope: { kind: "all" }, freetext: "calmer" }, changed: [], kept: [] })).toBe("calmer");
    expect(originText({ kind: "request", n: 1 as RequestN, body: { scope: vary, freetext: "bouncier" }, changed: [], kept: [] })).toBe("Vary Spin button ×2 · bouncier");
  });
});
