import { cva } from "class-variance-authority"

/**
 * The one surface every floating thing is drawn on: popovers, menus, the select list, tooltips, toasts and the pin
 * composer. Only the tone differs, so a tooltip reads as a label and the rest read as panels. `npm run lint:design`
 * fails a raised fill or a floating shadow anywhere else.
 */
export const overlaySurface = cva(
  "origin-(--transform-origin) rounded-lg shadow-md outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
  {
    variants: {
      tone: {
        raised: "bg-raised text-fg ring-1 ring-fg/10",
        inverse: "bg-inverse text-inverse-fg",
      },
    },
    defaultVariants: { tone: "raised" },
  }
)
