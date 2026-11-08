import {
  ArrowUpRight,
  Bell,
  Bot,
  FolderOpen,
  Keyboard,
  LayoutGrid,
  Minus,
  MonitorPlay,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SearchX,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Code, Kbd } from "@/components/ui/kbd";
import { ScrollPane } from "@/components/ui/scroll-pane";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Hint } from "@/components/ui/tooltip";
import { openFolderPath, type AppAbout, type Openable } from "../core/about";
import type { AppUpdateState } from "../core/appUpdate";
import { VARY_MAX } from "../core/fork";
import { RESTORE_DEFAULTS, type AppSettings, type NotifyChoice, type StripChoice, type UiPrefs, type UiPrefsPatch } from "../core/prefs";
import { SETTLE_SHORTCUT } from "./settle";
import { updateMove, updateStatus } from "./Update";
import { useNow } from "./time";

const RELEASES = "https://github.com/RobertScholey98/brainstorm/releases";

export type SettingsPageId = "general" | "appearance" | "canvas" | "preview" | "agent" | "files" | "updates" | "shortcuts";

/** A setting: what it is, what it does, and its control at the row's end. `keywords` are other words Rob might search by. */
type Row = { readonly id: string; readonly title: string; readonly description: string; readonly keywords?: string; readonly control?: ReactNode; readonly detail?: ReactNode };
type Section = { readonly heading: string; readonly rows: readonly Row[] };
/**
 * A page of the nav. Pages in one `group` sit together between rules, so an Account group can go in above the rest once
 * Brainstorm has sign-in.
 */
type Page = { readonly id: SettingsPageId; readonly label: string; readonly icon: LucideIcon; readonly group: number; readonly sections: readonly Section[] };

type Context = {
  readonly prefs: UiPrefs;
  readonly save: (patch: UiPrefsPatch) => void;
  readonly setting: <K extends keyof AppSettings>(name: K, value: AppSettings[K]) => void;
  readonly about: AppAbout | null;
  readonly update: AppUpdateState | null;
  readonly now: number;
  readonly onCheck: () => void;
  readonly onDownload: () => void;
  readonly onInstall: () => void;
  readonly onSkill: () => void;
  readonly skillNote: string | null;
};

const NOTIFY: Record<NotifyChoice, string> = { off: "Off", silent: "Notifications", sound: "Notifications with sound" };
const STRIP: Record<StripChoice, string> = { auto: "From the second iteration", open: "Always open", closed: "Always shut" };

/** The app's shortcuts, as each control's hint names them. */
const SHORTCUTS: readonly { readonly keys: string; readonly title: string; readonly description: string }[] = [
  { keys: "Ctrl+,", title: "Settings", description: "Open these settings." },
  { keys: "Ctrl+B", title: "Toggle the sidebar", description: "Hide or show the sidebar." },
  { keys: "Ctrl+R", title: "Regenerate", description: "Ask the agent for a new iteration of the open brainstorm." },
  { keys: SETTLE_SHORTCUT, title: "Settle", description: "Settle the brainstorm focused in a list or open, or bring a settled one back." },
  { keys: "/", title: "Search", description: "Search the brainstorms on home, or these settings while they're open. Ctrl+F works on home too." },
  { keys: "Ctrl+Enter", title: "Send", description: "Send from a comment, Regenerate, Fork or Vary." },
  { keys: "Esc", title: "Back out", description: "Close a popover, stop picking, cancel a comment, then leave a past iteration." },
  { keys: "← →", title: "Slots and iterations", description: "Move between slot tabs, or between iterations in the history strip. Home and End jump to its ends." },
  { keys: "F5", title: "Present", description: "Fill the screen with the slot on the stage." },
  { keys: "F11", title: "Preview full screen", description: "Fill the screen with the preview window, which Escape leaves." },
];

function folderButton(folder: Openable, label = "Open") {
  return (
    <Button nativeButton={false} render={<a href={openFolderPath(folder)} target="_blank" rel="noreferrer" />} data-open-folder={folder}>
      <FolderOpen data-icon="inline-start" aria-hidden />
      {label}
    </Button>
  );
}

