import { ArrowUpCircle, Check, ChevronRight, Download, ExternalLink, Palette, RotateCcw, Send } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Count } from "@/components/ui/count";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverFooter, PopoverHeader, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { BlockedHint, Hint } from "@/components/ui/tooltip";
import { Truncate } from "@/components/ui/truncate";
import type { ProposedName, ProposedView, RobAction, SessionSystemView, ThemeExport, Token } from "../core/types";
import { ExportPath } from "./Export";

const DEFAULT = "__default";

/**
 * The Inspector's design system section (ADR 007): the version the session builds with, its theme, which belongs to the
 * session, and the components the design proposed because the kit had nothing that fit.
 */
export function SystemSection({
  system,
  readOnly,
  send,
  exportTheme,
}: {
  system: SessionSystemView;
  /** A past iteration is on the canvas, so the theme shows but doesn't change. */
  readOnly: boolean;
  send: (action: RobAction) => Promise<unknown>;
  exportTheme: () => Promise<ThemeExport | null>;
}) {
  const behind = system.latest > system.n;
  const check = system.upgrade.check;
  return (
    <section className="border-t" aria-label="Design system" data-system-panel={system.id}>
      <header className="flex items-center gap-2 py-3">
        <h2 className="text-base font-semibold">Design system</h2>
        <span className="ml-auto flex min-w-0 items-center gap-1.5 text-sm text-fg-muted">
          <Truncate>{system.name}</Truncate>
          <Badge data-system-version={system.n}>v{system.n}</Badge>
        </span>
      </header>
      {behind && (
        <div className="pb-3">
          <Callout
            tone={check?.state === "breaks" ? "warning" : "info"}
            heading={`Version ${system.latest} is out`}
            data-upgrade-check={check?.state}
            actions={
              <Button variant="outline" disabled={check?.state === "breaks"} onClick={() => void send({ kind: "upgrade_system" })} data-system-upgrade>
                <ArrowUpCircle data-icon="inline-start" aria-hidden />
                Upgrade to v{system.latest}
              </Button>
            }
          >
            {(system.upgrade.added.length > 0 || system.upgrade.removed.length > 0) && (
              <p data-system-upgrade-changes>
                {[
                  system.upgrade.added.length > 0 && `It adds ${list(system.upgrade.added)}`,
                  system.upgrade.removed.length > 0 && `${system.upgrade.added.length > 0 ? "and removes" : "It removes"} ${list(system.upgrade.removed)}`,
                ]
                  .filter(Boolean)
                  .join(" ")}
                .
              </p>
            )}
            {check === null || check.state === "checking" ? (
              <p className="flex items-center gap-1.5" data-upgrade-checking>
                <Spinner />
                Checking every block against it…
              </p>
            ) : check.state === "clean" ? (
              <p className="flex items-center gap-1.5" data-upgrade-clean>
                <Check aria-hidden className="size-3.5 shrink-0 text-success" />
                Nothing breaks: every block builds with it.
              </p>
            ) : (
              <p data-upgrade-breaks>
                It breaks {list(check.where)}, with {check.errors === 1 ? "1 error" : `${check.errors} errors`}, so this brainstorm stays on v{system.n} for now.
              </p>
            )}
          </Callout>
        </div>
      )}
      {system.proposed.length > 0 && <ProposedList system={system} send={send} />}
      <ThemeEditor system={system} readOnly={readOnly} send={send} exportTheme={exportTheme} />
    </section>
  );
}

