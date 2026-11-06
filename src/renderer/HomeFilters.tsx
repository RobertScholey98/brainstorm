import { ArrowDownUp, ChevronDown, Folder, Search, X } from "lucide-react";
import { useEffect, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverFooter, PopoverHeader, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Hint } from "@/components/ui/tooltip";
import type { HomeQuery, HomeSort, HomeStatus } from "../core/prefs";
import type { ProjectId } from "../core/types";
import type { ProjectOption } from "./homeQuery";

const STATUSES: readonly { readonly value: HomeStatus; readonly label: string }[] = [
  { value: "active", label: "Active" },
  { value: "attention", label: "Attention" },
  { value: "settled", label: "Settled" },
  { value: "all", label: "All" },
];

const SORTS: readonly { readonly value: HomeSort; readonly label: string }[] = [
  { value: "recent", label: "Last active" },
  { value: "created", label: "Newest" },
  { value: "title", label: "Title" },
];

const editable = (el: Element | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/**
 * "/" and Ctrl+F put Rob in home's search, the app's one search. "/" waits while he types in another field, so it
 * stays a character there.
 */
export function useSearchShortcut(field: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const find = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f";
      const slash = e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !editable(document.activeElement);
      if (!find && !slash) return;
      e.preventDefault();
      field.current?.focus();
      field.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [field]);
}

/**
 * Home's one row of controls: the search, live as Rob types, then which brainstorms show, from which projects, in
 * what order. Each status names how many it holds under the search and projects as they stand.
 */
export function HomeFilters({
  field,
  search,
  onSearch,
  query,
  onQuery,
  counts,
  projects,
  selected,
}: {
  field: RefObject<HTMLInputElement | null>;
  search: string;
  onSearch: (search: string) => void;
  query: HomeQuery;
  onQuery: (query: HomeQuery) => void;
  /** Null while the first list loads, so no status claims a count of 0 it hasn't counted. */
  counts: Readonly<Record<HomeStatus, number>> | null;
  projects: readonly ProjectOption[];
  /** The projects the filter names that still have a brainstorm; empty is every project. */
  selected: ReadonlySet<ProjectId>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="search" data-home-filters>
      <div className="relative max-w-popover-sm min-w-0 flex-1">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-fg-muted" />
        <Input
          ref={field}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            if (search === "") e.currentTarget.blur();
            else onSearch("");
          }}
          placeholder="Search titles and briefs"
          aria-label="Search brainstorms"
          spellCheck={false}
          className="pr-8 pl-8"
          data-home-search
        />
        <span className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center">
          {search === "" ? (
            <span className="pointer-events-none flex px-1" data-search-key>
              <Kbd>/</Kbd>
            </span>
          ) : (
            <Hint label="Clear search" shortcut="Esc" side="bottom">
              <Button variant="ghost" size="icon-xs" onClick={() => onSearch("")} aria-label="Clear search" data-search-clear>
                <X aria-hidden />
              </Button>
            </Hint>
          )}
        </span>
      </div>
      <Segmented
        fit
        value={query.status}
        onValueChange={(status) => onQuery({ ...query, status })}
        options={STATUSES.map((s) => ({ value: s.value, label: <StatusLabel label={s.label} count={counts?.[s.value] ?? null} /> }))}
        itemData="home-status"
        aria-label="Show"
      />
      <ProjectFilter projects={projects} selected={selected} onChange={(next) => onQuery({ ...query, projects: next })} />
      <Select items={SORTS} value={query.sort} onValueChange={(sort) => sort !== null && onQuery({ ...query, sort })}>
        <SelectTrigger aria-label="Sort" data-home-sort>
          <ArrowDownUp aria-hidden className="size-3.5 text-fg-muted" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value} data-sort-option={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

function StatusLabel({ label, count }: { label: string; count: number | null }): ReactNode {
  return (
    <span className="flex items-center justify-center gap-1.5">
      {label}
      {/* Two digits' room whether or not the count is in, so the row holds still when the first list lands. */}
      <span className="min-w-4 text-left font-normal text-fg-muted tabular-nums" data-status-count={count === null ? undefined : true}>
        {count}
      </span>
    </span>
  );
}

/** Every project with a brainstorm, each a checkbox. None checked is every project, so the filter can't hide them all. */
function ProjectFilter({
  projects,
  selected,
  onChange,
}: {
  projects: readonly ProjectOption[];
  selected: ReadonlySet<ProjectId>;
  onChange: (projects: ProjectId[]) => void;
}) {
  const names = projects.filter((p) => selected.has(p.id)).map((p) => p.label);
  const label = names.length === 0 ? "All projects" : names.length === 1 ? names[0] : `${names.length} projects`;
  const toggle = (id: ProjectId) => onChange(selected.has(id) ? [...selected].filter((p) => p !== id) : [...selected, id]);
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" aria-pressed={names.length > 0} data-project-filter />}>
        <Folder aria-hidden data-icon="inline-start" />
        <span className="max-w-picker truncate">{label}</span>
        <ChevronDown aria-hidden data-icon="inline-end" className="text-fg-muted" />
      </PopoverTrigger>
      <PopoverContent align="start" data-project-menu>
        <PopoverHeader heading="Projects" description="Show brainstorms from the projects you check." />
        <div className="-mx-1.5 flex flex-col" role="group" aria-label="Projects">
          {projects.map((p) => (
            <label key={p.id} className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1.5 hover:bg-hover" data-project-option={p.id}>
              <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} />
              <span className="min-w-0 truncate">{p.label}</span>
              <span className="ml-auto shrink-0 text-xs text-fg-muted tabular-nums">{p.count}</span>
            </label>
          ))}
        </div>
        <PopoverFooter hint={names.length === 0 ? "Showing every project" : `Showing ${names.length} of ${projects.length}`}>
          <Button variant="ghost" disabled={names.length === 0} onClick={() => onChange([])} data-project-all>
            Show all
          </Button>
        </PopoverFooter>
      </PopoverContent>
    </Popover>
  );
}
