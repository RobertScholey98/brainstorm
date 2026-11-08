import { AppWindow, ChevronDown, Maximize, Pause } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverFooter, PopoverHeader, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Hint } from "@/components/ui/tooltip";
import type { PreviewPrefs } from "../core/prefs";
import { BAR_COLLAPSE, COMPACT, COMPACT_LABEL } from "./headerAction";
import { canOpenPreviewWindow, previewWindow } from "./mirror";

const LOOKS: readonly { value: PreviewPrefs["look"]; label: string; about: string }[] = [
  { value: "clean", label: "Clean", about: "The design alone, filling the window. Safe to share." },
  { value: "working", label: "Working", about: "The canvas as it is here, with slot tabs, pins and Pin comment. For your own screen." },
];

/**
 * The canvas bar's right end (ADR 007). Present sits last and never moves; the preview window's controls grow to its
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
      {windowed && (open ? <WindowMenu prefs={prefs} onPrefs={onPrefs} /> : <OpenWindow />)}
      <Hint name="Present" label="Fill the screen with this slot, as the app would look" shortcut="F5" side="bottom">
        <Button variant="ghost" size="icon" aria-label="Present" onClick={onPresent} data-present>
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
      name={hold ? "Preview held" : "Hold preview"}
      label={
        hold
          ? `It shows ${heldOn ?? "what it showed"} until you resume live`
          : "Keep the preview window on what it shows now, while you try things here"
      }
      side="bottom"
    >
      <Button variant="outline" aria-pressed={hold} onClick={() => onHold(!hold)} className={COMPACT} data-collapse={BAR_COLLAPSE.hold} data-hold>
        <Pause data-icon="inline-start" aria-hidden />
        <span className={COMPACT_LABEL}>Hold preview</span>
      </Button>
    </Hint>
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
  const look = LOOKS.find((l) => l.value === prefs.look) ?? LOOKS[0];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint name={`Preview window is open · ${look?.label}`} label="Change its look, or bring it to front, full screen or closed" side="bottom">
        <PopoverTrigger render={<Button variant="outline" className={COMPACT} data-collapse={BAR_COLLAPSE.preview} data-preview-menu />}>
          <AppWindow data-icon="inline-start" aria-hidden />
          <span className={COMPACT_LABEL}>
            Preview
            <span className="text-fg-muted data-collapsed:hidden" data-collapse={BAR_COLLAPSE.look} data-preview-menu-look>
              {" · "}
              {look?.label}
            </span>
          </span>
          <ChevronDown data-icon="inline-end" className="in-data-collapsed:hidden" aria-hidden />
        </PopoverTrigger>
      </Hint>
      <PopoverContent size="md" align="end" data-preview-popover>
        <PopoverHeader
          heading="Preview window"
          description="Mirrors this canvas live. Hold preview, beside this menu, freezes it while you try things."
        />
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-fg-muted">Look</span>
          <Segmented value={prefs.look} onValueChange={(next) => onPrefs({ ...prefs, look: next })} options={LOOKS} itemData="preview-look" aria-label="Look" />
          <ul className="grid gap-0.5 text-xs" data-preview-look-about>
            {LOOKS.map((l) => (
              <li key={l.value} className={l.value === prefs.look ? "text-fg" : "text-fg-muted"} data-chosen={l.value === prefs.look || undefined}>
                <span className="font-medium">{l.label}:</span> {l.about}
              </li>
            ))}
          </ul>
        </div>
        <label className="flex items-start justify-between gap-3">
          <span className="grid gap-0.5">
            <span className="text-sm">Show the canvas in this window</span>
            <span className="text-xs text-fg-muted">Off moves it to the preview window. Slots and controls stay here.</span>
          </span>
          <Switch checked={prefs.here} onCheckedChange={(here) => onPrefs({ ...prefs, here })} className="mt-0.5" data-preview-here />
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="outline" onClick={() => run("open")} data-preview-front>
            Bring to front
          </Button>
          <Button variant="outline" onClick={() => run("fullscreen")} data-preview-fullscreen>
            Full screen
            <Kbd>F11</Kbd>
          </Button>
        </div>
        <PopoverFooter hint="Closes when Brainstorm quits.">
          <Button variant="ghost" onClick={() => run("close")} data-preview-close>
            Close window
          </Button>
        </PopoverFooter>
      </PopoverContent>
    </Popover>
  );
}
