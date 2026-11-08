import { ArrowLeft, ArrowRight, Bot, Check, ChevronLeft, ChevronRight, ChevronsRight, Component, Copy, ExternalLink, Flag, FolderOpen, FolderPlus, ListChecks, RefreshCw, RotateCcw, Send, Wrench, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout, CalloutItem } from "@/components/ui/callout";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { PageHeader } from "@/components/ui/page-header";
import { Popover, PopoverContent, PopoverFooter, PopoverHeader, PopoverTrigger } from "@/components/ui/popover";
import { ScrollPane } from "@/components/ui/scroll-pane";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { BlockedHint, Hint } from "@/components/ui/tooltip";
import { Truncate } from "@/components/ui/truncate";
import type {
  ArgType,
  CatalogEntry,
  FrameToHost,
  GalleryFocus,
  HostToFrame,
  Issue,
  Json,
  ReviewAction,
  ReviewIssue,
  StoryInfo,
  SystemId,
  SystemImport,
  SystemListing,
  SystemReview,
  SystemView,
  ThemeState,
  Tier,
} from "../core/types";
import { AgentWorkStatus, useAgentWork } from "./AgentWork";
import { axisLabel, axisOptions } from "./axes";
import { cn } from "cn";
import type { Api } from "./api";
import { kitFor } from "./kit";
import type { Notice } from "./notice";
import { age, useNow } from "./time";

type Tab = "components" | "theme" | "versions" | "warnings";