function ThemeEditor({ system, readOnly, send, exportTheme }: Parameters<typeof SystemSection>[0]) {
  const { theme } = system;
  const colours = useMemo(() => system.tokens.filter((t) => t.origin === "system" && t.kind === "color"), [system.tokens]);
  const others = useMemo(() => system.tokens.filter((t) => t.origin === "system" && t.kind !== "color" && t.kind !== "other"), [system.tokens]);
  const tweaked = Object.keys(theme.axes).length + Object.keys(theme.tokens).length;
  return (
    <div className="grid grid-cols-1 gap-3 border-t py-3" inert={readOnly} data-theme-editor data-tweaks={tweaked}>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">Theme</h3>
        {tweaked > 0 && <span className="text-xs text-fg-muted">{tweaked === 1 ? "1 tweak" : `${tweaked} tweaks`} here</span>}
        <Button variant="ghost" size="xs" className="ml-auto" disabled={tweaked === 0} onClick={() => void send({ kind: "reset_theme" })} data-theme-reset>
          <RotateCcw data-icon="inline-start" aria-hidden />
          Reset
        </Button>
      </div>
      {system.axes.map((axis) => (
        <label key={axis.attribute} className="grid grid-cols-1 gap-1.5 text-xs text-fg-muted" data-theme-axis={axis.attribute}>
          {axisLabel(axis.attribute)}
          <AxisControl
            label={axisLabel(axis.attribute)}
            value={theme.axes[axis.attribute] ?? DEFAULT}
            onChange={(value) => void send({ kind: "set_theme_axis", axis: axis.attribute, value: value === DEFAULT ? null : value })}
            options={[{ value: DEFAULT, label: capital(axis.default ?? "Default") }, ...axis.values.filter((v) => v !== axis.default).map((v) => ({ value: v, label: capital(v) }))]}
          />
        </label>
      ))}
      {colours.length > 0 && <TokenList heading="Colours" tokens={colours} theme={theme.tokens} axes={theme.axes} send={send} />}
      {others.length > 0 && <TokenList heading="Sizes and type" tokens={others} theme={theme.tokens} axes={theme.axes} send={send} />}
      {/* Two equal columns, so the theme's actions line up however many there are. */}
      <div className="grid grid-cols-2 gap-2">
        <SaveTheme disabled={tweaked === 0} onSave={(name) => send({ kind: "save_theme", name })} />
        <ThemeExportButton exportTheme={exportTheme} />
        {system.themes.length > 0 && (
          <div className="col-span-2 grid">
            <SavedThemes names={system.themes.map((t) => t.name)} onApply={(name) => void send({ kind: "apply_theme", name })} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Up to three values fit side by side in the Inspector; more, such as a palette of accents, go in a select. */
function AxisControl({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: readonly { value: string; label: string }[] }) {
  if (options.length <= 3) return <Segmented aria-label={label} value={value} onValueChange={onChange} options={options} itemData="axis-value" />;
  return (
    <Select items={options} value={value} onValueChange={(v) => v !== null && onChange(v)}>
      <SelectTrigger aria-label={label} className="w-full" data-axis-select>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} data-axis-value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

const capital = (s: string) => s.replace(/^\w/, (c) => c.toUpperCase());
const axisLabel = (attribute: string) => (attribute === "class" ? "Theme class" : attribute === "data-theme" ? "Mode" : capital(attribute.replace(/^data-/, "")));
const list = (names: readonly string[]) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** The value a token takes under the session's axes: the axis value's own, else the root's. */
function baseValue(token: Token, axes: Readonly<Record<string, string>>): string {
  for (const [attribute, value] of Object.entries(axes)) {
    const set = token.byAxis[`${attribute}=${value}`];
    if (set !== undefined) return set;
  }
  return token.value;
}

function TokenList({
  heading,
  tokens,
  theme,
  axes,
  send,
}: {
  heading: string;
  tokens: readonly Token[];
  theme: Readonly<Record<string, string>>;
  axes: Readonly<Record<string, string>>;
  send: (action: RobAction) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const set = tokens.filter((t) => theme[t.name] !== undefined);
  const row = (t: Token) => <TokenRow key={t.name} token={t} value={theme[t.name] ?? null} base={baseValue(t, axes)} send={send} />;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="grid grid-cols-1 gap-1" data-token-list={heading}>
      <CollapsibleTrigger className="group/tokens -mx-1 flex h-7 cursor-pointer items-center gap-1.5 rounded-sm px-1 text-xs text-fg-muted hover:bg-hover hover:text-fg">
        <ChevronRight aria-hidden className="size-3.5 transition-transform group-data-[panel-open]/tokens:rotate-90" />
        {heading}
        <Count className="ml-auto">{tokens.length}</Count>
      </CollapsibleTrigger>
      {/* Folded, the list still shows the tokens this brainstorm changed. */}
      {!open && set.length > 0 && (
        <div className="grid grid-cols-1 gap-1 border-l pl-2" data-token-changed>
          <span className="text-xs text-fg-muted">Changed here</span>
          <ul className="grid grid-cols-1 gap-1">{set.map(row)}</ul>
        </div>
      )}
      <CollapsibleContent>
        <ul className="grid grid-cols-1 gap-1">{tokens.map(row)}</ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function TokenRow({ token, value, base, send }: { token: Token; value: string | null; base: string; send: (action: RobAction) => Promise<unknown> }) {
  const shown = value ?? base;
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = () => {
    const next = draft.trim();
    if (next === shown) return;
    if (next === "" || next === base) void send({ kind: "clear_theme_token", token: token.name });
    else void send({ kind: "set_theme_token", token: token.name, value: next });
  };
  return (
    <li className="flex items-center gap-2" data-token={token.name} data-token-set={value !== null || undefined}>
      {token.kind === "color" && <Swatch value={shown} />}
      <span className="flex min-w-0 flex-1 font-mono text-xs">
        <Truncate>{token.name}</Truncate>
      </span>
      <Input
        aria-label={token.name}
        className="h-7 w-1/2 shrink-0 font-mono text-xs"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(shown);
        }}
      />
      {value !== null ? (
        <Hint label={`Back to ${base}`} side="left">
          <Button variant="ghost" size="icon-xs" aria-label={`Reset ${token.name}`} onClick={() => void send({ kind: "clear_theme_token", token: token.name })}>
            <RotateCcw aria-hidden />
          </Button>
        </Hint>
      ) : (
        <span className="size-6 shrink-0" />
      )}
    </li>
  );
}

/** A token's colour, drawn with the value itself, so a swatch shows what a block on the canvas does. */
function Swatch({ value }: { value: string }) {
  return <span aria-hidden className="size-4 shrink-0 rounded-sm ring-1 ring-border-strong" style={{ background: value }} />;
}

function SaveTheme({ disabled, onSave }: { disabled: boolean; onSave: (name: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const save = async () => {
    if (name.trim() === "") return;
    await onSave(name.trim());
    setOpen(false);
    setName("");
  };
  const trigger = (
    <PopoverTrigger disabled={disabled} render={<Button variant="outline" data-theme-save />}>
      <Palette data-icon="inline-start" aria-hidden />
      Save as theme
    </PopoverTrigger>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {disabled ? (
        <BlockedHint label="Tweak the theme first" side="top">
          {trigger}
        </BlockedHint>
      ) : (
        trigger
      )}
      <PopoverContent size="md" align="start">
        <PopoverHeader heading="Save as theme" description="Saved with the design system, so any brainstorm that uses it can apply it." />
        <Input aria-label="Theme name" placeholder="Rose night" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save()} autoFocus />
        <PopoverFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="accent" disabled={name.trim() === ""} onClick={() => void save()} data-theme-save-confirm>
            Save
          </Button>
        </PopoverFooter>
      </PopoverContent>
    </Popover>
  );
}

function SavedThemes({ names, onApply }: { names: readonly string[]; onApply: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" data-theme-saved />}>Apply saved theme…</PopoverTrigger>
      <PopoverContent size="sm" align="start">
        <PopoverHeader heading="Saved themes" description="Applying one replaces this brainstorm's tweaks." />
        <ul className="grid gap-1">
          {names.map((name) => (
            <li key={name}>
              <button
                type="button"
                className="flex h-7 w-full items-center rounded-md px-2 text-left text-sm outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  onApply(name);
                  setOpen(false);
                }}
                data-theme-apply={name}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function ThemeExportButton({ exportTheme }: { exportTheme: () => Promise<ThemeExport | null> }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<ThemeExport | null>(null);
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setDone(null);
    void exportTheme().then((r) => (r === null ? setOpen(false) : setDone(r)));
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Hint label="Write this theme as CSS variables and design tokens" side="top">
        <PopoverTrigger render={<Button variant="outline" data-theme-export />}>
          <Download data-icon="inline-start" aria-hidden />
          Export theme
        </PopoverTrigger>
      </Hint>
      <PopoverContent size="md" align="start" data-theme-exported={done !== null || undefined}>
        {done === null ? (
          <PopoverHeader icon={<Spinner className="text-fg-muted" />} heading="Exporting" description="Writing the theme's CSS and tokens." />
        ) : (
          <>
            <PopoverHeader
              icon={<Check aria-hidden className="size-4 text-success" />}
              heading="Exported"
              description="CSS custom properties to paste into the app, and the same values as design tokens."
            />
            <ExportPath path={done.css.path} />
            <ExportPath path={done.json.path} />
            <PopoverFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Done
              </Button>
              <Button nativeButton={false} render={<a href={`/reveal-export/${encodeURIComponent(done.css.file)}`} target="_blank" rel="noreferrer" />}>
                Show in folder
              </Button>
            </PopoverFooter>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ProposedList({ system, send }: { system: SessionSystemView; send: (action: RobAction) => Promise<unknown> }) {
  const pending = system.proposed.filter((p) => !p.fromKit);
  const adopted = system.proposed.filter((p) => p.fromKit);
  return (
    <div className="grid gap-2 border-t py-3" data-proposed-list>
      {pending.length > 0 && (
        <>
          <h3 className="text-sm font-medium">Not in the system</h3>
          <p className="text-xs/relaxed text-fg-muted">The kit had nothing that fit, so the design proposes these. Promote one to add it to the library.</p>
          <ul className="grid gap-2">
            {pending.map((p) => (
              <ProposedRow key={p.name} proposed={p} library={system.name} canPromote={system.canPromote} onPromote={(name) => void send({ kind: "promote", name })} />
            ))}
          </ul>
        </>
      )}
      {adopted.length > 0 && (
        <div className="grid gap-1" data-proposed-adopted>
          <h3 className="text-sm font-medium">Now in the kit</h3>
          <ul className="grid gap-1">
            {adopted.map((p) => (
              <li key={p.name} className="flex items-center gap-2 text-xs/relaxed text-fg-muted" data-proposed={p.name} data-from-kit>
                <Check aria-hidden className="size-3.5 shrink-0 text-success" />
                <span>
                  <span className="font-mono text-fg">{p.name}</span> since v{p.inSystem}. {p.usedBy.join(", ")} {p.usedBy.length === 1 ? "uses" : "use"} the kit's
                  component now.
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ProposedRow({
  proposed,
  library,
  canPromote,
  onPromote,
}: {
  proposed: ProposedView;
  library: string;
  canPromote: boolean;
  onPromote: (name: ProposedName) => void;
}) {
  const promotion = proposed.promotion;
  const inSystem = proposed.inSystem;
  let status: ReactNode = null;
  if (inSystem !== null) status = <span className="text-xs text-success">In v{inSystem}; upgrade to use it from the kit</span>;
  else if (promotion?.state === "starting") status = <span className="text-xs text-fg-muted">Starting the thread…</span>;
  else if (promotion?.state === "started") {
    status = (
      <span className="flex items-center gap-2 text-xs text-fg-muted" data-promote-status>
        <span className="min-w-0">Adding to {library} in a T3 thread</span>
        {promotion.link !== null && (
          <Button variant="ghost" size="xs" className="ml-auto shrink-0" nativeButton={false} render={<a href={promotion.link} target="_blank" rel="noreferrer" />} data-promote-thread>
            <ExternalLink data-icon="inline-start" aria-hidden />
            Open thread
          </Button>
        )}
      </span>
    );
  }
  else if (promotion?.state === "failed") status = <span className="text-xs text-danger">Couldn't start: {promotion.error}</span>;
  const button = (
    <Button variant="outline" size="xs" disabled={!canPromote || promotion?.state === "starting"} onClick={() => onPromote(proposed.name)} data-promote={proposed.name}>
      <Send data-icon="inline-start" aria-hidden />
      {promotion?.state === "failed" ? "Try again" : "Promote"}
    </Button>
  );
  return (
    <li className="grid grid-cols-1 gap-1 rounded-md p-2 inset-ring inset-ring-border" data-proposed={proposed.name} data-promotion={promotion?.state}>
      <div className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium">
            <Truncate>{proposed.title}</Truncate>
          </span>
          <span className="flex items-center gap-1.5 text-xs text-fg-muted">
            <span className="font-mono">{proposed.name}</span>
            {proposed.tier !== null && <span data-proposed-tier={proposed.tier}>· {proposed.tier}</span>}
          </span>
        </span>
        {inSystem !== null || promotion?.state === "started" ? null : canPromote ? (
          button
        ) : (
          <BlockedHint label="Brainstorm doesn't know the library's T3 project yet" side="left">
            {button}
          </BlockedHint>
        )}
      </div>
      <p className="text-xs/relaxed text-fg-muted">{proposed.description}</p>
      <p className="text-xs text-fg-muted">
        Used by {proposed.usedBy.length === 0 ? "no block" : proposed.usedBy.join(", ")}
      </p>
      {status}
    </li>
  );
}
