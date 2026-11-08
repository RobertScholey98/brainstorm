import { Check, Download } from "lucide-react";
import { Fragment, useRef, useState } from "react";
import { cn } from "cn";
import { chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverFooter, PopoverHeader, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Hint } from "@/components/ui/tooltip";
import type { ExportResult } from "../core/types";
import { COLLAPSE, COMPACT, COMPACT_LABEL } from "./headerAction";

/** Each open or close starts a new attempt, so an export that finishes after its popover closed changes nothing. */
export function ExportButton({ disabled, exportHtml }: { disabled: boolean; exportHtml: () => Promise<ExportResult | null> }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<ExportResult | null>(null);
  const attempt = useRef(0);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    const mine = ++attempt.current;
    if (!next) return;
    setDone(null);
    void exportHtml().then((result) => {
      if (attempt.current !== mine) return;
      if (result === null) setOpen(false);
      else setDone(result);
    });
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Hint name="Export" label={disabled ? "Needs a first iteration" : "Save the current iteration, with your settings, as one HTML file"} side="left">
        <span tabIndex={disabled ? 0 : -1} className="inline-flex">
          <PopoverTrigger disabled={disabled} render={<Button variant="outline" className={COMPACT} data-collapse={COLLAPSE.export} data-export />}>
            <Download data-icon="inline-start" aria-hidden />
            <span className={COMPACT_LABEL}>Export</span>
          </PopoverTrigger>
        </span>
      </Hint>
      <PopoverContent size="md" align="end" data-exported={done !== null || undefined}>
        {/* Both titles lead with a 16 px glyph, the spinner then the check, so the title holds still as the file lands. */}
        {done === null ? (
          <PopoverHeader
            icon={<Spinner className="text-fg-muted" />}
            heading={<span data-export-title>Exporting</span>}
            description="Writing one HTML file with your settings and variant choices."
          />
        ) : (
          <>
            <PopoverHeader
              icon={<Check aria-hidden className="size-4 text-success" />}
              heading={<span data-export-title>Exported</span>}
              description="One HTML file that opens offline, with your settings and variant choices."
            />
            <ExportPath path={done.path} />
            <PopoverFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Done
              </Button>
              <Button
                nativeButton={false}
                render={<a href={`/reveal-export/${encodeURIComponent(done.file)}`} target="_blank" rel="noreferrer" />}
                data-reveal
              >
                Show in folder
              </Button>
            </PopoverFooter>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The folder, then the file name on its own line. The folder may break only after a separator, and a segment never
 * breaks inside itself, not even at a hyphen; the text is still the whole path for copying.
 */
export function ExportPath({ path }: { path: string }) {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")) + 1;
  const segments = path.slice(0, cut).split(/(?<=[\\/])/);
  return (
    <code className={cn(chip, "grid gap-0.5 rounded-md px-2 py-1.5 font-mono text-xs/snug text-fg select-all")} data-export-path>
      <span className="text-fg-muted">
        {segments.map((segment, i) => (
          <Fragment key={i}>
            <span className="whitespace-nowrap">{segment}</span>
            <wbr />
          </Fragment>
        ))}
      </span>
      <span className="font-medium break-all text-fg">{path.slice(cut)}</span>
    </code>
  );
}
