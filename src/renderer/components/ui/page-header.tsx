import type { ReactNode } from "react"

/**
 * A page's heading in the main card, such as the home overview's. It is the only place the title step of the type
 * scale is used, so every page title has the same presence; `npm run lint:design` fails `text-title` anywhere else.
 * `inline` sets a short description beside the heading rather than under it, for a page that needs the height.
 */
function PageHeader({ heading, description, inline = false }: { heading: ReactNode; description?: ReactNode; inline?: boolean }) {
  return (
    <header data-slot="page-header" className={inline ? "flex min-w-0 items-baseline gap-3" : "grid gap-1"}>
      <h1 className="shrink-0 text-title font-semibold tracking-tight">{heading}</h1>
      {description !== undefined && <div className="flex min-w-0 text-sm text-fg-muted">{description}</div>}
    </header>
  )
}

export { PageHeader }
