import { AppWindow, ChevronDown, CirclePause, EyeOff, Maximize } from "lucide-react";
import { cn } from "cn";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverFooter, PopoverHeader, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Hint } from "@/components/ui/tooltip";
import type { PreviewPrefs } from "../core/prefs";
import { BAR_COLLAPSE, COMPACT, COMPACT_LABEL } from "./headerAction";
import { canOpenPreviewWindow, previewWindow } from "./mirror";

const LOOKS: readonly { value: PreviewPrefs["look"]; label: string; about: string }[] = [
  { value: "clean", label: "Clean", about: "just the design, ready to share." },
  { value: "working", label: "Working", about: "canvas, slot tabs and pins. Not for sharing." },
];

/**
 * The canvas bar's right end (ADR 007), all outline buttons, so they read as one group whether labelled or not. Present sits last and never moves; the preview window's controls grow to its
 * left: the window's button while it is shut, then Hold and the window's menu while it is open.
 */
export function PresentControls({
  onPresent,
  open,
  hold,
  heldOn,
  onHold,
  prefs,
  onPrefs,
}: {
  onPresent: () => void;
  open: boolean;
  hold: boolean;
  /** What the preview window is held on, such as "The wheel · Slot reel". */
  heldOn: string | null;
  onHold: (hold: boolean) => void;
  prefs: PreviewPrefs;
  onPrefs: (prefs: PreviewPrefs) => void;
}) {
  const windowed = canOpenPreviewWindow();
  return (
    <span className="flex shrink-0 items-center gap-1" data-present-controls>
      {windowed && open && <HoldButton hold={hold} heldOn={heldOn} onHold={onHold} />}
      {windowed && (open ? <WindowMenu prefs={prefs} onPrefs={onPrefs} hold={hold} onHold={onHold} /> : <OpenWindow />)}
      <Hint name="Present" label="Fill the screen with this slot" shortcut="F5" side="bottom">
        <Button variant="outline" size="icon" aria-label="Present" onClick={onPresent} data-present>
          <Maximize aria-hidden />
        </Button>
      </Hint>
    </span>
  );
}

/** Pressed while held, its label kept: the bar under the canvas bar names what the window is held on and offers Resume live. */
function HoldButton({ hold, heldOn, onHold }: { hold: boolean; heldOn: string | null; onHold: (hold: boolean) => void }) {
  return (
    <Hint
      name={hold ? "Preview window held" : "Hold preview window"}
      label={
        hold
          ? `It shows ${heldOn ?? "what it showed"}. Resume live sends your latest changes`
          : "Keep it on what it shows now while you keep editing here"
      }
      side="bottom"
    >
      <Button variant="caution" aria-pressed={hold} onClick={() => onHold(!hold)} className={COMPACT} data-collapse={BAR_COLLAPSE.hold} data-hold>
        <CirclePause data-icon="inline-start" className={hold ? "text-warning" : undefined} aria-hidden />
        <span className={COMPACT_LABEL}>
          Hold
          <span className="data-collapsed:hidden" data-collapse={BAR_COLLAPSE.holdSuffix}>
            {" preview"}
          </span>
        </span>
      </Button>
    </Hint>
  );
}

function OpenWindow() {
  return (
    <Hint name="Preview window" label="Mirror this canvas in a window of its own, to share or to put on another screen" side="bottom">
      <Button variant="outline" size="icon" aria-label="Open preview window" onClick={() => previewWindow("open")} data-preview-open>
        <AppWindow aria-hidden />
      </Button>
    </Hint>
  );
}

function WindowMenu({
  prefs,
  onPrefs,
  hold,
  onHold,
}: {
  prefs: PreviewPrefs;
  onPrefs: (prefs: PreviewPrefs) => void;
  hold: boolean;
  onHold: (hold: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const run = (command: "open" | "close" | "fullscreen") => {
    setOpen(false);
    previewWindow(command);
  };
  const look = LOOKS.find((l) => l.value === prefs.look) ?? LOOKS[0];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint name={`Preview window · ${look?.label} look`} label="Change its look, hold it or close it" side="bottom">
        <PopoverTrigger
          render={<Button variant="caution" aria-label={`Preview window, ${look?.label}`} data-warn={prefs.look === "working" || undefined} data-preview-menu />}
        >
          {/* As wide as its widest look, so changing the look moves nothing in the bar: each look's glyph and words are one
              group, centred in that room, the chevron fixed at the end. Working is the look that isn't for sharing, so
              the button takes the warning tone, as Hold does when held. */}
          <span className="grid justify-items-center" data-preview-menu-look>
            {LOOKS.map((l) => (
              <span
                key={l.value}
                className={cn("col-start-1 row-start-1 flex items-center gap-1.5", l.value !== prefs.look && "invisible")}
                aria-hidden={l.value !== prefs.look || undefined}
              >
                {l.value === "working" ? <EyeOff data-icon="inline-start" className="text-warning" aria-hidden /> : <AppWindow data-icon="inline-start" aria-hidden />}
                <span className="text-fg-muted data-collapsed:hidden" data-collapse={BAR_COLLAPSE.preview}>
                  Preview
                </span>
                {l.label}
              </span>
            ))}
          </span>
          <ChevronDown data-icon="inline-end" aria-hidden />
        </PopoverTrigger>
      </Hint>
      <PopoverContent size="md" align="end" data-preview-popover>
        <PopoverHeader
          heading="Preview window"
          description="Mirrors this canvas live."
        />
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-fg-muted">Look</span>
          <Segmented value={prefs.look} onValueChange={(next) => onPrefs({ ...prefs, look: next })} options={LOOKS} itemData="preview-look" aria-label="Look" />
          <ul className="grid gap-0.5 text-xs" data-preview-look-about>
            {LOOKS.map((l) => (
              <li key={l.value} className={l.value === prefs.look ? "text-fg" : "text-fg-muted"} data-chosen={l.value === prefs.look || undefined}>
                <span className={l.value === prefs.look ? "font-semibold" : "font-medium"}>{l.label}:</span> {l.about}
              </li>
            ))}
          </ul>
        </div>
        <label className="flex items-start justify-between gap-3">
          <span className="grid gap-0.5">
            <span className="text-sm">Hold preview</span>
            <span className="text-xs text-fg-muted">Freeze the preview window while you try things here. Resume live shows your latest changes.</span>
          </span>
          <Switch checked={hold} onCheckedChange={onHold} className="mt-0.5" data-preview-menu-hold />
        </label>
        <label className="flex items-start justify-between gap-3">
          <span className="grid gap-0.5">
            <span className="text-sm">Show canvas in main window</span>
            <span className="text-xs text-fg-muted">Turn off to use the canvas only in the preview window. Controls stay here.</span>
          </span>
          <Switch checked={prefs.here} onCheckedChange={(here) => onPrefs({ ...prefs, here })} className="mt-0.5" data-preview-here />
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="outline" onClick={() => run("open")} data-preview-front>
            Bring preview to front
          </Button>
          <Button variant="outline" onClick={() => run("fullscreen")} data-preview-fullscreen>
            Full screen preview
          </Button>
        </div>
        <PopoverFooter hint="F11 works in the preview window too.">
          <Button variant="ghost" onClick={() => run("close")} data-preview-close>
            Close preview
          </Button>
        </PopoverFooter>
      </PopoverContent>
    </Popover>
  );
}
