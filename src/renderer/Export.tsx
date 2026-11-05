import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ExportResult } from "../core/types";

export function ExportButton({ disabled, exportHtml }: { disabled: boolean; exportHtml: () => Promise<ExportResult | null> }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ExportResult | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (done === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDone(null);
    const onDown = (e: PointerEvent) => !panel.current?.contains(e.target as Node) && setDone(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [done]);

  const run = async () => {
    setBusy(true);
    setDone(await exportHtml());
    setBusy(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled || busy}
        title={disabled ? "Export needs a first iteration" : "Save the current iteration, with your adjustments, as one HTML file"}
        onClick={() => void run()}
        data-export
        className="flex h-7 items-center gap-1.5 rounded-md border border-border px-3 text-[12px] font-medium hover:bg-accent disabled:opacity-45"
      >
        {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
        Export
      </button>
      {done !== null && (
        <div
          ref={panel}
          role="dialog"
          aria-label="Exported"
          data-exported
          className="absolute top-[calc(100%+6px)] right-0 z-30 grid w-[340px] gap-2 rounded-lg border border-border bg-background p-3 text-[12px] shadow-[0_16px_40px_-16px_rgb(0_0_0/0.4)]"
        >
          <p className="font-semibold">Exported</p>
          <p className="leading-relaxed text-muted-foreground">One HTML file that opens offline, with your adjustments and variant choices.</p>
          <code className="rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] leading-snug break-all select-all" data-export-path>
            {done.path}
          </code>
          <div className="flex justify-end gap-1.5 pt-1">
            <button type="button" onClick={() => setDone(null)} className="h-7 rounded-md px-2.5 font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
              Done
            </button>
            <a
              href={`/reveal-export/${encodeURIComponent(done.file)}`}
              target="_blank"
              rel="noreferrer"
              data-reveal
              className="flex h-7 items-center rounded-md bg-primary px-3 font-medium text-primary-foreground hover:opacity-90"
            >
              Show in folder
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
