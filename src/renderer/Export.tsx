import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import type { ExportResult } from "../core/types";

/**
 * Opening the popover runs the export; it shows the file once it's written, or closes if it failed. Each open or
 * close starts a new attempt, so an export that finishes after its popover closed changes nothing.
 */
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
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            variant="outline"
            size="sm"
            title={disabled ? "Export needs a first iteration" : "Save the current iteration, with your adjustments, as one HTML file"}
            data-export
          />
        }
      >
        Export
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] gap-3 p-3" data-exported={done !== null || undefined}>
        {done === null ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Spinner />
            Writing the file…
          </p>
        ) : (
          <>
            <PopoverHeader>
              <PopoverTitle>Exported</PopoverTitle>
              <PopoverDescription>One HTML file that opens offline, with your adjustments and variant choices.</PopoverDescription>
            </PopoverHeader>
            <code className="rounded-md bg-muted px-2 py-1.5 font-mono text-xs/snug break-all select-all" data-export-path>
              {done.path}
            </code>
            <div className="flex justify-end gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Done
              </Button>
              <Button
                size="sm"
                nativeButton={false}
                render={<a href={`/reveal-export/${encodeURIComponent(done.file)}`} target="_blank" rel="noreferrer" />}
                data-reveal
              >
                Show in folder
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
