import { ArrowLeft, Component, FolderPlus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout, CalloutItem } from "@/components/ui/callout";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { ScrollPane } from "@/components/ui/scroll-pane";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs } from "@/components/ui/tabs";
import { Truncate } from "@/components/ui/truncate";
import type { CatalogEntry, FrameToHost, HostToFrame, Issue, SystemId, SystemListing, SystemView, ThemeState } from "../core/types";
import type { Api } from "./api";
import { kitFor } from "./kit";
import type { Notice } from "./notice";
import { age, useNow } from "./time";

type Tab = "components" | "theme" | "versions" | "warnings";

/** Design systems (ADR 007): the libraries Brainstorm has synced, and what each one holds. */
export function SystemsPage({
  api,
  selected,
  onSelect,
  showNotice,
}: {
  api: Api;
  selected: SystemId | null;
  onSelect: (id: SystemId | null) => void;
  showNotice: (notice: Notice) => void;
}) {
  const [systems, setSystems] = useState<readonly SystemListing[] | null>(null);
  const [syncing, setSyncing] = useState<SystemId | null>(null);
  const refresh = useCallback(() => void api.systems().then((r) => r.ok && setSystems(r.data)), [api]);
  useEffect(refresh, [refresh]);

  const sync = async (id: SystemId) => {
    setSyncing(id);
    const r = await api.syncSystem(id);
    setSyncing(null);
    if (!r.ok) return showNotice({ title: "Couldn't sync the design system", detail: issuesText(r.error) });
    showNotice({
      title: r.data.created ? `Synced version ${r.data.system.latest?.n ?? ""}` : "Nothing changed",
      detail: r.data.created ? "Brainstorms on an older version can upgrade from their Inspector." : "The library builds the same as its latest version.",
    });
    refresh();
  };

  if (selected !== null) {
    return <SystemDetail api={api} id={selected} syncing={syncing === selected} onSync={() => void sync(selected)} onBack={() => onSelect(null)} />;
  }
  return (
    <div className="flex size-full flex-col" data-systems-page>
      <ScrollPane
        inset={6}
        head={
          <div className="flex flex-col gap-5 px-6 pt-6 pb-2">
            <PageHeader
              heading="Design systems"
              description="A React library synced from its package folder. A brainstorm built with one composes only its components, so the design can be built as drawn."
            />
            <AddSystem
              onAdd={async (path) => {
                const r = await api.addSystem(path);
                if (!r.ok) {
                  showNotice({ title: "Couldn't add the design system", detail: issuesText(r.error) });
                  return false;
                }
                refresh();
                onSelect(r.data.system.id);
                return true;
              }}
            />
          </div>
        }
      >
        <div className="px-6 pt-3 pb-6">
          {systems === null ? (
            <div className="grid gap-3" aria-busy>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : systems.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Component aria-hidden />
                </EmptyMedia>
                <EmptyTitle>No design systems yet</EmptyTitle>
                <EmptyDescription>Add a library's package folder above. Brainstorm finds its entry, stylesheet and Storybook stories.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="grid gap-3" data-systems-list>
              {systems.map((s) => (
                <SystemCard key={s.id} system={s} syncing={syncing === s.id} onOpen={() => onSelect(s.id)} onSync={() => void sync(s.id)} />
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

function AddSystem({ onAdd }: { onAdd: (path: string) => Promise<boolean> }) {
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (path.trim() === "" || busy) return;
    setBusy(true);
    const added = await onAdd(path.trim());
    setBusy(false);
    if (added) setPath("");
  };
  return (
    <div className="flex items-center gap-2" data-system-add>
      <Input
        aria-label="Library folder"
        className="max-w-picker flex-1 font-mono text-xs"
        placeholder="C:\code\app\packages\ui"
        value={path}
        disabled={busy}
        onChange={(e) => setPath(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void add()}
      />
      <Button variant="accent" disabled={path.trim() === "" || busy} onClick={() => void add()} data-system-add-button>
        {busy ? <Spinner data-icon="inline-start" /> : <FolderPlus data-icon="inline-start" aria-hidden />}
        {busy ? "Syncing…" : "Add design system"}
      </Button>
    </div>
  );
}

function SystemCard({ system, syncing, onOpen, onSync }: { system: SystemListing; syncing: boolean; onOpen: () => void; onSync: () => void }) {
  const now = useNow();
  const latest = system.latest;
  const warnings = latest?.warnings.length ?? 0;
  return (
    <li className="flex items-start gap-4 rounded-lg bg-card p-4 shadow-xs ring-1 ring-border" data-system={system.id}>
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
      </button>
      <Button variant="outline" disabled={syncing} onClick={onSync} data-system-sync={system.id}>
        {syncing ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" aria-hidden />}
        {syncing ? "Syncing…" : "Sync"}
      </Button>
    </li>
  );
}

function SystemDetail({ api, id, syncing, onSync, onBack }: { api: Api; id: SystemId; syncing: boolean; onSync: () => void; onBack: () => void }) {
  const [view, setView] = useState<SystemView | null>(null);
  const [tab, setTab] = useState<Tab>("components");
  useEffect(() => void api.system(id).then((r) => r.ok && setView(r.data)), [api, id, syncing]);
  const latest = view?.latest ?? null;
  const warnings = latest?.warnings ?? [];
  return (
    <div className="flex size-full flex-col" data-system-detail={id}>
      <div className="flex flex-col gap-4 border-b bg-card px-6 pt-4">
        <Button variant="ghost" size="xs" className="self-start" onClick={onBack} data-systems-back>
          <ArrowLeft data-icon="inline-start" aria-hidden />
          Design systems
        </Button>
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <PageHeader heading={view?.name ?? "Design system"} description={<span className="font-mono text-xs">{view?.root}</span>} />
          </div>
          {latest !== null && <Badge>v{latest.n}</Badge>}
          <Button variant="outline" disabled={syncing} onClick={onSync} data-system-sync={id}>
            {syncing ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" aria-hidden />}
            {syncing ? "Syncing…" : "Sync"}
          </Button>
        </div>
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

function ComponentsTab({ view, manifest }: { view: SystemView; manifest: Manifest }) {
  const [entry, setEntry] = useState<string | null>(null);
  const [axes, setAxes] = useState<Record<string, string>>({});
  const entries = manifest.catalog;
  const chosen = entries.find((e) => e.name === entry) ?? null;
  const stories = chosen === null ? null : chosen.stories;
  const latest = view.latest;
  return (
    <div className="flex min-h-0 flex-1">
      <ScrollPane inset={4} className="w-inspector shrink-0 border-r bg-card" data-catalog>
        <ul className="grid gap-0.5 py-3">
          <CatalogRow label="All stories" detail={`${manifest.stories.length}`} active={entry === null} onClick={() => setEntry(null)} />
          {entries.map((e) => (
            <CatalogRow key={e.name} label={e.name} detail={entryDetail(e)} active={entry === e.name} onClick={() => setEntry(e.name)} data-entry={e.name} />
          ))}
        </ul>
      </ScrollPane>
      <div className="flex min-w-0 flex-1 flex-col">
        {manifest.styles.axes.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-card px-4 py-2">
            {manifest.styles.axes.map((a) => (
              <div key={a.attribute} className="flex items-center gap-2 text-xs whitespace-nowrap text-fg-muted">
                {a.attribute}
                <Segmented
                  fit="content"
                  aria-label={a.attribute}
                  value={axes[a.attribute] ?? "__default"}
                  onValueChange={(v) => setAxes((prev) => ({ ...prev, [a.attribute]: v }))}
                  options={[{ value: "__default", label: a.default ?? "default" }, ...a.values.filter((v) => v !== a.default).map((v) => ({ value: v, label: v }))]}
                />
              </div>
            ))}
          </div>
        )}
        {chosen !== null && chosen.stories.length === 0 && (
          <p className="px-4 py-3 text-sm text-fg-muted">
            {chosen.generated ? "Brainstorm made this one, since the library has none by this name. Blocks use it for layout and text." : "This component has no story, so there's nothing to show."}
          </p>
        )}
        {latest !== null && (
          <GalleryFrame
            id={view.id}
            n={latest.n}
            stories={stories}
            theme={{ axes: Object.fromEntries(Object.entries(axes).filter(([, v]) => v !== "__default")), tokens: {} }}
          />
        )}
      </div>
    </div>
  );
}

const entryDetail = (e: CatalogEntry) => (e.generated ? "Brainstorm's" : e.stories.length === 0 ? "no story" : `${e.stories.length}`);

function CatalogRow({ label, detail, active, onClick, ...data }: { label: string; detail: string; active: boolean; onClick: () => void; [attr: `data-${string}`]: unknown }) {
  return (
    <li>
      <button
        type="button"
        aria-current={active || undefined}
        onClick={onClick}
        className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring aria-current:bg-selected aria-current:font-medium"
        {...data}
      >
        <span className="flex min-w-0 flex-1">
          <Truncate>{label}</Truncate>
        </span>
        <span className="shrink-0 text-xs text-fg-muted">{detail}</span>
      </button>
    </li>
  );
}

/** The kit's stories, rendered in a canvas frame of their own, so they run as blocks do: sandboxed, with the kit's CSS. */
function GalleryFrame({ id, n, stories, theme }: { id: SystemId; n: SystemView["versions"][number]["n"]; stories: readonly string[] | null; theme: ThemeState }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const post = (m: HostToFrame) => frame.current?.contentWindow?.postMessage(m, "*");
  useEffect(() => {
    const receive = (e: MessageEvent) => {
      if (frame.current === null || e.source !== frame.current.contentWindow) return;
      if ((e.data as FrameToHost).kind !== "ready") return;
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
  const storyKey = JSON.stringify(stories);
  useEffect(() => {
    if (ready) post({ kind: "gallery", stories });
  }, [ready, storyKey]);
  return (
    <div className="relative min-h-0 flex-1" data-gallery={ready || undefined}>
      <iframe ref={frame} title="Stories" src="/canvas" sandbox="allow-scripts" className="block size-full border-0" />
    </div>
  );
}

function ThemeTab({ manifest }: { manifest: Manifest }) {
  const tokens = useMemo(() => manifest.styles.tokens.filter((t) => t.origin === "system"), [manifest]);
  const axes = manifest.styles.axes;
  const columns = axes.flatMap((a) => a.values.filter((v) => v !== a.default).map((v) => `${a.attribute}=${v}`));
  return (
    <ScrollPane inset={6} data-system-theme>
      <div className="grid gap-4 py-6">
        <p className="text-sm text-fg-muted">
          {axes.length === 0
            ? "The library sets its tokens once, on the root."
            : `Switched by ${axes.map((a) => `${a.attribute} (${a.values.join(", ")})`).join(" and ")}. A brainstorm tweaks these for itself in its Inspector.`}
        </p>
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-fg-muted">
            <tr>
              <th className="py-1.5 font-medium">Token</th>
              <th className="py-1.5 font-medium">Root</th>
              {columns.map((c) => (
                <th key={c} className="py-1.5 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.name} className="border-t" data-token-row={t.name}>
                <td className="py-1.5 pr-4 font-mono text-xs">{t.name}</td>
                <TokenCell kind={t.kind} value={t.value} />
                {columns.map((c) => (
                  <TokenCell key={c} kind={t.kind} value={t.byAxis[c] ?? ""} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ScrollPane>
  );
}

function TokenCell({ kind, value }: { kind: string; value: string }) {
  return (
    <td className="py-1.5 pr-4">
      <span className="flex items-center gap-2 font-mono text-xs">
        {kind === "color" && value !== "" && <span aria-hidden className="size-4 shrink-0 rounded-sm ring-1 ring-border-strong" style={{ background: value }} />}
        <span className="flex min-w-0">
          <Truncate>{value}</Truncate>
        </span>
      </span>
    </td>
  );
}

function VersionsTab({ view }: { view: SystemView }) {
  const now = useNow();
  return (
    <ScrollPane inset={6}>
      <ul className="grid gap-2 py-6" data-system-versions>
        {view.versions.map((v) => (
          <li key={v.n} className="flex items-center gap-3 rounded-md bg-card p-3 text-sm ring-1 ring-border">
            <Badge>v{v.n}</Badge>
            <span className="text-fg-muted">
              {v.components} components · {v.stories} stories{v.failedStories > 0 ? ` (${v.failedStories} didn't render)` : ""}
            </span>
            <span className="ml-auto text-xs text-fg-muted">synced {age(v.syncedAt, now)}</span>
          </li>
        ))}
      </ul>
    </ScrollPane>
  );
}

function WarningsTab({ warnings }: { warnings: readonly Issue[] }) {
  if (warnings.length === 0) return <p className="p-6 text-sm text-fg-muted">The latest sync had nothing to report.</p>;
  return (
    <ScrollPane inset={6}>
      <div className="py-6">
        <Callout tone="warning" heading="The latest sync's warnings" data-system-warnings>
          <ul className="grid gap-1">
            {warnings.map((w, i) => (
              <CalloutItem key={i}>
                <span className="font-mono text-xs">{w.code}</span> {w.message}
              </CalloutItem>
            ))}
          </ul>
        </Callout>
      </div>
    </ScrollPane>
  );
}
