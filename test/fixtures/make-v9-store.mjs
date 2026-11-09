// Writes test/fixtures/v9-store.sql: a schema version 9 store made by version 9's own code, so the migration test
// (test/store.test.ts) runs migrations 10 to 12 on rows that code wrote, every column included.
//
// It runs inside a checkout of the last commit before ADR 010, as one of that commit's own vitest files, because
// its service needs vitest's TypeScript transform and the check worker its global setup builds:
//
//   git worktree add --detach <tmp> 6988cfb        # main before ADR 010; src/core/store.ts as of 7f6b644 (user_version 9)
//   (junction <tmp>/node_modules to an installed node_modules)
//   cp test/fixtures/make-v9-store.mjs <tmp>/test/make-v9-store.test.ts
//   cd <tmp> && BS_V9_OUT=<repo>/test/fixtures/v9-store.sql npx vitest run test/make-v9-store.test.ts
//   git worktree remove --force <tmp>
//
// The clock and session ids are fixed, so a rerun writes the same rows, except the design system's random id and the
// temporary paths its source records.
//
// What it makes, through the v9 Brainstorm service and a fake T3:
// - s_root0001 "Chore wheel", on thread 1111…, with the fixture kit as its design system: iterations 1-3, an open pin
//   made at iteration 3, and request 1 ("warmer", base 3) sent on its thread.
// - s_fork0001, a fork of the root's iteration 2 on a thread of its own: request 1 (its first message) fulfilled by its
//   iteration 2, which addresses the pin it carried and adds the proposed component ChoreList; request 2
//   ("darker again", base 2) sent on its own thread.
// - s_grand001, a fork of s_fork0001's iteration 1 on a thread of its own: request 1 fulfilled by its iteration 2.
// - s_pend0001, a fork of the root's iteration 3 whose thread never started: still on pending:s_pend0001, its
//   request 1 send failed.
// - s_same0001, a fork of the root's iteration 1 that the root's thread took over: its request 1 resent and open on
//   the root's thread, beside the root's.
// - s_lost0001 "Meal plan", freeform, on thread 3333…, which T3 then lost; and s_lfork001, its fork from iteration 1
//   on a healthy thread of its own, request 1 fulfilled by its iteration 2.
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { Brainstorm } from "../src/core/brainstorm";
import { createChecker } from "../src/core/check";
import { FakeBridge } from "./fakeBridge";

const T1 = "11111111-1111-1111-1111-111111111111";
const TL = "33333333-3333-3333-3333-333333333333";
const ROOT = "s_root0001";
const FORK = "s_fork0001";
const GRAND = "s_grand001";
const PENDING = "s_pend0001";
const SAME = "s_same0001";
const LOST = "s_lost0001";
const LOST_FORK = "s_lfork001";

const data = (result) => {
  if (!result.ok) throw new Error(JSON.stringify(result.error, null, 2));
  return result.data;
};

const kitBlock = (body) => `import { Button, Card, CardBody, CardTitle, Stack } from "kit";
export default function Chores() {
  return (
    <Card>
      <Stack gap="3">
        <CardTitle>Chores</CardTitle>
        <CardBody>${body}</CardBody>
        <Button>Spin</Button>
      </Stack>
    </Card>
  );
}
`;
const usesProposed = `import { Card, Stack } from "kit";
import ChoreList from "proposed/ChoreList";
export default function Chores() {
  return (
    <Card>
      <Stack gap="3">
        <ChoreList items={["Dishes", "Bins"]} />
      </Stack>
    </Card>
  );
}
`;
const choreList = {
  "proposed/ChoreList/component.tsx": `import { Text } from "kit";
export default function ChoreList({ items }) {
  return (
    <ul className="chore-list">
      {items.map((item) => (
        <li key={item} className="rounded-md border border-border"><Text size="sm">{item}</Text></li>
      ))}
    </ul>
  );
}
`,
  "proposed/ChoreList/component.json": JSON.stringify({ title: "Chore list", description: "The week's chores, one row each", tier: "primitive", example: { items: ["Dishes"] } }),
  "proposed/ChoreList/component.css": ".chore-list { display: flex; flex-direction: column; gap: calc(var(--spacing) * 2); border-radius: var(--radius); }\n",
};

const kitCopy = (session, base, tsx, extra = {}) => ({
  "brainstorm.json": JSON.stringify({ format: 1, session, base, slots: [{ id: "home", title: "Home" }] }),
  "slots/home/a/block.tsx": tsx,
  "slots/home/a/block.json": JSON.stringify({ title: "Chores", props: {} }),
  ...extra,
});

const mealCopy = (session, base, headline) => ({
  "brainstorm.json": JSON.stringify({ format: 1, session, base, slots: [{ id: "week", title: "Week" }] }),
  "slots/week/grid/block.tsx": `export default function Week({ headline }) {\n  return <section data-part="days">{headline}</section>;\n}\n`,
  "slots/week/grid/block.json": JSON.stringify({ title: "Week grid", props: { appearance: { headline: { type: "text", label: "Headline", default: headline } } } }),
});

