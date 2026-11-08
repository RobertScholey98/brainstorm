import { ArrowLeft, Bot, Check, Component, Copy, ExternalLink, FolderOpen, FolderPlus, RefreshCw, RotateCcw, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout, CalloutItem } from "@/components/ui/callout";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { ScrollPane } from "@/components/ui/scroll-pane";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs } from "@/components/ui/tabs";
import { Truncate } from "@/components/ui/truncate";
import type {
  ArgType,
  CatalogEntry,
  FrameToHost,
  GalleryFocus,
  HostToFrame,
  Issue,
  Json,
  StoryInfo,
  SystemId,
  SystemImport,
  SystemListing,
  SystemView,
  ThemeState,
  Tier,
} from "../core/types";
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
    });
  };

  const startImport = async (path: string, repair: SystemId | null = null) => {
    const r = await api.importSystem(path, repair);
    refresh();
    if (!r.ok) return showNotice({ title: repair === null ? "Couldn't start the import" : "Couldn't start the repair", detail: r.error.message });
    if (r.data.state === "failed") return showNotice({ title: "T3 didn't start the agent", detail: r.data.error });
    setNoSystem(null);
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
                <ImportCard key={i.root} item={i} onRetry={() => void startImport(i.root)} onDismiss={() => void api.dismissImport(i.root).then(refresh)} />
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
        className="max-w-picker flex-1 font-mono text-xs"
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

/** An agent importing a project's system, or repairing one, in a T3 thread (ADR 008). */
function ImportCard({ item, onRetry, onDismiss }: { item: SystemImport; onRetry: () => void; onDismiss: () => void }) {
  const now = useNow();
  return (
    <li className="flex items-start gap-4 rounded-lg bg-card p-4 shadow-xs ring-1 ring-border" data-system-importing={item.root} data-import-state={item.state}>
      <span className="mt-0.5 shrink-0 text-fg-muted">{item.state === "failed" ? <Bot aria-hidden className="size-4 text-danger" /> : <Spinner />}</span>
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="text-base font-semibold">{item.state === "failed" ? "The import didn't start" : "Importing with an agent"}</span>
        <span className="flex min-w-0 font-mono text-xs text-fg-muted">
          <Truncate>{item.root}</Truncate>
        </span>
        <span className="text-sm text-fg-muted">
          {item.state === "failed"
            ? item.error
            : `An agent is writing .brainstorm/system.json and the missing stories in a T3 thread${ago(item.at, now) === "" ? "" : `, started${ago(item.at, now)}`}. The system appears here once the agent adds it.`}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {item.state === "started" && item.link !== null && (
          <Button variant="outline" nativeButton={false} render={<a href={item.link} target="_blank" rel="noreferrer" />} data-import-thread>
            <ExternalLink data-icon="inline-start" aria-hidden />
            Open thread
          </Button>
        )}
        {item.state === "failed" && (
          <Button variant="outline" onClick={onRetry}>
            <RotateCcw data-icon="inline-start" aria-hidden />
            Try again
          </Button>
        )}
        <Button variant="ghost" onClick={onDismiss} data-import-dismiss>
          Dismiss
        </Button>
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
            {latest.components} components · {latest.stories} stories · {system.sessions === 1 ? "1 brainstorm" : `${system.sessions} brainstorms`} · synced {age(latest.syncedAt, now)}
            {warnings > 0 && <span className="text-warning"> · {warnings === 1 ? "1 warning" : `${warnings} warnings`}</span>}
          </span>
        )}
        {error !== null && (
          <span className="text-sm text-danger" data-system-sync-error>
            The last sync failed{ago(error.at, now)}:{firstError(error)}
          </span>
        )}
      </button>
      <span className="flex shrink-0 items-center gap-2">
        {error !== null && system.adapter && (
          <Button variant="outline" disabled={repairing} onClick={onRepair} data-system-repair={system.id}>
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
}: {
  api: Api;
  id: SystemId;
  revision: number;
  syncing: boolean;
  repairing: boolean;
  onSync: () => void;
  onRepair: (root: string) => void;
  onBack: () => void;
}) {
  const now = useNow();
  const [view, setView] = useState<SystemView | null>(null);
  const [tab, setTab] = useState<Tab>("components");
  useEffect(() => void api.system(id).then((r) => r.ok && setView(r.data)), [api, id, syncing, revision]);
  const latest = view?.latest ?? null;
  const warnings = latest?.warnings ?? [];
  const error = view?.syncError ?? null;
  return (
    <div className="flex size-full flex-col" data-system-detail={id}>
      <div className="flex flex-col gap-4 border-b bg-card px-6 pt-4">
        <Button variant="ghost" size="xs" className="self-start" onClick={onBack} data-systems-back>
          <ArrowLeft data-icon="inline-start" aria-hidden />
          Design systems
        </Button>
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <PageHeader
              heading={view?.name ?? "Design system"}
              description={
                <span className="flex min-w-0 flex-wrap gap-x-2 font-mono text-xs">
                  <span className="min-w-0 break-all">{view?.source.adapter ?? view?.root}</span>
                  {latest !== null && <span data-system-hash>· {latest.hash.slice(0, 7)}</span>}
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
            heading={`The last sync failed${ago(error.at, now)}`}
            data-system-sync-failed
            actions={
              view?.adapter === true ? (
                <Button variant="outline" disabled={repairing} onClick={() => view !== null && onRepair(view.root)} data-system-repair={id}>
                  {repairing ? <Spinner data-icon="inline-start" /> : <Wrench data-icon="inline-start" aria-hidden />}
                  {repairing ? "Repairing in a T3 thread…" : "Repair with an agent"}
                </Button>
              ) : undefined
            }
          >
            <p>{firstError(error)}</p>
            <p>Brainstorms keep using version {latest?.n ?? 1}. Brainstorm syncs again when the project changes.</p>
          </Callout>
        )}
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
        <ComponentsTab view={view} manifest={view.manifest} />
      ) : tab === "theme" ? (
        <ThemeTab manifest={view.manifest} />
      ) : tab === "versions" ? (
        <VersionsTab view={view} />
      ) : (
        <WarningsTab warnings={warnings} />
      )}
    </div>
  );
}

