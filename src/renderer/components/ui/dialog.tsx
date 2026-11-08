import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "cn"
import { XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Hint } from "@/components/ui/tooltip"
import { overlaySurface } from "@/components/ui/overlay"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

/**
 * A page-sized panel over the window, such as Settings: the overlay surface, centred, as large as the window allows up
 * to 960 by 720. The scrim fades the app behind it in the window's own colour, so it dims in dark and pales in light
 * rather than greying both. Escape and a click on the scrim close it, as the close button does.
 */
function DialogContent({ className, children, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="dialog-overlay"
        className="fixed inset-0 z-popover bg-app/70 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs"
      />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          overlaySurface(),
          "fixed top-1/2 left-1/2 z-popover flex h-[min(720px,calc(100svh-96px))] w-[min(960px,calc(100vw-64px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden",
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

/** The dialog's title row: its title, then any actions, then the close button, over a rule. */
function DialogHeader({ heading, children }: { heading: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div data-slot="dialog-header" className="flex h-12 shrink-0 items-center gap-2 border-b border-fg/10 pr-2 pl-4">
      <DialogPrimitive.Title className="mr-auto text-lg font-semibold">{heading}</DialogPrimitive.Title>
      {children}
      <Hint label="Close" shortcut="Esc" side="bottom">
        <DialogPrimitive.Close render={<Button variant="ghost" size="icon" aria-label="Close" data-dialog-close />}>
          <XIcon />
        </DialogPrimitive.Close>
      </Hint>
    </div>
  )
}

export { Dialog, DialogContent, DialogHeader }