const path = (p: string) => (
  <p className="pt-1 font-mono text-xs break-all text-fg-muted" data-path>
    {p}
  </p>
);

function pages(c: Context): readonly Page[] {
  const s = c.prefs.settings;
  const move = updateMove(c.update);
  return [
    {
      id: "general",
      label: "General",
      icon: Bell,
      group: 0,
      sections: [
        {
          heading: "Notifications",
          rows: [
            {
              id: "notifications",
              title: "Brainstorm notifications",
              description: "A system alert when a brainstorm gets a new iteration, its request fails, its thread is lost, or the agent asks you something in T3, while Brainstorm is in the background.",
              keywords: "alert sound toast notify",
              control: (
                <Select value={s.notifications} onValueChange={(v) => v !== null && c.setting("notifications", v as NotifyChoice)} items={NOTIFY}>
                  <SelectTrigger aria-label="Brainstorm notifications" data-setting-control="notifications">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {(Object.keys(NOTIFY) as NotifyChoice[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {NOTIFY[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ),
            },
          ],
        },
      ],
    },
    {
      id: "appearance",
      label: "Appearance",
      icon: Palette,
      group: 0,
      sections: [
        {
          heading: "Appearance",
          rows: [
            {
              id: "theme",
              title: "Theme",
              description: "Light or dark for the app, the canvas and the preview window. System follows your OS.",
              keywords: "dark mode light mode colour color",
              control: (
                <Segmented
                  aria-label="Theme"
                  fit
                  itemData="theme"
                  value={s.theme}
                  onValueChange={(v) => c.setting("theme", v)}
                  options={[
                    { value: "system", label: "System" },
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                  ]}
                />
              ),
            },
          ],
        },
      ],
    },
    {
      id: "canvas",
      label: "Canvas",
      icon: LayoutGrid,
      group: 1,
      sections: [
        {
          heading: "Opening a brainstorm",
          rows: [
            {
              id: "canvasView",
              title: "View",
              description: "What a brainstorm opens on until you pick a view in it: one slot on the stage, or every slot side by side.",
              keywords: "stage board slots layout",
              control: (
                <Segmented
                  aria-label="View"
                  fit
                  itemData="canvas-view"
                  value={s.canvasView}
                  onValueChange={(v) => c.setting("canvasView", v)}
                  options={[
                    { value: "stage", label: "One slot" },
                    { value: "board", label: "All slots" },
                  ]}
                />
              ),
            },
            {
              id: "historyStrip",
              title: "History strip",
              description: "Whether the strip of iterations shows under the canvas until you open or shut it in that brainstorm.",
              keywords: "iterations filmstrip timeline",
              control: (
                <Select value={s.historyStrip} onValueChange={(v) => v !== null && c.setting("historyStrip", v as StripChoice)} items={STRIP}>
                  <SelectTrigger aria-label="History strip" data-setting-control="historyStrip">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {(Object.keys(STRIP) as StripChoice[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {STRIP[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ),
            },
            {
              id: "inspectorRail",
              title: "Collapse the Inspector",
              description: "Keep the Inspector as a thin rail at the canvas's right. The panel button at the end of the header does the same.",
              keywords: "panel right sidebar controls",
              control: <Switch aria-label="Collapse the Inspector" checked={c.prefs.inspectorRail} onCheckedChange={(on) => c.save({ inspectorRail: on })} data-setting-control="inspectorRail" />,
            },
          ],
        },
        {
          heading: "Vary",
          rows: [
            {
              id: "varyCount",
              title: "Variants to ask for",
              description: "How many variants Vary starts on. You can still change it each time.",
              keywords: "vary count variants",
              control: (
                <div className="flex items-center gap-1" role="group" aria-label="Variants to ask for">
                  <Button variant="outline" size="icon" aria-label="Fewer" disabled={s.varyCount <= 1} onClick={() => c.setting("varyCount", s.varyCount - 1)}>
                    <Minus />
                  </Button>
                  <output className="w-8 text-center tabular-nums" aria-live="polite" data-setting-control="varyCount">
                    {s.varyCount}
                  </output>
                  <Button variant="outline" size="icon" aria-label="More" disabled={s.varyCount >= VARY_MAX} onClick={() => c.setting("varyCount", s.varyCount + 1)}>
                    <Plus />
                  </Button>
                </div>
              ),
            },
          ],
        },
      ],
    },
    {
      id: "preview",
      label: "Preview window",
      icon: MonitorPlay,
      group: 1,
      sections: [
        {
          heading: "Preview window",
          rows: [
            {
              id: "previewLook",
              title: "Look",
              description: "Clean shows the design alone, filling the window, for an audience. Working shows the canvas as this window draws it, pins and all.",
              keywords: "present audience second screen",
              control: (
                <Segmented
                  aria-label="Look"
                  fit
                  itemData="preview-look"
                  value={c.prefs.preview.look}
                  onValueChange={(look) => c.save({ preview: { ...c.prefs.preview, look } })}
                  options={[
                    { value: "clean", label: "Clean" },
                    { value: "working", label: "Working" },
                  ]}
                />
              ),
            },
            {
              id: "previewHere",
              title: "Keep the canvas here",
              description: "Keep drawing the canvas in this window while the preview window is open. Off, this window shows where the design went.",
              keywords: "main window mirror",
              control: (
                <Switch
                  aria-label="Keep the canvas here"
                  checked={c.prefs.preview.here}
                  onCheckedChange={(here) => c.save({ preview: { ...c.prefs.preview, here } })}
                  data-setting-control="previewHere"
                />
              ),
            },
          ],
        },
      ],
    },
    {
      id: "agent",
      label: "Agent",
      icon: Bot,
      group: 2,
      sections: [
        {
          heading: "The /use-brainstorm skill",
          rows:
            c.about?.skill === null
              ? [
                  {
                    id: "skill",
                    title: "Agent skill",
                    description: "This Brainstorm runs from source or on another home, so it leaves your skills alone. Run node scripts/install-skill.mjs to install the skill from a checkout.",
                    keywords: "use-brainstorm claude skill install",
                  },
                ]
              : [
                  {
                    id: "skillUpdate",
                    title: "Keep the skill up to date",
                    description: "Copy the skill this version ships with to Claude's skills each time Brainstorm starts, so agents drive it the way this version expects. A copy you changed is backed up first.",
                    keywords: "use-brainstorm claude skill install",
                    control: <Switch aria-label="Keep the skill up to date" checked={s.skillUpdate} onCheckedChange={(on) => c.setting("skillUpdate", on)} data-setting-control="skillUpdate" />,
                  },
                  {
                    id: "skillInstall",
                    title: "Installed skill",
                    description: c.skillNote ?? "Where agents load /use-brainstorm from.",
                    keywords: "use-brainstorm reinstall folder",
                    detail: c.about?.skill ? path(c.about.skill.target) : null,
                    control: (
                      <>
                        <Button onClick={c.onSkill} data-skill-install>
                          <RefreshCw data-icon="inline-start" aria-hidden />
                          Reinstall
                        </Button>
                        {folderButton("skill")}
                      </>
                    ),
                  },
                  {
                    id: "skillBackups",
                    title: "Skill backups",
                    description: "Copies of the skill you had changed, kept from before an install replaced them.",
                    keywords: "backup restore",
                    detail: c.about?.skill ? path(c.about.skill.backups) : null,
                    control: folderButton("skill-backups"),
                  },
                ],
        },
      ],
    },
    {
      id: "files",
      label: "Files",
      icon: FolderOpen,
      group: 2,
      sections: [
        {
          heading: "Files",
          rows: [
            {
              id: "exports",
              title: "Exports",
              description: "Where Export writes each brainstorm's HTML file, and a theme's CSS and tokens.",
              keywords: "export html folder download",
              detail: c.about ? path(c.about.exports) : null,
              control: folderButton("exports"),
            },
            {
              id: "home",
              title: "Brainstorm's data",
              description: "The database with every brainstorm, iteration and comment, and the app's own files.",
              keywords: "data folder database app data storage",
              detail: c.about ? path(c.about.home) : null,
              control: folderButton("home"),
            },
          ],
        },
      ],
    },
    {
      id: "updates",
      label: "Updates",
      icon: RefreshCw,
      group: 3,
      sections: [
        {
          heading: "Updates",
          rows: [
            {
              id: "version",
              title: c.about === null ? "Brainstorm" : `Brainstorm ${c.about.version}`,
              description: updateStatus(c.update, c.now),
              keywords: "version update check download restart about",
              control:
                move === null ? undefined : (
                  <Button
                    variant={move === "check" ? "outline" : "accent"}
                    onClick={move === "check" ? c.onCheck : move === "download" ? c.onDownload : c.onInstall}
                    data-update-action={move}
                  >
                    {move === "check" ? "Check for updates" : move === "download" ? "Download" : "Restart to update"}
                  </Button>
                ),
            },
            {
              id: "autoUpdate",
              title: "Download updates automatically",
              description: "Download a new version in the background as soon as Brainstorm finds one. Off, Brainstorm still checks, and only tells you when one is out.",
              keywords: "auto update background",
              control: <Switch aria-label="Download updates automatically" checked={s.autoUpdate} onCheckedChange={(on) => c.setting("autoUpdate", on)} data-setting-control="autoUpdate" />,
            },
            {
              id: "releases",
              title: "Release notes",
              description: "What changed in each version, on GitHub.",
              keywords: "changelog whats new github",
              control: (
                <Button nativeButton={false} render={<a href={RELEASES} target="_blank" rel="noreferrer" />}>
                  Open
                  <ArrowUpRight data-icon="inline-end" aria-hidden />
                </Button>
              ),
            },
          ],
        },
      ],
    },
    {
      id: "shortcuts",
      label: "Keyboard shortcuts",
      icon: Keyboard,
      group: 3,
      sections: [
        {
          heading: "Keyboard shortcuts",
          rows: SHORTCUTS.map((k) => ({
            id: `key-${k.title}`,
            title: k.title,
            description: k.description,
            keywords: `keyboard shortcut keybinding ${k.keys}`,
            control: <Kbd>{k.keys}</Kbd>,
          })),
        },
      ],
    },
  ];
}

/** Every word of the query in the row's title, description, keywords or page, so "dark theme" and "skill folder" both find theirs. */
function matches(query: string, page: Page, row: Row): boolean {
  const text = `${page.label} ${row.title} ${row.description} ${row.keywords ?? ""}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
}

function SettingRow({ row }: { row: Row }) {
  return (
    <div className="flex items-center gap-6 border-b border-fg/10 py-3 last:border-b-0" data-setting={row.id}>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-sm font-medium">{row.title}</span>
        <p className="text-sm text-fg-muted">{row.description}</p>
        {row.detail}
      </div>
      {row.control !== undefined && <div className="flex shrink-0 items-center gap-2">{row.control}</div>}
    </div>
  );
}

function SettingSection({ heading, rows }: { heading: string; rows: readonly Row[] }) {
  return (
    <section className="grid" aria-label={heading}>
      <h3 className="pb-1 text-base font-semibold">{heading}</h3>
      {rows.map((row) => (
        <SettingRow key={row.id} row={row} />
      ))}
    </section>
  );
}

/**
 * Settings, laid out as Claude's: a nav of pages with search over it, and the chosen page's rows, each a title and what
 * it does with its control at the end. A search lists every row it finds, under its page's name. Each change saves at
 * once, so there is no Save; Restore defaults puts back every setting here.
 */
export function SettingsDialog({
  open,
  onOpenChange,
  prefs,
  save,
  about,
  update,
  onCheck,
  onDownload,
  onInstall,
  onSkill,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefs: UiPrefs;
  save: (patch: UiPrefsPatch) => void;
  about: AppAbout | null;
  update: AppUpdateState | null;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
  /** Reinstalls the skill and resolves to a line saying what happened, or null when it failed and a notice said so. */
  onSkill: () => Promise<string | null>;
}) {
  const [pageId, setPageId] = useState<SettingsPageId>("general");
  const [query, setQuery] = useState("");
  const [skillNote, setSkillNote] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const now = useNow();
  const all = pages({
    prefs,
    save,
    setting: (name, value) => save({ settings: { [name]: value } }),
    about,
    update,
    now,
    onCheck,
    onDownload,
    onInstall,
    onSkill: () => void onSkill().then((note) => note !== null && setSkillNote(note)),
    skillNote,
  });
  const page = all.find((p) => p.id === pageId) ?? all[0]!;
  const found = useMemo(
    () => (query.trim() === "" ? null : all.flatMap((p) => p.sections.map((s) => ({ heading: `${p.label} · ${s.heading}`, rows: s.rows.filter((r) => matches(query, p, r)) })).filter((s) => s.rows.length > 0))),
    [query, all],
  );

  // "/" puts Rob in the search, as it does on home, unless he's typing somewhere.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !typing) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery("");
      }}
    >
      <DialogContent aria-describedby={undefined} data-settings>
        <DialogHeader heading="Settings">
          <Hint label="Put back every setting here. Pane widths and each brainstorm's own views stay." side="bottom">
            <Button variant="ghost" size="xs" onClick={() => save(RESTORE_DEFAULTS)} data-settings-restore>
              <RotateCcw aria-hidden />
              Restore defaults
            </Button>
          </Hint>
        </DialogHeader>
        <div className="flex min-h-0 flex-1">
          <nav className="flex w-picker shrink-0 flex-col gap-1 border-r border-fg/10 p-3" aria-label="Settings pages">
            <div className="relative pb-2">
              <Search aria-hidden className="pointer-events-none absolute top-2 left-2 size-3.5 text-fg-muted" />
              <Input
                ref={search}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && query !== "") {
                    e.preventDefault();
                    e.stopPropagation();
                    setQuery("");
                  }
                }}
                placeholder="Search"
                aria-label="Search settings"
                className="pr-6 pl-6"
                data-settings-search
              />
              {query === "" && (
                <span className="pointer-events-none absolute top-1 right-1">
                  <Kbd>/</Kbd>
                </span>
              )}
            </div>
            {all.map((p, i) => (
              <Fragment key={p.id}>
                {i > 0 && all[i - 1]!.group !== p.group && <Separator className="my-1 bg-fg/10" />}
                <button
                  type="button"
                  aria-current={found === null && p.id === page.id ? "page" : undefined}
                  onClick={() => {
                    setQuery("");
                    setPageId(p.id);
                  }}
                  className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm text-fg-muted outline-none hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-selected aria-[current=page]:font-medium aria-[current=page]:text-fg [&_svg]:size-4 [&_svg]:shrink-0"
                  data-settings-page={p.id}
                >
                  <p.icon aria-hidden />
                  {p.label}
                </button>
              </Fragment>
            ))}
            <a
              href={RELEASES}
              target="_blank"
              rel="noreferrer"
              className="mt-auto flex h-8 items-center justify-between rounded-md px-2 text-sm text-fg-muted outline-none hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4"
            >
              Release notes
              <ArrowUpRight aria-hidden />
            </a>
          </nav>
          <ScrollPane inset={6} className="grid content-start gap-8 pt-5 pb-6" data-settings-body>
            {found === null ? (
              page.sections.map((s) => <SettingSection key={s.heading} heading={s.heading} rows={s.rows} />)
            ) : found.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <SearchX />
                  </EmptyMedia>
                  <EmptyTitle>No settings match</EmptyTitle>
                  <EmptyDescription>
                    Nothing here mentions <Code>{query.trim()}</Code>.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              found.map((s) => <SettingSection key={s.heading} heading={s.heading} rows={s.rows} />)
            )}
          </ScrollPane>
        </div>
      </DialogContent>
    </Dialog>
  );
}