/** Design systems (ADR 007, ADR 008): the libraries and app projects Brainstorm syncs, and what each one holds. */
export function SystemsPage({
  api,
  revision,
  selected,
  onSelect,
  showNotice,
}: {
  api: Api;
  /** Bumped when a system or an import changes on the server, such as an auto-sync. */
  revision: number;
  selected: SystemId | null;
  onSelect: (id: SystemId | null) => void;
  showNotice: (notice: Notice) => void;
}) {
  const [systems, setSystems] = useState<readonly SystemListing[] | null>(null);
  const [imports, setImports] = useState<readonly SystemImport[]>([]);
  const [syncing, setSyncing] = useState<SystemId | null>(null);
  /** A folder that holds no design system Brainstorm can sync, which an agent can import. */
  const [noSystem, setNoSystem] = useState<{ path: string; message: string } | null>(null);
  const refresh = useCallback(() => {
    void api.systems().then((r) => r.ok && setSystems(r.data));
    void api.systemImports().then((r) => r.ok && setImports(r.data));
  }, [api]);
  useEffect(refresh, [refresh, revision]);

  const sync = async (id: SystemId) => {
    setSyncing(id);
    const r = await api.syncSystem(id);
    setSyncing(null);
    refresh();
    if (!r.ok) return showNotice({ title: "Couldn't sync the design system", detail: issuesText(r.error) });
    showNotice({
      title: r.data.created ? `Synced version ${r.data.system.latest?.n ?? ""}` : "Nothing changed",
      detail: r.data.created ? "Brainstorms on an older version can upgrade from their Inspector." : "The project builds the same as its latest version.",
      tone: "success",
    });
  };

  // The add field starts empty again once an import is under way; the import's card names the folder.
  const [addField, setAddField] = useState(0);
  const startImport = async (path: string, repair: SystemId | null = null) => {
    const r = await api.importSystem(path, repair);
    refresh();
    if (!r.ok) return showNotice({ title: repair === null ? "Couldn't start the import" : "Couldn't start the repair", detail: r.error.message });
    if (r.data.state === "failed") return showNotice({ title: "T3 didn't start the agent", detail: r.data.error });
    setNoSystem(null);
    if (repair === null) setAddField((n) => n + 1);
  };

  if (selected !== null) {
    return (
      <SystemDetail
        api={api}
        id={selected}
        revision={revision}
        syncing={syncing === selected}
        onSync={() => void sync(selected)}
        onRepair={(root) => void startImport(root, selected)}
        repairing={imports.some((i) => systems?.find((s) => s.id === selected)?.root === i.root)}
        onBack={() => onSelect(null)}
        showNotice={showNotice}
      />
    );
  }
  return (
    <div className="flex size-full flex-col" data-systems-page>
      <ScrollPane
        inset={6}
        head={
          <div className="flex flex-col gap-5 px-6 pt-6 pb-2">
            <PageHeader
              heading="Design systems"
              description="A React library, or an app's own components. A brainstorm built with one composes only its components, so the design can be built as drawn. Brainstorm syncs a system again whenever its project changes."
            />
            <AddSystem
              key={addField}
              onAdd={async (path) => {
                const r = await api.addSystem(path);
                if (!r.ok) {
                  const missing = r.error.code === "validation_failed" ? r.error.issues.find((i) => i.code === "no_system") : undefined;
                  if (missing !== undefined) setNoSystem({ path, message: missing.message });
                  else showNotice({ title: "Couldn't add the design system", detail: issuesText(r.error) });
                  return false;
                }
                setNoSystem(null);
                refresh();
                onSelect(r.data.system.id);
                return true;
              }}
              onPick={() => api.pickFolder()}
              showNotice={showNotice}
            />
            {noSystem !== null && (
              <Callout
                tone="info"
                heading="No design system Brainstorm can sync here yet"
                data-system-none={noSystem.path}
                actions={
                  <>
                    <Button variant="accent" onClick={() => void startImport(noSystem.path)} data-system-import>
                      <Bot data-icon="inline-start" aria-hidden />
                      Import with an agent
                    </Button>
                    <Button variant="ghost" onClick={() => setNoSystem(null)}>
                      Not now
                    </Button>
                  </>
                }
              >
                <p>
                  <span className="font-mono">{noSystem.path}</span> isn't a library's package, and its project has no <span className="font-mono">.brainstorm/system.json</span>.
                </p>
                <p>
                  An agent can import the app's components. In a T3 thread on the project, it picks the components that make up the design system, writes{" "}
                  <span className="font-mono">.brainstorm/system.json</span> and a story for each one, and checks them. Then it adds the system here. Its files stay in the project, so you review them in a diff.
                </p>
              </Callout>
            )}
          </div>
        }
      >
        <div className="grid gap-3 pt-3 pb-6">
          {imports.length > 0 && (
            <ul className="grid gap-3" data-system-imports>
              {imports.map((i) => (
                <ImportCard key={i.root} api={api} item={i} onRetry={() => void startImport(i.root)} onDismiss={() => void api.dismissImport(i.root).then(refresh)} />
              ))}
            </ul>
          )}
          {systems === null ? (
            <div className="grid gap-3" aria-busy>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : systems.length === 0 && imports.length === 0 ? (
            // While the import callout shows, it says what to do; the empty state would only repeat it.
            noSystem === null && (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Component aria-hidden />
                </EmptyMedia>
                <EmptyTitle>No design systems yet</EmptyTitle>
                <EmptyDescription>
                  Add a library's package folder, or an app's project folder above. Brainstorm reads a library's entry, stylesheet and stories itself. An agent can import an app's components.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
            )
          ) : (
            <ul className="grid gap-3" data-systems-list>
              {systems.map((s) => (
                <SystemCard
                  key={s.id}
                  system={s}
                  syncing={syncing === s.id}
                  repairing={imports.some((i) => i.root === s.root)}
                  onOpen={() => onSelect(s.id)}
                  onSync={() => void sync(s.id)}
                  onRepair={() => void startImport(s.root, s.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </ScrollPane>
    </div>
  );
}

function issuesText(error: { message: string; issues?: readonly Issue[] }): string {
  const first = error.issues?.find((i) => i.severity === "error");
  return first === undefined ? error.message : `${error.message}: ${first.message}`;
}

/** Only the app's window has a native folder dialog to open; the headless server's page takes a pasted path. */
const HAS_FOLDER_DIALOG = /Electron\//.test(navigator.userAgent);

function AddSystem({
  onAdd,
  onPick,
  showNotice,
}: {
  onAdd: (path: string) => Promise<boolean>;
  onPick: () => ReturnType<Api["pickFolder"]>;
  showNotice: (notice: Notice) => void;
}) {
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async (folder: string) => {
    if (folder === "" || busy) return;
    setBusy(true);
    const added = await onAdd(folder);
    setBusy(false);
    if (added) setPath("");
  };
  // A folder chosen in the dialog, whose button reads Add design system, is added at once. It stays in the field when
  // the add fails, so Rob can correct it.
  const browse = async () => {
    if (busy) return;
    const r = await onPick();
    if (!r.ok) return showNotice({ title: "Couldn't open the folder dialog", detail: r.error.message });
    if (r.data.path === null) return;
    setPath(r.data.path);
    await add(r.data.path);
  };
  return (
    <div className="flex items-center gap-2" data-system-add>
      <Input
        aria-label="Library or project folder"
        className="min-w-0 flex-1 font-mono text-xs"
        placeholder="C:\code\app"
        value={path}
        disabled={busy}
        onChange={(e) => setPath(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void add(path.trim())}
      />
      {HAS_FOLDER_DIALOG && (
        <Button disabled={busy} onClick={() => void browse()} data-system-browse>
          <FolderOpen data-icon="inline-start" aria-hidden />
          Browse…
        </Button>
      )}
      <Button variant="accent" disabled={path.trim() === "" || busy} onClick={() => void add(path.trim())} data-system-add-button>
        {busy ? <Spinner data-icon="inline-start" /> : <FolderPlus data-icon="inline-start" aria-hidden />}
        {busy ? "Syncing…" : "Add design system"}
      </Button>
    </div>
  );
}

/** An agent importing a project's system, or repairing one, in a T3 thread (ADR 008), and what it is doing there. */
function ImportCard({ api, item, onRetry, onDismiss }: { api: Api; item: SystemImport; onRetry: () => void; onDismiss: () => void }) {
  const work = useAgentWork(api, item.state === "started" ? item.thread : null);
  const done = work?.phase === "finished";
  return (
    <li className="flex items-start gap-4 rounded-lg bg-card p-4 shadow-xs ring-1 ring-border" data-system-importing={item.root} data-import-state={item.state}>
      <span className="grid min-w-0 flex-1 gap-2">
        <span className="grid min-w-0 gap-1">
          <span className="text-base font-semibold">{item.state === "failed" ? "The import didn't start" : "Importing with an agent"}</span>
          <span className="flex min-w-0 font-mono text-xs text-fg-muted">
            <Truncate>{item.root}</Truncate>
          </span>
        </span>
        {item.state === "failed" ? (
          <span className="text-sm text-danger">{item.error}</span>
        ) : item.state === "starting" ? (
          <span className="flex items-center gap-2 text-sm text-fg-muted">
            <Spinner />
            Starting a T3 thread on the project…
          </span>
        ) : (
          <>
            <AgentWorkStatus
              work={work}
              since={item.at}
              link={item.link}
              actions={
                done ? undefined : (
                  <Hint label="The agent keeps going in T3" side="bottom">
                    <Button variant="ghost" size="xs" onClick={onDismiss} data-import-dismiss>
                      Hide
                    </Button>
                  </Hint>
                )
              }
            />
            <span className="text-sm text-fg-muted">
              {done ? (
                "The agent stopped without adding the system. Open the thread to see what it needs."
              ) : (
                <>
                  It writes <span className="font-mono text-xs">.brainstorm/system.json</span> and the missing stories, checks them, then adds the system here for your review.
                </>
              )}
            </span>
          </>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {item.state === "failed" && (
          <Button variant="outline" onClick={onRetry}>
            <RotateCcw data-icon="inline-start" aria-hidden />
            Try again
          </Button>
        )}
        {(item.state !== "started" || done) && (
          <Button variant="ghost" onClick={onDismiss} data-import-dismiss>
            Dismiss
          </Button>
        )}
      </span>
    </li>
  );
}

function SystemCard({
  system,
  syncing,
  repairing,
  onOpen,
  onSync,
  onRepair,
}: {
  system: SystemListing;
  syncing: boolean;
  repairing: boolean;
  onOpen: () => void;
  onSync: () => void;
  onRepair: () => void;
}) {
  const now = useNow();
  const latest = system.latest;
  const warnings = latest?.warnings.length ?? 0;
  const error = system.syncError;
  return (
    <li className="flex items-start gap-4 rounded-lg bg-card p-4 shadow-xs ring-1 ring-border" data-system={system.id} data-system-failing={error !== null || undefined}>
      <button type="button" className="grid min-w-0 flex-1 gap-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onOpen}>
        <span className="flex items-center gap-2 text-base font-semibold">
          <Truncate>{system.name}</Truncate>
          {latest !== null && <Badge>v{latest.n}</Badge>}
        </span>
        <span className="flex min-w-0 font-mono text-xs text-fg-muted">
          <Truncate>{system.root}</Truncate>
        </span>
        {latest !== null && (
          <span className="text-sm text-fg-muted" data-system-counts>
            {latest.components} components · {latest.stories} stories · {system.sessions === 1 ? "1 brainstorm" : `${system.sessions} brainstorms`} · {error === null ? "synced" : "last good sync"} {at(latest.syncedAt, now)}
            {warnings > 0 && <span className="text-warning"> · {warnings === 1 ? "1 warning" : `${warnings} warnings`}</span>}
          </span>
        )}
        {error !== null && (
          <span className="text-sm text-danger" data-system-sync-error>
            {`The sync ${at(error.at, now)} failed: ${firstError(error)}`}
          </span>
        )}
        {system.review?.state === "pending" && (
          <span className="text-sm font-medium text-info" data-system-awaiting>
            Awaiting your review. Brainstorms can use it once you confirm it.
          </span>
        )}
      </button>
      <span className="flex shrink-0 items-center gap-2">
        {system.review?.state === "pending" && (
          <Button variant="accent" onClick={onOpen} data-system-review={system.id}>
            <ListChecks data-icon="inline-start" aria-hidden />
            Review
          </Button>
        )}
        {error !== null && system.adapter && (
          <Button variant="accent" disabled={repairing} onClick={onRepair} data-system-repair={system.id}>
            {repairing ? <Spinner data-icon="inline-start" /> : <Wrench data-icon="inline-start" aria-hidden />}
            {repairing ? "Repairing…" : "Repair with an agent"}
          </Button>
        )}
        <Button variant="outline" disabled={syncing} onClick={onSync} data-system-sync={system.id}>
          {syncing ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" aria-hidden />}
          {syncing ? "Syncing…" : "Sync"}
        </Button>
      </span>
    </li>
  );
}

const firstError = (error: NonNullable<SystemListing["syncError"]>) => error.issues.find((i) => i.severity === "error")?.message ?? error.message;

/** When something happened, for a line that names it: "at 14:05" today, else "on 3 Nov". */
const at = (iso: string, now: number) => {
  const a = age(iso, now);
  return /^(now|d+[mh])$/.test(a) ? `at ${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : `on ${a}`;
};

/** `age` as the end of a sentence: nothing for a moment ago, else " 5m ago" or " on 3 Nov". */
const ago = (iso: string, now: number) => {
  const a = age(iso, now);
  return a === "now" ? "" : /^\d+[mhd]$/.test(a) ? ` ${a} ago` : ` on ${a}`;
};

function SystemDetail({
  api,
  id,
  revision,
  syncing,
  repairing,
  onSync,
  onRepair,
  onBack,
  showNotice,
}: {
  api: Api;
  id: SystemId;
  revision: number;
  syncing: boolean;
  repairing: boolean;
  onSync: () => void;
  onRepair: (root: string) => void;
  onBack: () => void;
  showNotice: (notice: Notice) => void;
}) {
  const now = useNow();
  const [view, setView] = useState<SystemView | null>(null);
  const [tab, setTab] = useState<Tab>("components");
  /** A component another tab opened, such as a warning's, which the Components tab starts on. */
  const [jump, setJump] = useState<string | null>(null);
  useEffect(() => void api.system(id).then((r) => r.ok && setView(r.data)), [api, id, syncing, revision]);
  const latest = view?.latest ?? null;
  const warnings = latest?.warnings ?? [];
  const error = view?.syncError ?? null;
  const review = view?.review?.state === "pending" ? view.review : null;
  /** Applies one review action and shows the system as it comes back. Resolves false when the server refused it. */
  const act = async (action: ReviewAction, failed: string): Promise<boolean> => {
    const r = await api.reviewSystem(id, action);
    if (!r.ok) {
      showNotice({ title: failed, detail: r.error.message });
      return false;
    }
    setView(r.data);
    if (action.kind === "confirm") showNotice({ title: `Confirmed v${r.data.latest?.n ?? 1}`, detail: `Brainstorms can use ${r.data.name} now.`, tone: "success" });
    return true;
  };
  return (
    <div className="flex size-full flex-col" data-system-detail={id}>
      <div className="flex flex-col gap-3 border-b bg-card px-6 pt-4">
        <div className="flex items-start gap-2">
          <Hint label="Design systems" side="bottom" align="start">
            <Button variant="ghost" size="icon" className="-ml-2 shrink-0" aria-label="Back to design systems" onClick={onBack} data-systems-back>
              <ArrowLeft aria-hidden />
            </Button>
          </Hint>
          <div className="min-w-0 flex-1">
            <PageHeader
              heading={view?.name ?? "Design system"}
              description={
                <span className="flex min-w-0 gap-x-2 font-mono text-xs">
                  <Truncate>{view?.source.adapter ?? view?.root ?? ""}</Truncate>
                  {latest !== null && <span className="shrink-0" data-system-hash>· {latest.hash.slice(0, 7)}</span>}
                </span>
              }
            />
          </div>
          {latest !== null && <Badge>v{latest.n}</Badge>}
          <Button variant="outline" disabled={syncing} onClick={onSync} data-system-sync={id}>
            {syncing ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" aria-hidden />}
            {syncing ? "Syncing…" : "Sync"}
          </Button>
        </div>
        {error !== null && (
          <Callout
            tone="danger"
            heading={`The sync ${at(error.at, now)} failed`}
            data-system-sync-failed
            actions={
              view?.adapter === true ? (
                <Button variant="accent" disabled={repairing} onClick={() => view !== null && onRepair(view.root)} data-system-repair={id}>
                  {repairing ? <Spinner data-icon="inline-start" /> : <Wrench data-icon="inline-start" aria-hidden />}
                  {repairing ? "Repairing in a T3 thread…" : "Repair with an agent"}
                </Button>
              ) : undefined
            }
          >
            <p>{firstError(error)}</p>
            <p>
              Nothing changed for brainstorms: each stays on the version it uses, and v{latest?.n ?? 1}, the last good one, is still the newest. Brainstorm syncs again when the project changes.
            </p>
          </Callout>
        )}
        {review !== null && view !== null && <ReviewCallout api={api} view={view} review={review} act={act} />}
        <div className="flex h-10 items-center">
          <Tabs<Tab>
            aria-label="Design system"
            value={tab}
            onValueChange={setTab}
            itemData="system-tab"
            tabs={[
              { value: "components", label: `Components${latest === null ? "" : ` ${latest.components}`}` },
              { value: "theme", label: "Theme" },
              { value: "versions", label: "Versions" },
              { value: "warnings", label: `Warnings${warnings.length === 0 ? "" : ` ${warnings.length}`}` },
            ]}
          />
        </div>
      </div>
      {view === null || view.manifest === null || latest === null ? (
        <div className="p-6">
          <Skeleton className="h-preview w-full" />
        </div>
      ) : tab === "components" ? (
        <ComponentsTab key={jump ?? ""} view={view} manifest={view.manifest} review={review} act={act} initialEntry={jump} />
      ) : tab === "theme" ? (
        <ThemeTab manifest={view.manifest} />
      ) : tab === "versions" ? (
        <VersionsTab view={view} />
      ) : (
        <WarningsTab
          warnings={warnings}
          components={new Set(view.manifest.catalog.map((e) => e.name))}
          onOpen={(name) => {
            setJump(name);
            setTab("components");
          }}
        />
      )}
    </div>
  );
}

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/**
 * Rob's review of a newly imported system (ADR 008), above the tabs while it's pending: what he has changed so far, the
 * issues he raised, and the two ways out, back to the agent or confirmed.
 */
function ReviewCallout({
  api,
  view,
  review,
  act,
}: {
  api: Api;
  view: SystemView;
  review: SystemReview;
  act: (action: ReviewAction, failed: string) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState<"send" | "confirm" | null>(null);
  const sent = review.sent;
  const work = useAgentWork(api, sent === null ? null : (review.thread?.id ?? null));
  const moves = Object.keys(review.tiers).length;
  const open = review.issues.length;
  const changes = moves + open;
  // A library added from its package has no adapter, so nothing has sorted its components into tiers yet.
  const unsorted = !view.adapter;
  const agentBusy = work?.phase === "waiting" || work?.phase === "working" || work?.phase === "asking";
  const run = async (kind: "send" | "confirm") => {
    setBusy(kind);
    await act({ kind }, kind === "send" ? "Couldn't send the review" : "Couldn't confirm the design system");
    setBusy(null);
  };
  const n = view.latest?.n ?? 1;
  // A version newer than the one the review went out at is the agent's.
  const since = sent?.version ?? null;
  const theirs = since === null ? [] : view.versions.filter((v) => v.n > since);
  const agentSynced = theirs.length > 0;
  // What's left to do decides the primary action: changes go to the agent first; an unsorted library goes to an agent
  // to sort; while the agent works on what Rob sent, nothing is primary; then Confirm is the way on.
  const sendFirst = changes > 0 || (unsorted && sent === null);
  const confirmFirst = !sendFirst && !(agentBusy && !agentSynced);
  return (
    <Callout
      tone="info"
      heading="Review this import before brainstorms use it"
      data-system-review-callout
      actions={
        <>
          {(changes > 0 || (unsorted && sent === null)) && (
            <Button variant={sendFirst ? "accent" : "outline"} disabled={busy !== null} onClick={() => void run("send")} data-review-send>
              {busy === "send" ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" aria-hidden />}
              {changes > 0 ? `Send ${count(changes, "change", "changes")} to the agent` : "Sort into tiers with an agent"}
            </Button>
          )}
          <Button variant={confirmFirst ? "accent" : "outline"} disabled={open > 0 || busy !== null} onClick={() => void run("confirm")} data-review-confirm>
            {busy === "confirm" ? <Spinner data-icon="inline-start" /> : <Check data-icon="inline-start" aria-hidden />}
            {busy === "confirm" ? "Confirming…" : `Confirm v${n}`}
          </Button>
          <RaiseIssue label="Raise a system issue" heading="An issue with the whole system" placeholder="DatePicker is missing" onRaise={(note) => act({ kind: "issue", name: null, note }, "Couldn't raise the issue")} />
        </>
      }
    >
      {sent === null && (
        <p>
          Step through the components with <Kbd>←</Kbd> <Kbd>→</Kbd> and check how each renders. Move one to another tier, or raise an issue for the agent. Brainstorms can use the system once you confirm it.
        </p>
      )}
      {unsorted && sent === null && <p>This library came from its package, so nothing sorted its components into tiers and they all list as primitives. Sort them yourself, or have an agent do it.</p>}
      {(moves > 0 || open > 0) && (
        <div className="grid gap-1" data-review-pending>
          {moves > 0 && <p>{count(moves, "tier change", "tier changes")}, written to the adapter when you send or confirm.</p>}
          {open > 0 && (
            <ul className="grid gap-1" data-review-issues>
              {review.issues.map((i) => (
                <IssueItem key={i.id} issue={i} onDrop={() => void act({ kind: "drop_issue", issue: i.id }, "Couldn't drop the issue")} />
              ))}
            </ul>
          )}
          {open > 0 && (
            <p className="font-medium" data-review-blocked>
              Confirm waits on {open === 1 ? "the open issue: send it to the agent or drop it" : `${open} open issues: send them to the agent or drop them`}.
            </p>
          )}
        </div>
      )}
      {sent !== null && (
        <div className="grid gap-2 rounded-md bg-card p-3 ring-1 ring-border" data-review-status>
          <AgentWorkStatus work={work} since={sent.at} link={review.thread?.link ?? null} />
          <SentItems sent={sent} />
          {open === 0 && moves === 0 && (
            <p className="text-sm text-fg-muted" data-review-next data-agent-synced={agentSynced || undefined}>
              {agentSynced
                ? `${agentBusy ? "The agent synced" : "The agent finished and synced"} v${n}: ${changeSummary(theirs)}. Check it in the walk, then confirm v${n}.`
                : work?.phase === "waiting"
                  ? `The agent hasn't started on it yet; its changes will come as v${n + 1}. Confirming v${n} now confirms it without them.`
                  : agentBusy
                  ? `The agent is on it; its changes will come as v${n + 1}. Confirming v${n} now confirms it without them.`
                  : work?.phase === "finished"
                    ? `The agent finished without a new version. Read its reply in T3, then confirm v${n} or raise what's left.`
                    : `Confirm v${n} once you're happy with it.`}
            </p>
          )}
        </div>
      )}
    </Callout>
  );
}

/** What the versions after a review changed, in one phrase: "MealCard renders differently; WeekStrip added". */
function changeSummary(versions: SystemView["versions"]): string {
  const joined = (list: readonly string[]) => (list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`);
  const each = (pick: (v: SystemView["versions"][number]) => readonly string[]) => [...new Set(versions.flatMap(pick))];
  const changed = each((v) => v.changed.map((c) => c.name));
  const added = each((v) => v.added);
  const removed = each((v) => v.removed);
  const moved = each((v) => v.retiered.map((r) => `${r.name} to ${TIER_LABEL[r.to].toLowerCase()}`));
  const stories = each((v) => v.newStories.flatMap((c) => c.stories.map((s) => `${c.name} › ${s}`)));
  const said = [
    changed.length === 0 ? null : `${joined(changed)} ${changed.length === 1 ? "renders" : "render"} differently`,
    added.length === 0 ? null : `${joined(added)} added`,
    removed.length === 0 ? null : `${joined(removed)} removed`,
    moved.length === 0 ? null : `moved ${joined(moved)}`,
    stories.length === 0 ? null : `new ${stories.length === 1 ? "story" : "stories"} ${joined(stories)}`,
  ].filter((x) => x !== null);
  return said.length === 0 ? "its stories render as before" : said.join("; ");
}

/** What the last Send handed the agent: Rob's notes, and the tier moves already in the adapter. */
function SentItems({ sent }: { sent: NonNullable<SystemReview["sent"]> }) {
  const moved = Object.entries(sent.moved);
  if (sent.notes.length === 0 && moved.length === 0) return <p className="text-sm text-fg-muted">Sent: sort the components into tiers.</p>;
  return (
    <ul className="grid gap-1 text-sm" data-review-sent>
      {sent.notes.map((n) => (
        <li key={`n${n.id}`} className="flex items-start gap-2" data-review-sent-note={n.id}>
          <Flag aria-hidden className="mt-0.5 size-3.5 shrink-0 text-fg-muted" />
          <span className="min-w-0">
            <span className="font-medium">{n.name ?? "The whole system"}:</span> {n.note}
          </span>
        </li>
      ))}
      {moved.map(([name, tier]) => (
        <li key={`m${name}`} className="flex items-start gap-2" data-review-sent-move={name}>
          <ArrowRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-fg-muted" />
          <span className="min-w-0">
            <span className="font-medium">{name}</span> moved to {TIER_LABEL[tier].toLowerCase()}, in the adapter
          </span>
        </li>
      ))}
    </ul>
  );
}

function IssueItem({ issue, onDrop }: { issue: ReviewIssue; onDrop: () => void }) {
  return (
    <CalloutItem>
      <span className="flex items-start gap-2" data-review-issue={issue.id}>
        <span className="min-w-0 flex-1">
          <span className="font-medium">{issue.name ?? "The whole system"}:</span> {issue.note}
        </span>
        <Button variant="ghost" size="xs" className="shrink-0" aria-label={`Drop the issue on ${issue.name ?? "the whole system"}`} onClick={onDrop} data-review-drop={issue.id}>
          <X data-icon="inline-start" aria-hidden />
          Drop
        </Button>
      </span>
    </CalloutItem>
  );
}

/** One component under review: its tier, the issues raised on it, and the way to the next one. */
function ReviewStrip({
  entry,
  tier,
  synced,
  issues,
  sent,
  act,
  previous,
  next,
  position,
  nextUnseen,
}: {
  entry: CatalogEntry;
  tier: Tier;
  /** The tier it synced with, which a move away from is staged. */
  synced: Tier;
  issues: readonly ReviewIssue[];
  /** Notes on it that went to the agent with the last Send. */
  sent: readonly ReviewIssue[];
  act: (action: ReviewAction, failed: string) => Promise<boolean>;
  previous: (() => void) | null;
  next: (() => void) | null;
  position: { n: number; of: number; seen: number } | null;
  /** Jumps past what Rob has seen, when the next unseen component isn't simply the next one. */
  nextUnseen: (() => void) | null;
}) {
  return (
    <div className="grid gap-2 border-b bg-card px-4 py-2" data-review-strip={entry.name}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-sm font-medium">{entry.name}</span>
        <div className="flex items-center gap-2 text-xs whitespace-nowrap text-fg-muted">
          Tier
          <Segmented<Tier>
            fit="content"
            aria-label={`${entry.name}'s tier`}
            value={tier}
            onValueChange={(t) => void act({ kind: "tier", name: entry.name, tier: t }, "Couldn't change the tier")}
            options={TIER_ORDER.map((t) => ({ value: t, label: TIER_LABEL[t] }))}
            itemData="review-tier"
          />
          {tier !== synced && <span data-review-moved>moved from {TIER_LABEL[synced].toLowerCase()}</span>}
        </div>
        <RaiseIssue label="Raise an issue" heading={`An issue with ${entry.name}`} placeholder="The price badge doesn't render" onRaise={(note) => act({ kind: "issue", name: entry.name, note }, "Couldn't raise the issue")} />
        <div className="ml-auto flex items-center gap-1 text-xs text-fg-muted">
          {position !== null && (
            <span className="tabular-nums" data-review-position>
              {`${position.n} of ${position.of}`}
              {position.of > 1 && <span className="text-fg-muted">{position.seen === position.of ? " · all seen" : ` · ${position.seen} seen`}</span>}
            </span>
          )}
          <Hint label="Previous component" shortcut="←" side="bottom">
            <Button variant="ghost" size="xs" disabled={previous === null} onClick={() => previous?.()} data-review-previous>
              <ChevronLeft data-icon="inline-start" aria-hidden />
              Previous
            </Button>
          </Hint>
          <Hint label="Next component" shortcut="→" side="bottom" align="end">
            <Button variant="ghost" size="xs" disabled={next === null} onClick={() => next?.()} data-review-next>
              Next
              <ChevronRight data-icon="inline-end" aria-hidden />
            </Button>
          </Hint>
          {nextUnseen !== null && (
            <Button variant="ghost" size="xs" onClick={nextUnseen} data-review-next-unseen>
              Next unseen
              <ChevronsRight data-icon="inline-end" aria-hidden />
            </Button>
          )}
        </div>
      </div>
      {issues.length + sent.length > 0 && (
        <ul className="grid gap-1 text-sm">
          {sent.map((i) => (
            <li key={`s${i.id}`} className="flex items-start gap-2 text-fg-muted" data-review-sent-issue={i.id}>
              <Send aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                {i.note} <span className="text-xs">· with the agent</span>
              </span>
            </li>
          ))}
          {issues.map((i) => (
            <li key={i.id} className="flex items-start gap-2" data-review-issue={i.id}>
              <Flag aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <span className="min-w-0 flex-1">{i.note}</span>
              <Button variant="ghost" size="icon-xs" aria-label="Drop the issue" onClick={() => void act({ kind: "drop_issue", issue: i.id }, "Couldn't drop the issue")} data-review-drop={i.id}>
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const TIER_LABEL: Readonly<Record<Tier, string>> = { layout: "Layout", composite: "Composite", primitive: "Primitive" };

/** A note for the agent, on one component or on the whole system. */
function RaiseIssue({ label, heading, placeholder, onRaise }: { label: string; heading: string; placeholder: string; onRaise: (note: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const raise = async () => {
    if (note.trim() === "") return;
    if (!(await onRaise(note.trim()))) return;
    setOpen(false);
    setNote("");
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="xs" data-review-raise />}>
        <Flag data-icon="inline-start" aria-hidden />
        {label}
      </PopoverTrigger>
      <PopoverContent size="md" align="start">
        <PopoverHeader heading={heading} description="The agent gets it with the rest of your review, and fixes the adapter or the stories." />
        <Textarea
          aria-label="Issue"
          placeholder={placeholder}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && void raise()}
          autoFocus
          data-review-note
        />
        <PopoverFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="accent" disabled={note.trim() === ""} onClick={() => void raise()} data-review-raise-confirm>
            Raise issue
          </Button>
        </PopoverFooter>
      </PopoverContent>
    </Popover>
  );
}

type Manifest = NonNullable<SystemView["manifest"]>;

const DEFAULT_AXIS = "__default";

const TIER_HEADING: Readonly<Record<Tier, string>> = { layout: "Layouts", composite: "Composites", primitive: "Primitives" };
const TIER_ORDER: readonly Tier[] = ["layout", "composite", "primitive"];
const tierOf = (e: CatalogEntry): Tier => e.tier ?? "primitive";

/**
 * Components whose name starts with the search come first, then names that contain it, then those with a matching
 * story or part. Within each, a component with a story to show leads one without.
 */
function searchCatalog(catalog: readonly CatalogEntry[], needle: string, storyNames: ReadonlyMap<string, string>): CatalogEntry[] {
  const rank = (e: CatalogEntry) => {
    const name = e.name.toLowerCase();
    if (name.startsWith(needle)) return 0;
    if (name.includes(needle)) return 1;
    if (e.stories.some((id) => storyNames.get(id)?.toLowerCase().includes(needle))) return 2;
    return e.parts.some((p) => partMatches(p, needle)) ? 3 : null;
  };
  const shows = (e: CatalogEntry) => (e.stories.length > 0 ? 0 : 1);
  return catalog
    .map((e) => ({ e, r: rank(e) }))
    .filter((x): x is { e: CatalogEntry; r: number } => x.r !== null)
    .sort((a, b) => a.r - b.r || shows(a.e) - shows(b.e))
    .map((x) => x.e);
}

/** The catalog in sections: the library's components by tier, most composed first, then Brainstorm's primitives. */
function catalogSections(entries: readonly CatalogEntry[], tier: (e: CatalogEntry) => Tier = tierOf): { heading: string; entries: CatalogEntry[] }[] {
  const own = entries.filter((e) => !e.generated);
  return [
    ...TIER_ORDER.map((t) => ({ heading: TIER_HEADING[t], entries: own.filter((e) => tier(e) === t) })),
    { heading: "Brainstorm's", entries: entries.filter((e) => e.generated) },
  ].filter((s) => s.entries.length > 0);
}

const WIDTHS = [
  { value: "fill", label: "Fill" },
  { value: "1280", label: "1280" },
  { value: "768", label: "768" },
  { value: "390", label: "390" },
] as const;
type WidthChoice = (typeof WIDTHS)[number]["value"];

function ComponentsTab({
  view,
  manifest,
  review,
  act,
  initialEntry = null,
}: {
  view: SystemView;
  manifest: Manifest;
  /** Rob's review while the import awaits it (ADR 008), else null. */
  review: SystemReview | null;
  act: (action: ReviewAction, failed: string) => Promise<boolean>;
  initialEntry?: string | null;
}) {
  // A review walks the components in the order it first showed them, so neither Rob's moves nor the agent's next
  // version reorder the walk under him. A component a later version adds joins the end.
  const firstOrder = useRef<readonly string[] | null>(null);
  const walk = useMemo(() => {
    const now = catalogSections(manifest.catalog)
      .filter((s) => s.heading !== "Brainstorm's")
      .flatMap((s) => s.entries);
    firstOrder.current ??= now.map((e) => e.name);
    const rank = new Map(firstOrder.current.map((name, i) => [name, i]));
    return [...now].sort((a, b) => (rank.get(a.name) ?? Infinity) - (rank.get(b.name) ?? Infinity));
  }, [manifest]);
  // A review starts on the first component, so Rob can step through them; otherwise the gallery shows every story.
  const [entry, setEntry] = useState<string | null>(() => initialEntry ?? (review === null ? null : (walk[0]?.name ?? null)));
  const shown = (e: CatalogEntry): Tier => review?.tiers[e.name] ?? tierOf(e);
  /** The components Rob has stepped onto in this review, so a long walk shows how far he has got. */
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (review === null || entry === null) return;
    setSeen((prev) => (prev.has(entry) ? prev : new Set([...prev, entry])));
  }, [review === null, entry]);
  const [axes, setAxes] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  /** The story open in the workbench, with the args Rob changed and the width he picked. */
  const [focus, setFocus] = useState<{ id: string; args: Record<string, Json>; width: WidthChoice } | null>(null);
  const needle = query.trim().toLowerCase();
  const storyNames = useMemo(() => new Map(manifest.stories.map((s) => [s.id, s.name])), [manifest]);
  const components = useMemo(() => Object.fromEntries(manifest.catalog.flatMap((e) => e.stories.map((id) => [id, e.name]))), [manifest]);
  const entries = needle === "" ? manifest.catalog : searchCatalog(manifest.catalog, needle, storyNames);
  const chosen = entries.find((e) => e.name === entry) ?? null;
  const sections = needle === "" ? catalogSections(entries, shown) : [{ heading: "", entries: [...entries] }];
  // The gallery follows the catalog's order: by tier, or a search's best matches first. A search narrows it too, until
  // Rob picks one component from it.
  const stories = chosen !== null ? chosen.stories : sections.flatMap((s) => s.entries.flatMap((e) => e.stories));
  const latest = view.latest;
  const story = focus === null ? null : (manifest.stories.find((s) => s.id === focus.id) ?? null);
  const owner = story === null ? null : (manifest.catalog.find((e) => e.stories.includes(story.id)) ?? null);
  const pick = (name: string | null) => {
    setEntry(name);
    setFocus(null);
  };
  // Opening a story picks its component too, so the catalog lists the component's other stories beside it.
  const openStory = (id: string) => {
    const of = manifest.catalog.find((e) => e.stories.includes(id));
    if (of !== undefined) setEntry(of.name);
    setFocus({ id, args: {}, width: "fill" });
  };
  const issuesOn = (name: string) => review?.issues.filter((i) => i.name === name) ?? [];
  const sentOn = (name: string) => review?.sent?.notes.filter((i) => i.name === name) ?? [];
  const rowDetail = (e: CatalogEntry, base: string) =>
    [
      review?.tiers[e.name] !== undefined ? "moved" : null,
      issuesOn(e.name).length > 0 ? count(issuesOn(e.name).length, "issue", "issues") : sentOn(e.name).length > 0 ? "sent" : null,
      base,
    ]
      .filter((x) => x !== null && x !== "")
      .join(" · ");
  const at = chosen === null ? -1 : walk.findIndex((e) => e.name === chosen.name);
  const step = (by: -1 | 1) => {
    const to = walk[at + by];
    if (at >= 0 && to !== undefined) pick(to.name);
  };
  // The first component after this one that Rob hasn't stepped onto yet, wrapping round; null once he has seen them all.
  const unseen = [...walk.slice(at + 1), ...walk.slice(0, Math.max(at, 0))].find((e) => !seen.has(e.name)) ?? null;
  // ← and → walk the review, and / finds a component, wherever focus is but in a field or a control that takes arrows.
  const keys = useRef({ step, review });
  keys.current = { step, review };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, textarea, select, [contenteditable], [role=radiogroup], [role=tablist], [role=listbox], [role=dialog], [role=menu]") != null) return;
      if (e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      } else if (keys.current.review !== null && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        keys.current.step(e.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="flex min-h-0 flex-1">
      {/* The catalog takes the Inspector's width, so the stories get the rest. flex-none beats ScrollPane's flex-1. */}
      <div className="flex w-inspector flex-none flex-col border-r bg-card" data-catalog>
        <div className="relative px-4 pt-3">
          <Input
            ref={search}
            type="search"
            placeholder="Search components and stories"
            aria-label="Search components"
            aria-keyshortcuts="/"
            className="pr-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (setQuery(""), e.currentTarget.blur())}
            data-catalog-search
          />
          {query === "" && (
            <span className="pointer-events-none absolute top-1/2 right-6 mt-1.5 -translate-y-1/2">
              <Kbd>/</Kbd>
            </span>
          )}
        </div>
        <ScrollPane inset={4}>
          <div className="grid gap-3 py-3">
            {needle === "" && (
              <ul className="grid gap-0.5">
                <CatalogRow label="All stories" detail={`${manifest.stories.length}`} active={entry === null && focus === null} onClick={() => pick(null)} />
              </ul>
            )}
            {sections.map((s) => (
              <section key={s.heading} className="grid gap-0.5" data-catalog-tier={s.heading || undefined}>
                {s.heading !== "" && (
                  <h3 className="flex items-center gap-2 px-2 pb-1 text-xs font-medium text-fg-muted">
                    {s.heading}
                    <span className="font-normal tabular-nums">{s.entries.length}</span>
                  </h3>
                )}
                <ul className="grid gap-0.5">
                  {s.entries.map((e) => (
                    <Fragment key={e.name}>
                      <CatalogRow
                        label={e.name}
                        match={needle}
                        via={matchedPart(e, needle, storyNames)}
                        detail={rowDetail(e, s.heading === "" ? entryDetail(e) : sectionDetail(e))}
                        active={entry === e.name && focus === null}
                        onClick={() => pick(e.name)}
                        data-entry={e.name}
                      />
                      {/* The picked component's stories, as Storybook nests them, each opening in the workbench. */}
                      {entry === e.name &&
                        e.stories.map((id) => (
                          <CatalogRow key={id} label={storyNames.get(id) ?? id} detail="" nested active={focus?.id === id} onClick={() => openStory(id)} data-entry-story={id} />
                        ))}
                    </Fragment>
                  ))}
                </ul>
              </section>
            ))}
            {entries.length === 0 && <p className="px-2 py-1.5 text-sm text-fg-muted">No component matches "{query.trim()}"</p>}
          </div>
        </ScrollPane>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {(manifest.styles.axes.length > 0 || focus !== null) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-card px-4 py-2" data-gallery-bar>
            {focus !== null && story !== null && (
              <div className="flex min-w-0 items-center gap-2" data-workbench-head>
                <Button variant="ghost" size="xs" onClick={() => setFocus(null)} data-workbench-back>
                  <ArrowLeft data-icon="inline-start" aria-hidden />
                  {chosen?.name ?? "All stories"}
                </Button>
                <span className="flex min-w-0 text-sm font-medium">
                  <Truncate>{`${owner?.name ?? story.title} · ${story.name}`}</Truncate>
                </span>
                {Object.keys(focus.args).length > 0 && (
                  <span className="shrink-0 text-xs text-fg-muted" data-workbench-edited>
                    edited
                  </span>
                )}
                {owner !== null && !owner.generated && <Badge data-workbench-tier>{shown(owner)}</Badge>}
              </div>
            )}
            {manifest.styles.axes.map((a) => (
              <div key={a.attribute} className="flex items-center gap-2 text-xs whitespace-nowrap text-fg-muted">
                {axisLabel(a.attribute)}
                <Segmented
                  fit="content"
                  aria-label={axisLabel(a.attribute)}
                  value={axes[a.attribute] ?? DEFAULT_AXIS}
                  onValueChange={(v) => setAxes((prev) => ({ ...prev, [a.attribute]: v }))}
                  options={axisOptions(a, DEFAULT_AXIS)}
                />
              </div>
            ))}
            {focus !== null && (
              <div className="flex items-center gap-2 text-xs whitespace-nowrap text-fg-muted">
                Width
                <Segmented<WidthChoice>
                  fit="content"
                  aria-label="Width"
                  value={focus.width}
                  onValueChange={(width) => setFocus((f) => (f === null ? f : { ...f, width }))}
                  options={WIDTHS}
                  itemData="workbench-width"
                />
              </div>
            )}
          </div>
        )}
        {review !== null && chosen !== null && !chosen.generated && (
          <ReviewStrip
            key={chosen.name}
            entry={chosen}
            tier={shown(chosen)}
            synced={tierOf(chosen)}
            issues={issuesOn(chosen.name)}
            sent={sentOn(chosen.name)}
            act={act}
            previous={at > 0 ? () => step(-1) : null}
            next={at >= 0 && at < walk.length - 1 ? () => step(1) : null}
            position={at < 0 ? null : { n: at + 1, of: walk.length, seen: walk.filter((e) => seen.has(e.name)).length }}
            nextUnseen={unseen === null || unseen.name === walk[at + 1]?.name ? null : () => pick(unseen.name)}
          />
        )}
        {focus === null && chosen !== null && chosen.stories.length === 0 && (
          <p className="px-4 py-3 text-sm text-fg-muted">
            {chosen.generated ? "Brainstorm made this one, since the library has none by this name. Blocks use it for layout and text." : "This component has no story, so there's nothing to show."}
          </p>
        )}
        <div className="flex min-h-0 flex-1">
          {latest !== null && (
            <GalleryFrame
              id={view.id}
              n={latest.n}
              stories={stories}
              focus={focus === null ? null : { id: focus.id, args: focus.args, width: focus.width === "fill" ? null : Number(focus.width) }}
              onOpenStory={openStory}
              components={components}
              theme={{ axes: Object.fromEntries(Object.entries(axes).filter(([, v]) => v !== DEFAULT_AXIS)), tokens: {} }}
            />
          )}
          {focus !== null && story !== null && (
            <Workbench
              key={story.id}
              story={story}
              owner={owner}
              siblings={owner === null ? [story] : manifest.stories.filter((s) => owner.stories.includes(s.id))}
              overrides={focus.args}
              onChange={(args) => setFocus((f) => (f === null ? f : { ...f, args }))}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** The story or part a search matched when the component's own name doesn't, so Breadcrumb shows why "st" found it. */
const matchedPart = (e: CatalogEntry, needle: string, storyNames: ReadonlyMap<string, string>) => {
  if (needle === "" || e.name.toLowerCase().includes(needle)) return undefined;
  const story = e.stories.map((id) => storyNames.get(id) ?? "").find((n) => n.toLowerCase().includes(needle));
  return story !== undefined ? `› ${story}` : e.parts.find((p) => partMatches(p, needle));
};

/** A sub-component matches where one of its words starts with the search, so "st" finds StackItem, not BreadcrumbList. */
const partMatches = (part: string, needle: string) => part.split(/(?=[A-Z])/).some((w) => w.toLowerCase().startsWith(needle)) || part.toLowerCase().startsWith(needle);

/** `text` with the first stretch that has the search's words marked, as Storybook marks its matches. */
function Marked({ text, match }: { text: string; match: string }) {
  const at = match === "" ? -1 : text.toLowerCase().indexOf(match);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-transparent font-semibold text-accent" data-catalog-match>
        {text.slice(at, at + match.length)}
      </mark>
      {text.slice(at + match.length)}
    </>
  );
}

const entryDetail = (e: CatalogEntry) => (e.generated ? "Brainstorm's" : e.stories.length === 0 ? "no story" : `${e.stories.length}`);
/** Under a Brainstorm's heading the row needn't say so again. */
const sectionDetail = (e: CatalogEntry) => (e.generated ? "" : entryDetail(e));

function CatalogRow({
  label,
  match = "",
  via,
  detail,
  active,
  nested = false,
  onClick,
  ...data
}: {
  label: string;
  /** The search, marked where the label matches it. */
  match?: string;
  via?: string | undefined;
  detail: string;
  active: boolean;
  /** A story under its component. */
  nested?: boolean;
  onClick: () => void;
  [attr: `data-${string}`]: unknown;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={active || undefined}
        onClick={onClick}
        className={cn(
          "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring aria-current:bg-selected aria-current:font-medium",
          nested && "pl-6 text-fg-muted aria-current:text-fg",
        )}
        {...data}
      >
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="flex min-w-0 shrink-0">{match === "" ? <Truncate>{label}</Truncate> : <span className="min-w-0 truncate"><Marked text={label} match={match} /></span>}</span>
          {via !== undefined && (
            <span className="flex min-w-0 text-xs text-fg-muted" data-catalog-via>
              <span className="min-w-0 truncate">
                <Marked text={via} match={match} />
              </span>
            </span>
          )}
        </span>
        <span className="shrink-0 text-xs text-fg-muted">{detail}</span>
      </button>
    </li>
  );
}

/** What sync describes in place of a value the workbench can't show or edit: a function, an element, a deep value. */
const OPAQUE = new Set(["[function]", "[element]", "[value]"]);

type ArgRow = { readonly name: string; readonly value: unknown; readonly type: ArgType | null; readonly control: "text" | "number" | "boolean" | "select" | null };

/** Every arg the story sets or describes, with the control that edits it, from its `argTypes` or else its value. */
function argRows(story: StoryInfo): ArgRow[] {
  const args = (typeof story.args === "object" && story.args !== null ? story.args : {}) as Record<string, unknown>;
  const types = story.argTypes ?? {};
  const names = [...new Set([...Object.keys(args), ...Object.keys(types)])];
  return names.map((name) => {
    const value = args[name];
    const type = types[name] ?? null;
    const inferred =
      typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : typeof value === "string" && !OPAQUE.has(value) ? "text" : null;
    return { name, value, type, control: type?.control ?? (type?.options != null ? "select" : inferred) };
  });
}

/** Each prop any of the stories sets or describes, once, with the first value a story gives it. */
function propRows(stories: readonly StoryInfo[]): ArgRow[] {
  const seen = new Map<string, ArgRow>();
  for (const row of stories.flatMap(argRows)) {
    const had = seen.get(row.name);
    if (had === undefined) seen.set(row.name, row);
    else if (had.value === undefined || (had.type === null && row.type !== null)) seen.set(row.name, { ...had, value: had.value ?? row.value, type: had.type ?? row.type });
  }
  return [...seen.values()];
}

/** A story's value as an example, or null for one that can't be written plainly. */
const exampleText = (value: unknown): string | null =>
  value === undefined || value === null || (typeof value === "string" && OPAQUE.has(value)) || typeof value === "object" ? null : JSON.stringify(value);

const typeText = (row: ArgRow): string => {
  if (row.type?.options != null) return row.type.options.map((o) => JSON.stringify(o)).join(" | ");
  const v = row.value;
  if (v === "[function]") return "function";
  if (v === "[element]") return "element";
  if (Array.isArray(v)) return "array";
  if (v === null || v === undefined) return row.control === "number" ? "number" : row.control === "boolean" ? "boolean" : "—";
  return typeof v === "object" ? "object" : typeof v;
};

/** The JSX for a story as the workbench has it set: its args with Rob's changes, minus what can't be written as JSX. */
export function usageSnippet(name: string, args: Readonly<Record<string, unknown>>): string {
  const attrs: string[] = [];
  let children: string | null = null;
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || (typeof value === "string" && OPAQUE.has(value))) continue;
    if (key === "children") {
      if (typeof value === "string" || typeof value === "number") children = String(value);
      continue;
    }
    if (typeof value === "string") attrs.push(`${key}=${JSON.stringify(value)}`);
    else if (value === true) attrs.push(key);
    else attrs.push(`${key}={${JSON.stringify(value)}}`);
  }
  const oneLine = [name, ...attrs].join(" ");
  const open = oneLine.length <= 64 ? oneLine : [name, ...attrs.map((a) => `  ${a}`)].join("\n");
  const close = oneLine.length <= 64 ? "" : "\n";
  if (children === null) return `<${open}${close} />`;
  // The Usage pane is narrow, so text that would wrap mid-phrase gets its own line between the tags.
  const flat = `<${open}${close}>${children}</${name}>`;
  return close === "" && flat.length <= 36 ? flat : `<${open}${close}>
  ${children}
</${name}>`;
}

/** The workbench beside one story: its args as live controls, its component's props, and the JSX to use it (ADR 008). */
function Workbench({
  story,
  owner,
  siblings,
  overrides,
  onChange,
}: {
  story: StoryInfo;
  owner: CatalogEntry | null;
  /** Every story of the component, whose args together describe its props. */
  siblings: readonly StoryInfo[];
  overrides: Readonly<Record<string, Json>>;
  onChange: (args: Record<string, Json>) => void;
}) {
  const rows = useMemo(() => argRows(story), [story]);
  const props = useMemo(() => propRows([story, ...siblings.filter((s) => s.id !== story.id)]), [story, siblings]);
  const [copied, setCopied] = useState(false);
  const base = (typeof story.args === "object" && story.args !== null ? story.args : {}) as Record<string, unknown>;
  const current = { ...base, ...overrides };
  const name = story.component ?? owner?.name ?? story.title.split("/").at(-1) ?? "Component";
  const snippet = `import { ${name} } from "kit";\n\n${usageSnippet(name, current)}`;
  // Setting a control back to the story's own value isn't a change, so it leaves the overrides and the count.
  const set = (key: string, value: Json) => {
    const { [key]: _was, ...rest } = overrides;
    onChange(JSON.stringify(value) === JSON.stringify(base[key]) ? rest : { ...rest, [key]: value });
  };
  const changed = Object.keys(overrides).length;
  return (
    <aside className="flex w-inspector flex-none flex-col border-l bg-card" data-workbench>
      <ScrollPane inset={4}>
        <div className="grid gap-5 py-4">
          <section className="grid gap-2" data-workbench-controls>
            <h3 className="flex items-center gap-2 text-sm font-medium">
              Controls
              {changed > 0 && (
                <Button variant="ghost" size="xs" className="ml-auto" onClick={() => onChange({})} data-workbench-reset>
                  <RotateCcw data-icon="inline-start" aria-hidden />
                  Reset {changed === 1 ? "1 change" : `${changed} changes`}
                </Button>
              )}
            </h3>
            {rows.length === 0 ? (
              <p className="text-sm text-fg-muted">This story sets no args, so there's nothing to change here.</p>
            ) : (
              <ul className="grid gap-2">
                {rows.map((row) => (
                  <li key={row.name} className="grid gap-1" data-control={row.name}>
                    <span className="flex items-baseline gap-2 font-mono text-xs">
                      {row.name}
                      {row.name in overrides && <span className="font-sans text-fg-muted">changed</span>}
                    </span>
                    <ArgControl row={row} value={current[row.name]} onChange={(v) => set(row.name, v)} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="grid gap-2" data-workbench-props>
            <h3 className="text-sm font-medium">Props</h3>
            {props.length === 0 ? (
              <p className="text-sm text-fg-muted">Its stories name none. The library's source has them.</p>
            ) : (
              <ul className="grid grid-cols-1 rounded-md ring-1 ring-border">
                {props.map((row) => (
                  <li key={row.name} className="grid gap-0.5 border-t px-3 py-2 first:border-t-0" data-prop={row.name}>
                    <span className="flex items-baseline gap-2">
                      <span className="font-mono text-xs">{row.name}</span>
                      <span className="ml-auto min-w-0 font-mono text-xs break-words text-fg-muted">{typeText(row)}</span>
                    </span>
                    {row.type?.description != null && <span className="text-xs text-fg-muted">{row.type.description}</span>}
                    {exampleText(row.value) !== null && <span className="text-xs text-fg-muted">e.g. <span className="font-mono">{exampleText(row.value)}</span></span>}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-fg-muted">
              From {siblings.length <= 1 ? "this story" : `its ${siblings.length} stories`}, with the first value one sets. A prop no story sets isn't listed.
            </p>
          </section>
          <section className="grid gap-2" data-workbench-usage>
            <h3 className="flex items-center gap-2 text-sm font-medium">
              Usage
              <Button
                variant="ghost"
                size="xs"
                className="ml-auto"
                onClick={() =>
                  void navigator.clipboard.writeText(snippet).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  })
                }
                data-workbench-copy
              >
                {copied ? <Check data-icon="inline-start" aria-hidden /> : <Copy data-icon="inline-start" aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </h3>
            <pre className="rounded-md bg-muted p-3 font-mono text-xs break-words whitespace-pre-wrap" data-workbench-snippet>
              {snippet}
            </pre>
          </section>
        </div>
      </ScrollPane>
    </aside>
  );
}

function ArgControl({ row, value, onChange }: { row: ArgRow; value: unknown; onChange: (value: Json) => void }) {
  if (row.control === "boolean") return <Switch checked={value === true} onCheckedChange={(checked) => onChange(checked)} aria-label={row.name} />;
  if (row.control === "select" && row.type?.options != null) {
    const options = row.type.options.map((o) => ({ value: JSON.stringify(o), label: String(o) }));
    return (
      <Select items={options} value={JSON.stringify(value ?? null)} onValueChange={(v) => v !== null && onChange(JSON.parse(v) as Json)}>
        <SelectTrigger aria-label={row.name} className="w-full" data-control-select={row.name}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    );
  }
  if (row.control === "number") {
    return <Input type="number" aria-label={row.name} value={typeof value === "number" ? value : ""} onChange={(e) => e.target.value !== "" && onChange(Number(e.target.value))} />;
  }
  if (row.control === "text") return <Input aria-label={row.name} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />;
  return <span className="font-mono text-xs break-words text-fg-muted">{typeof value === "string" ? `${value}, set by the story` : `${JSON.stringify(value)}, set by the story`}</span>;
}

/** The kit's stories, rendered in a canvas frame of their own, so they run as blocks do: sandboxed, with the kit's CSS. */
function GalleryFrame({
  id,
  n,
  stories,
  focus,
  onOpenStory,
  theme,
  components,
}: {
  components: Readonly<Record<string, string>>;
  id: SystemId;
  n: SystemView["versions"][number]["n"];
  stories: readonly string[] | null;
  focus: GalleryFocus | null;
  onOpenStory: (id: string) => void;
  theme: ThemeState;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const post = (m: HostToFrame) => frame.current?.contentWindow?.postMessage(m, "*");
  const open = useRef(onOpenStory);
  open.current = onOpenStory;
  useEffect(() => {
    const receive = (e: MessageEvent) => {
      if (frame.current === null || e.source !== frame.current.contentWindow) return;
      const message = e.data as FrameToHost;
      if (message.kind === "open_story") return open.current(message.id);
      if (message.kind !== "ready") return;
      setReady(false);
      void kitFor(id, n).then((kit) => {
        if (kit === null) return;
        post({ kind: "kit", kit });
        setReady(true);
      });
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [id, n]);
  const themeKey = JSON.stringify(theme);
  useEffect(() => {
    if (ready) post({ kind: "theme", theme });
  }, [ready, themeKey]);
  const storyKey = JSON.stringify([stories, focus]);
  useEffect(() => {
    if (ready) post({ kind: "gallery", stories, focus, components });
  }, [ready, storyKey, components]);
  return (
    <div className="relative min-h-0 min-w-0 flex-1" data-gallery={ready || undefined} data-gallery-focused={focus?.id}>
      <iframe ref={frame} title="Stories" src="/canvas" sandbox="allow-scripts" className="block size-full border-0" />
    </div>
  );
}

function ThemeTab({ manifest }: { manifest: Manifest }) {
  const axes = manifest.styles.axes;
  // The first axis (light or dark, as a rule) gets a column per value, so Rob compares them side by side; the others
  // are switches above, as the gallery has them.
  const main = axes[0] ?? null;
  const rest = axes.slice(1);
  const [picked, setPicked] = useState<Record<string, string>>({});
  // Tokens the library declares with a value Rob can read; internal plumbing such as scroll-fade sizes is left out.
  const tokens = useMemo(() => manifest.styles.tokens.filter((t) => t.origin === "system" && t.kind !== "other" && t.value !== ""), [manifest]);
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const shownTokens = needle === "" ? tokens : tokens.filter((t) => t.name.toLowerCase().includes(needle));
  const colours = shownTokens.filter((t) => t.kind === "color");
  const others = shownTokens.filter((t) => t.kind !== "color");
  const columns = main === null ? [{ value: DEFAULT_AXIS, label: "Value" }] : axisOptions(main, DEFAULT_AXIS);
  const valueOf = (t: (typeof tokens)[number], column: string) => {
    let value = t.value;
    for (const [attribute, v] of Object.entries(picked)) if (v !== DEFAULT_AXIS) value = t.byAxis[`${attribute}=${v}`] ?? value;
    return main === null || column === DEFAULT_AXIS ? value : (t.byAxis[`${main.attribute}=${column}`] ?? value);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {rest.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-card px-6 py-2">
          {rest.map((a) => (
            <div key={a.attribute} className="flex items-center gap-2 text-xs whitespace-nowrap text-fg-muted" data-theme-tab-axis={a.attribute}>
              {axisLabel(a.attribute)}
              <Segmented
                fit="content"
                aria-label={axisLabel(a.attribute)}
                value={picked[a.attribute] ?? DEFAULT_AXIS}
                onValueChange={(v) => setPicked((prev) => ({ ...prev, [a.attribute]: v }))}
                options={axisOptions(a, DEFAULT_AXIS)}
                itemData="theme-tab-value"
              />
            </div>
          ))}
        </div>
      )}
      <ScrollPane inset={6} data-system-theme>
        <div className="grid max-w-sheet gap-6 py-6">
          <p className="text-sm text-fg-muted">
            {main === null
              ? "The library sets its tokens once, on the root."
              : `The library's tokens in each ${axisLabel(main.attribute).toLowerCase()}; a value the same as the first column's is dimmed.`}{" "}
            A brainstorm tweaks these for itself in its Inspector.
          </p>
          <Input
            aria-label="Filter tokens"
            className="max-w-picker"
            placeholder={`Filter ${tokens.length} tokens`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setFilter("")}
            data-token-filter
          />
          {shownTokens.length === 0 && <p className="text-sm text-fg-muted">No token has “{filter.trim()}” in its name.</p>}
          {[
            ["Colours", colours],
            ["Sizes and type", others],
          ].map(([heading, list]) =>
            (list as typeof tokens).length === 0 ? null : (
              <section key={heading as string} className="grid gap-2">
                <h3 className="flex items-center gap-2 text-sm font-medium">
                  {heading as string}
                  <span className="text-xs font-normal text-fg-muted tabular-nums">{(list as typeof tokens).length}</span>
                </h3>
                <table className="w-full table-fixed rounded-md bg-card text-xs ring-1 ring-border">
                  <thead>
                    <tr className="text-left text-fg-muted">
                      <th className="px-3 py-2 font-normal">Token</th>
                      {columns.map((c) => (
                        <th key={c.value} className="px-3 py-2 font-normal" data-theme-column={c.value}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(list as typeof tokens).map((t) => {
                      const first = valueOf(t, DEFAULT_AXIS);
                      return (
                        <tr key={t.name} className="border-t" data-token-row={t.name}>
                          <td className="px-3 py-2 font-mono">
                            <span className="flex min-w-0">
                              <Truncate>{t.name}</Truncate>
                            </span>
                          </td>
                          {columns.map((c, i) => {
                            const value = valueOf(t, c.value);
                            return (
                              <td key={c.value} className={cn("px-3 py-2 font-mono", i > 0 && value === first && "text-fg-muted")}>
                                <span className="flex min-w-0 items-center gap-2">
                                  {t.kind === "color" && <span aria-hidden className="size-5 shrink-0 rounded-sm ring-1 ring-border-strong" style={{ background: value }} />}
                                  <Truncate>{value}</Truncate>
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            ),
          )}
        </div>
      </ScrollPane>
    </div>
  );
}

function VersionsTab({ view }: { view: SystemView }) {
  const now = useNow();
  const latest = Math.max(...view.versions.map((v) => v.n));
  return (
    <ScrollPane inset={6}>
      <ul className="grid gap-2 py-6" data-system-versions>
        {view.versions.map((v) => (
          <li key={v.n} className="flex items-center gap-3 rounded-md bg-card p-3 text-sm ring-1 ring-border" data-version={v.n} data-version-latest={v.n === latest || undefined}>
            <Badge>v{v.n}</Badge>
            <span className="shrink-0 font-mono text-xs text-fg-muted" data-version-hash>
              {v.hash.slice(0, 7)}
            </span>
            <span className="grid min-w-0 gap-0.5">
              <span className="text-fg-muted">
                {v.components} components · {v.stories} stories{v.failedStories > 0 ? ` (${v.failedStories} didn't render)` : ""}
                {v.n === latest && " · latest"}
              </span>
              {(v.added.length > 0 || v.removed.length > 0 || v.changed.length > 0 || v.retiered.length > 0 || v.newStories.length > 0) && (
                <span className="grid gap-0.5 text-xs" data-version-changes>
                  {v.added.length > 0 && <ChangeLine label="Added" names={v.added} className="text-success" />}
                  {v.removed.length > 0 && <ChangeLine label="Removed" names={v.removed} className="text-danger" />}
                  {v.changed.length > 0 && (
                    <ChangeLine label="Renders differently" names={v.changed.map((c) => c.name)} className="text-fg" data="version-changed" />
                  )}
                  {v.newStories.length > 0 && (
                    <ChangeLine label="New stories" names={v.newStories.flatMap((c) => c.stories.map((s) => `${c.name} › ${s}`))} className="text-fg" />
                  )}
                  {v.retiered.length > 0 && (
                    <ChangeLine label="Tier" names={v.retiered.map((r) => `${r.name} ${TIER_LABEL[r.from].toLowerCase()} → ${TIER_LABEL[r.to].toLowerCase()}`)} className="text-fg" />
                  )}
                </span>
              )}
              {v.tokens.length > 0 && (
                <span className="flex flex-wrap gap-x-3 font-mono text-xs text-fg-muted" data-version-tokens>
                  {v.tokens.map((t) => (
                    <span key={t.name}>
                      {t.name} {t.before} → {t.after}
                    </span>
                  ))}
                </span>
              )}
            </span>
            <span className="ml-auto flex min-w-0 items-center gap-3 text-xs text-fg-muted">
              <span className="flex min-w-0" data-version-sessions={v.sessions.length}>
                <Truncate>{v.sessions.length === 0 ? "no brainstorm on it" : `${v.sessions.length === 1 ? "1 brainstorm" : `${v.sessions.length} brainstorms`}: ${v.sessions.map((s) => s.title).join(", ")}`}</Truncate>
              </span>
              <span className="shrink-0">synced {at(v.syncedAt, now)}</span>
            </span>
          </li>
        ))}
      </ul>
    </ScrollPane>
  );
}

/** One kind of change a version made, named in words rather than a +, − or ~ to decode. */
function ChangeLine({ label, names, className, data }: { label: string; names: readonly string[]; className: string; data?: string }) {
  return (
    <span className="flex flex-wrap gap-x-2" data-change={label}>
      <span className="text-fg-muted">{label}</span>
      {names.map((n) => (
        <span key={n} className={cn("font-mono", className)} {...(data === undefined ? {} : { [`data-${data}`]: n.split(" ")[0] })}>
          {n}
        </span>
      ))}
    </span>
  );
}

/** What each sync warning means, in Rob's words; the code stays for the agent's CLI. */
const WARNING_LABEL: Readonly<Record<string, string>> = {
  theme_ignored: "May not follow the theme",
  no_story: "No story",
  off_scale: "Off the kit's own scales",
  story_failed: "A story didn't render",
  frame_missing: "Frame component missing",
  remote_url: "Remote file",
  system_source: "Library layout",
  empty_glob: "Matches no file",
  duplicate_export: "Two components by one name",
  outside_boundary: "Reaches outside the system",
  story_empty: "A story renders nothing",
  no_tokens: "No theme tokens",
};

/**
 * The latest sync's warnings, one group per kind. A list the message ends with ("…: Card, Chart") is laid out item by
 * item, and an item that names a component opens its stories.
 */
function WarningsTab({ warnings, components, onOpen }: { warnings: readonly Issue[]; components: ReadonlySet<string>; onOpen: (name: string) => void }) {
  if (warnings.length === 0) return <p className="p-6 text-sm text-fg-muted">The latest sync had nothing to report.</p>;
  const groups = [...warnings.reduce((m, w) => m.set(w.code, [...(m.get(w.code) ?? []), w]), new Map<string, Issue[]>())];
  return (
    <ScrollPane inset={6}>
      <div className="grid gap-3 py-6" data-system-warnings>
        <p className="text-sm text-fg-muted">What the latest sync noticed but didn't refuse. Brainstorms build with the system as it is.</p>
        {groups.map(([code, list]) => {
          // One warning per component, such as theme_ignored, reads as one warning that names them all.
          const perComponent = list.length > 1 && list.every((w) => components.has(w.message.split("'s ")[0] ?? ""));
          const items = perComponent ? list.map((w) => w.message.split("'s ")[0] ?? "") : list.length === 1 ? listOf(list[0]?.message ?? "") : null;
          const lead = perComponent
            ? `${list.length} components: their ${(list[0]?.message ?? "").split("'s ").slice(1).join("'s ")}`
            : list.length === 1 && items !== null
              ? (list[0]?.message ?? "").slice(0, (list[0]?.message ?? "").lastIndexOf(": "))
              : null;
          return (
            <section key={code} className="grid gap-2 rounded-md bg-card p-4 ring-1 ring-border" data-warning={code}>
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <span aria-hidden className="size-1.5 rounded-full bg-warning" />
                {WARNING_LABEL[code] ?? code}
              </h3>
              {lead !== null ? (
                <p className="text-sm text-fg-muted">{sentence(lead)}.</p>
              ) : (
                <ul className="grid gap-1 text-sm text-fg-muted">
                  {list.map((w, i) => (
                    <li key={i}>{sentence(w.message)}</li>
                  ))}
                </ul>
              )}
              {items !== null && (
                <ul className="flex flex-wrap gap-1.5" data-warning-items>
                  {items.map((item) =>
                    components.has(item) ? (
                      <li key={item}>
                        <Button variant="outline" size="xs" onClick={() => onOpen(item)} data-warning-open={item}>
                          {item}
                        </Button>
                      </li>
                    ) : (
                      <li key={item} className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {item}
                      </li>
                    ),
                  )}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </ScrollPane>
  );
}

/** The items a message ends with, after its last colon, or null when it doesn't end in a list. */
const listOf = (message: string): string[] | null => {
  const tail = message.slice(message.lastIndexOf(": ") + 2);
  if (!message.includes(": ") || !/,/.test(tail)) return null;
  return tail.split(/, | and (?=\d+ more$)/).filter((s) => !/^\d+ more$/.test(s));
};

const sentence = (s: string) => s.replace(/^\w/, (c) => c.toUpperCase()).replace(/\.$/, "");
