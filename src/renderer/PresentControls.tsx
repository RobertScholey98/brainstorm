import { AppWindow, ChevronDown, Pause, Presentation } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverFooter, PopoverHeader, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Hint } from "@/components/ui/tooltip";
import type { PreviewPrefs } from "../core/prefs";
import { canOpenPreviewWindow, previewWindow } from "./mirror";

const LOOKS: readonly { value: PreviewPrefs["look"]; label: string; hint: string }[] = [
  { value: "clean", label: "Clean", hint: "The design alone, filling the window, for whoever is watching" },
  { value: "working", label: "Working", hint: "The canvas as it is here, with the slot bar and pins, for your own screen" },
];

/**
 * The canvas bar's right end (ADR 007): Present fills the screen with the slot on the stage, and the preview window
 * mirrors this canvas in a window of its own. While that window is open, Hold keeps it on what it shows, and its menu
 * holds the look, whether this window keeps its canvas, and the window's own commands.
 */
export function PresentControls({
  onPresent,
  open,
  hold,
  onHold,
  prefs,
  onPrefs,
}: {
  onPresent: () => void;
  open: boolean;
  hold: boolean;
  onHold: (hold: boolean) => void;
  prefs: PreviewPrefs;
  onPrefs: (prefs: PreviewPrefs) => void;
}) {
  const windowed = canOpenPreviewWindow();
  return (
    <span className="flex shrink-0 items-center gap-1" data-present-controls>
      {open && (
        <Hint
          label={hold ? "The preview window keeps what it shows. Release to send it your changes" : "Keep the preview window on what it shows while you change things here"}
          side="bottom"
        >
          <Button variant="outline" aria-pressed={hold} onClick={() => onHold(!hold)} data-hold>
            <Pause data-icon="inline-start" aria-hidden />
            {hold ? "Held" : "Hold"}
          </Button>
        </Hint>
      )}
      <Hint name="Present" label="Fill the screen with this slot, as the app would look" shortcut="F5" side="bottom">
        <Button variant="ghost" size="icon" aria-label="Present" onClick={onPresent} data-present>
          <Presentation aria-hidden />
        </Button>
      </Hint>
      {windowed && (open ? <WindowMenu prefs={prefs} onPrefs={onPrefs} /> : <OpenWindow />)}
    </span>
  );
}

function OpenWindow() {
  return (
    <Hint name="Preview window" label="Mirror this canvas in a window of its own, to share or to put on another screen" side="bottom">
      <Button variant="ghost" size="icon" aria-label="Open preview window" onClick={() => previewWindow("open")} data-preview-open>
        <AppWindow aria-hidden />
      </Button>
    </Hint>
  );
}

function WindowMenu({ prefs, onPrefs }: { prefs: PreviewPrefs; onPrefs: (prefs: PreviewPrefs) => void }) {
  const [open, setOpen] = useState(false);
  const run = (command: "open" | "close" | "fullscreen") => {
    setOpen(false);
    previewWindow(command);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint name="Preview window" label="Open. Its look, and whether this window keeps the canvas" side="bottom">
        <PopoverTrigger render={<Button variant="outline" data-preview-menu />}>
          <AppWindow data-icon="inline-start" aria-hidden />
          Preview
          <ChevronDown data-icon="inline-end" aria-hidden />
        </PopoverTrigger>
      </Hint>
      <PopoverContent size="md" align="end" data-preview-popover>
        <PopoverHeader heading="Preview window" description="Mirrors this canvas as you work. Drag it to the screen you share, or to a screen of its own." />
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-fg-muted" id="preview-look">
            Look
          </span>
          <Segmented value={prefs.look} onValueChange={(look) => onPrefs({ ...prefs, look })} options={LOOKS} itemData="preview-look" aria-label="Look" />
          <p className="text-xs text-fg-muted" data-preview-look-about>
            {LOOKS.find((l) => l.value === prefs.look)?.hint}
          </p>
        </div>
        <label className="flex items-start justify-between gap-3">
          <span className="grid gap-0.5">
            <span className="text-sm">Keep the canvas here too</span>
            <span className="text-xs text-fg-muted">Off gives the canvas to the preview window; slots and controls stay here</span>
          </span>
          <Switch checked={prefs.here} onCheckedChange={(here) => onPrefs({ ...prefs, here })} className="mt-0.5" data-preview-here />
        </label>
        <PopoverFooter>
          <Button variant="ghost" onClick={() => run("close")} data-preview-close>
            Close window
          </Button>
          <Button variant="outline" onClick={() => run("open")} data-preview-front>
            Bring to front
          </Button>
          <Hint label="Fill the screen it is on. F11 in the window does the same, and Escape leaves" side="bottom">
            <Button variant="outline" onClick={() => run("fullscreen")} data-preview-fullscreen>
              Full screen
            </Button>
          </Hint>
        </PopoverFooter>
      </PopoverContent>
    </Popover>
  );
}