/** Every row of every table, as SQL that rebuilds the store. A text's line breaks become char(10), as sqlite3's .dump writes them, so the file survives line-ending conversion. */
function dump(db) {
  const literal = (v) => {
    if (v === null) return "NULL";
    if (typeof v === "number" || typeof v === "bigint") return String(v);
    if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString("hex")}'`;
    const quoted = `'${v.replaceAll("'", "''")}'`;
    if (!/[\r\n]/.test(v)) return quoted;
    const token = (base) => [base, `${base}_`, `${base}__`, `${base}___`].find((t) => !v.includes(t));
    const nl = token("\\n");
    const cr = token("\\r");
    return `replace(replace(${quoted.replaceAll("\r", cr).replaceAll("\n", nl)},'${nl}',char(10)),'${cr}',char(13))`;
  };
  const schema = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all();
  const lines = ["PRAGMA foreign_keys = OFF;", "BEGIN;"];
  for (const t of schema.filter((s) => s.type === "table")) lines.push(`${t.sql};`);
  for (const t of schema.filter((s) => s.type === "table")) {
    for (const row of db.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all()) {
      lines.push(`INSERT INTO "${t.name}" VALUES(${Object.values(row).map(literal).join(",")});`);
    }
  }
  for (const i of schema.filter((s) => s.type !== "table")) lines.push(`${i.sql};`);
  lines.push(`PRAGMA user_version = ${db.prepare("PRAGMA user_version").get().user_version};`, "COMMIT;", "");
  return lines.join("\n");
}

test("make a version 9 store", async () => {
  const out = process.env.BS_V9_OUT ?? join(process.cwd(), "v9-store.sql");
  const home = mkdtempSync(join(tmpdir(), "bs-v9-"));
  const dbPath = join(home, "brainstorm.db");
  // Inside the checkout, so the library resolves react and tailwindcss from its node_modules.
  const lib = mkdtempSync(join(import.meta.dirname, ".kit-"));
  cpSync(join(import.meta.dirname, "kit-lib"), lib, { recursive: true });
  const bridge = new FakeBridge();
  bridge.add(T1, "p1", "Design thread");
  bridge.add(TL, "p1", "Meals thread");
  let tick = Date.parse("2026-11-01T09:00:00.000Z");
  const now = () => new Date((tick += 1000)).toISOString();
  bridge.now = now;
  const ids = [ROOT, FORK, GRAND, PENDING, SAME, LOST, LOST_FORK];
  const checker = createChecker({ size: 1 });
  const service = await Brainstorm.open({ dbPath, exportsDir: join(home, "exports"), bridge, checker, now, newSessionId: () => ids.shift() });
  const started = () => bridge.started.at(-1).thread;

  const system = data(await service.systems.add({ path: lib, thread: T1 })).system.id;
  data(await service.systems.review(system, { kind: "confirm" }));

  data(await service.newSession({ title: "Chore wheel", brief: "Pick who does chores", thread: T1, projectPath: null, system: "@fixture/kit" }));
  data(await service.commit({ session: ROOT, thread: T1, files: kitCopy(ROOT, null, kitBlock("Three left")), addresses: [], note: "first cut" }));
  data(await service.commit({ session: ROOT, thread: T1, files: kitCopy(ROOT, 1, kitBlock("Two left")), addresses: [], note: null }));
  data(await service.commit({ session: ROOT, thread: T1, files: kitCopy(ROOT, 2, kitBlock("One left")), addresses: [], note: null }));
  data(await service.act(ROOT, { kind: "add_feedback", pin: { blockId: "home/a", part: null }, text: "darker still" }));

  expect(data(await service.fork(ROOT, { from: 2, picks: {}, instruction: "darker" })).fork).toBe(FORK);
  const forkThread = started();
  const carried = data(await service.view(FORK)).feedback.map((f) => f.id);
  data(await service.commit({ session: FORK, thread: forkThread, files: kitCopy(FORK, 1, usesProposed, choreList), addresses: carried, note: "darker, as a list" }));
  data(await service.act(FORK, { kind: "regenerate", scope: { kind: "all" }, freetext: "darker again" }));

  expect(data(await service.fork(FORK, { from: 1, picks: {}, instruction: "smaller" })).fork).toBe(GRAND);
  data(await service.commit({ session: GRAND, thread: started(), files: kitCopy(GRAND, 1, kitBlock("Two, smaller")), addresses: [], note: null }));

  bridge.startMode = "fail";
  expect(data(await service.fork(ROOT, { from: 3, picks: {}, instruction: "rounder" })).fork).toBe(PENDING);
  bridge.startMode = "deliver";

  expect(data(await service.fork(ROOT, { from: 1, picks: {}, instruction: "taller" })).fork).toBe(SAME);
  data(await service.attach({ ref: SAME, thread: T1 }));
  data(await service.act(SAME, { kind: "retry_request" }));

  data(await service.act(ROOT, { kind: "regenerate", scope: { kind: "all" }, freetext: "warmer" }));

  data(await service.newSession({ title: "Meal plan", brief: "Plan the week's meals", thread: TL, projectPath: null }));
  data(await service.commit({ session: LOST, thread: TL, files: mealCopy(LOST, null, "This week"), addresses: [], note: null }));
  expect(data(await service.fork(LOST, { from: 1, picks: {}, instruction: "by day" })).fork).toBe(LOST_FORK);
  data(await service.commit({ session: LOST_FORK, thread: started(), files: mealCopy(LOST_FORK, 1, "Monday"), addresses: [], note: null }));
  bridge.thread(TL).missing = true;
  data(await service.act(LOST, { kind: "check_thread" }));

  service.close();
  await checker.close();
  rmSync(lib, { recursive: true, force: true });
  const db = new DatabaseSync(dbPath);
  expect(db.prepare("PRAGMA user_version").get().user_version).toBe(9);
  writeFileSync(out, dump(db));
  db.close();
}, 300_000);