type Manifest = NonNullable<SystemView["manifest"]>;

const DEFAULT_AXIS = "__default";

const TIER_HEADING: Readonly<Record<Tier, string>> = { layout: "Layouts", composite: "Composites", primitive: "Primitives" };
const TIER_ORDER: readonly Tier[] = ["layout", "composite", "primitive"];
const tierOf = (e: CatalogEntry): Tier => e.tier ?? "primitive";

/** Components whose name starts with the search come first, then names that contain it, then those with a matching part. */
function searchCatalog(catalog: readonly CatalogEntry[], needle: string): CatalogEntry[] {
  const rank = (e: CatalogEntry) => {
    const name = e.name.toLowerCase();
    if (name.startsWith(needle)) return 0;
    if (name.includes(needle)) return 1;
    return e.parts.some((p) => p.toLowerCase().includes(needle)) ? 2 : null;
  };
  return catalog
    .map((e) => ({ e, r: rank(e) }))
    .filter((x): x is { e: CatalogEntry; r: number } => x.r !== null)
    .sort((a, b) => a.r - b.r)
    .map((x) => x.e);
}

/** The catalog in sections: the library's components by tier, most composed first, then Brainstorm's primitives. */
function catalogSections(entries: readonly CatalogEntry[]): { heading: string; entries: CatalogEntry[] }[] {
  const own = entries.filter((e) => !e.generated);
  return [
    ...TIER_ORDER.map((t) => ({ heading: TIER_HEADING[t], entries: own.filter((e) => tierOf(e) === t) })),
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

function ComponentsTab({ view, manifest }: { view: SystemView; manifest: Manifest }) {
  const [entry, setEntry] = useState<string | null>(null);
  const [axes, setAxes] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  /** The story open in the workbench, with the args Rob changed and the width he picked. */
  const [focus, setFocus] = useState<{ id: string; args: Record<string, Json>; width: WidthChoice } | null>(null);
  const needle = query.trim().toLowerCase();
  const entries = needle === "" ? manifest.catalog : searchCatalog(manifest.catalog, needle);
  const chosen = entries.find((e) => e.name === entry) ?? null;
  // A search narrows the gallery too, until Rob picks one component from it.
  const stories = chosen !== null ? chosen.stories : needle === "" ? null : entries.flatMap((e) => e.stories);
  const latest = view.latest;
  const story = focus === null ? null : (manifest.stories.find((s) => s.id === focus.id) ?? null);
  const owner = story === null ? null : (manifest.catalog.find((e) => e.stories.includes(story.id)) ?? null);
  const pick = (name: string | null) => {
    setEntry(name);
    setFocus(null);
  };
  const sections = needle === "" ? catalogSections(entries) : [{ heading: "", entries: [...entries] }];
  return (
    <div className="flex min-h-0 flex-1">
      {/* The catalog takes the Inspector's width, so the stories get the rest. flex-none beats ScrollPane's flex-1. */}
      <div className="flex w-inspector flex-none flex-col border-r bg-card" data-catalog>
        <div className="px-4 pt-3">
          <Input type="search" placeholder={`Search ${manifest.catalog.filter((e) => !e.generated).length} components`} aria-label="Search components" value={query} onChange={(e) => setQuery(e.target.value)} data-catalog-search />
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
                    <CatalogRow key={e.name} label={e.name} via={matchedPart(e, needle)} detail={s.heading === "" ? entryDetail(e) : sectionDetail(e)} active={entry === e.name} onClick={() => pick(e.name)} data-entry={e.name} />
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
                {owner !== null && !owner.generated && <Badge data-workbench-tier>{tierOf(owner)}</Badge>}
              </div>
            )}
            {manifest.styles.axes.map((a) => (
              <div key={a.attribute} className="flex items-center gap-2 text-xs whitespace-nowrap text-fg-muted">
                {a.attribute}
                <Segmented
                  fit="content"
                  aria-label={a.attribute}
                  value={axes[a.attribute] ?? DEFAULT_AXIS}
                  onValueChange={(v) => setAxes((prev) => ({ ...prev, [a.attribute]: v }))}
                  options={[{ value: DEFAULT_AXIS, label: a.default ?? "default" }, ...a.values.filter((v) => v !== a.default).map((v) => ({ value: v, label: v }))]}
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
              onOpenStory={(id) => setFocus({ id, args: {}, width: "fill" })}
              theme={{ axes: Object.fromEntries(Object.entries(axes).filter(([, v]) => v !== DEFAULT_AXIS)), tokens: {} }}
            />
          )}
          {focus !== null && story !== null && (
            <Workbench
              key={story.id}
              story={story}
              owner={owner}
              overrides={focus.args}
              onChange={(args) => setFocus((f) => (f === null ? f : { ...f, args }))}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** The part a search matched when the component's own name doesn't, so Breadcrumb shows why "st" found it. */
const matchedPart = (e: CatalogEntry, needle: string) =>
  needle === "" || e.name.toLowerCase().includes(needle) ? undefined : e.parts.find((p) => p.toLowerCase().includes(needle));

const entryDetail = (e: CatalogEntry) => (e.generated ? "Brainstorm's" : e.stories.length === 0 ? "no story" : `${e.stories.length}`);
/** Under a Brainstorm's heading the row needn't say so again. */
const sectionDetail = (e: CatalogEntry) => (e.generated ? "" : entryDetail(e));

function CatalogRow({
  label,
  via,
  detail,
  active,
  onClick,
  ...data
}: {
  label: string;
  via?: string | undefined;
  detail: string;
  active: boolean;
  onClick: () => void;
  [attr: `data-${string}`]: unknown;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={active || undefined}
        onClick={onClick}
        className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring aria-current:bg-selected aria-current:font-medium"
        {...data}
      >
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="flex min-w-0 shrink-0">
            <Truncate>{label}</Truncate>
          </span>
          {via !== undefined && (
            <span className="flex min-w-0 text-xs text-fg-muted" data-catalog-via>
              <Truncate>{via}</Truncate>
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
  return children === null ? `<${open}${close} />` : `<${open}${close}>${children}</${name}>`;
}

/** The workbench beside one story: its args as live controls, its component's props, and the JSX to use it (ADR 008). */
function Workbench({
  story,
  owner,
  overrides,
  onChange,
}: {
  story: StoryInfo;
  owner: CatalogEntry | null;
  overrides: Readonly<Record<string, Json>>;
  onChange: (args: Record<string, Json>) => void;
}) {
  const rows = useMemo(() => argRows(story), [story]);
  const [copied, setCopied] = useState(false);
  const base = (typeof story.args === "object" && story.args !== null ? story.args : {}) as Record<string, unknown>;
  const current = { ...base, ...overrides };
  const name = story.component ?? owner?.name ?? story.title.split("/").at(-1) ?? "Component";
  const snippet = `import { ${name} } from "kit";\n\n${usageSnippet(name, current)}`;
  const set = (key: string, value: Json) => onChange({ ...overrides, [key]: value });
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
            {rows.length === 0 ? (
              <p className="text-sm text-fg-muted">The story names none. The library's source has them.</p>
            ) : (
              <ul className="grid grid-cols-1 rounded-md ring-1 ring-border">
                {rows.map((row) => (
                  <li key={row.name} className="grid gap-0.5 border-t px-3 py-2 first:border-t-0" data-prop={row.name}>
                    <span className="font-mono text-xs">{row.name}</span>
                    <span className="font-mono text-xs break-words text-fg-muted">{typeText(row)}</span>
                    {row.type?.description != null && <span className="text-xs text-fg-muted">{row.type.description}</span>}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-fg-muted">From this component's stories. A prop no story sets isn't listed.</p>
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
}: {
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
    if (ready) post({ kind: "gallery", stories, focus });
  }, [ready, storyKey]);
  return (
    <div className="relative min-h-0 min-w-0 flex-1" data-gallery={ready || undefined} data-gallery-focused={focus?.id}>
      <iframe ref={frame} title="Stories" src="/canvas" sandbox="allow-scripts" className="block size-full border-0" />
    </div>
  );
}

function ThemeTab({ manifest }: { manifest: Manifest }) {
  const axes = manifest.styles.axes;
  const [picked, setPicked] = useState<Record<string, string>>({});
  // Tokens the library declares with a value Rob can read; internal plumbing such as scroll-fade sizes is left out.
  const tokens = useMemo(() => manifest.styles.tokens.filter((t) => t.origin === "system" && t.kind !== "other" && t.value !== ""), [manifest]);
  const colours = tokens.filter((t) => t.kind === "color");
  const others = tokens.filter((t) => t.kind !== "color");
  const chosen = Object.entries(picked).filter(([, v]) => v !== DEFAULT_AXIS);
  const valueOf = (t: (typeof tokens)[number]) => {
    let value = t.value;
    for (const [attribute, v] of chosen) value = t.byAxis[`${attribute}=${v}`] ?? value;
    return value;
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {axes.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-card px-6 py-2">
          {axes.map((a) => (
            <div key={a.attribute} className="flex items-center gap-2 text-xs whitespace-nowrap text-fg-muted" data-theme-tab-axis={a.attribute}>
              {a.attribute}
              <Segmented
                fit="content"
                aria-label={a.attribute}
                value={picked[a.attribute] ?? DEFAULT_AXIS}
                onValueChange={(v) => setPicked((prev) => ({ ...prev, [a.attribute]: v }))}
                options={[{ value: DEFAULT_AXIS, label: a.default ?? "default" }, ...a.values.filter((v) => v !== a.default).map((v) => ({ value: v, label: v }))]}
                itemData="theme-tab-value"
              />
            </div>
          ))}
        </div>
      )}
      <ScrollPane inset={6} data-system-theme>
        <div className="grid gap-6 py-6">
          <p className="text-sm text-fg-muted">
            {axes.length === 0
              ? "The library sets its tokens once, on the root. A brainstorm tweaks them for itself in its Inspector."
              : "Pick values above to see the tokens as the library sets them there. A brainstorm tweaks these for itself in its Inspector."}
          </p>
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
                <ul className="grid grid-cols-1 rounded-md bg-card ring-1 ring-border">
                  {(list as typeof tokens).map((t) => {
                    const value = valueOf(t);
                    return (
                      <li key={t.name} className="flex items-center gap-4 border-t px-3 py-2 first:border-t-0" data-token-row={t.name}>
                        <span className="w-popover-sm shrink-0 font-mono text-xs whitespace-nowrap">{t.name}</span>
                        <span className="flex min-w-0 flex-1 items-center gap-2 font-mono text-xs">
                          {t.kind === "color" && <span aria-hidden className="size-4 shrink-0 rounded-sm ring-1 ring-border-strong" style={{ background: value }} />}
                          <Truncate>{value}</Truncate>
                        </span>
                        {value !== t.value && <span className="shrink-0 text-xs text-fg-muted">from {t.value}</span>}
                      </li>
                    );
                  })}
                </ul>
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
              {(v.added.length > 0 || v.removed.length > 0 || v.changed.length > 0) && (
                <span className="flex flex-wrap gap-x-3 font-mono text-xs" data-version-changes>
                  {v.added.map((name) => (
                    <span key={name} className="text-success">
                      +{name}
                    </span>
                  ))}
                  {v.removed.map((name) => (
                    <span key={name} className="text-danger">
                      −{name}
                    </span>
                  ))}
                  {v.changed.map((c) => (
                    <span key={c.name} className="text-warning" data-version-changed={c.name}>
                      ~{c.name}
                    </span>
                  ))}
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
              <span className="shrink-0">synced {age(v.syncedAt, now)}</span>
            </span>
          </li>
        ))}
      </ul>
    </ScrollPane>
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

function WarningsTab({ warnings }: { warnings: readonly Issue[] }) {
  if (warnings.length === 0) return <p className="p-6 text-sm text-fg-muted">The latest sync had nothing to report.</p>;
  return (
    <ScrollPane inset={6}>
      <div className="py-6">
        <Callout tone="warning" heading="The latest sync's warnings" data-system-warnings>
          <ul className="grid gap-1">
            {warnings.map((w, i) => (
              <CalloutItem key={i}>
                <span className="font-medium">{WARNING_LABEL[w.code] ?? w.code}.</span> {w.message.replace(/^\w/,(c) => c.toUpperCase())}
              </CalloutItem>
            ))}
          </ul>
        </Callout>
      </div>
    </ScrollPane>
  );
}
