import type { ReactNode } from "react"

/**
 * A page's heading in the main card, such as the home overview's. It is the only place the title step of the type
 * scale is used, so every page title has the same presence; `npm run lint:design` fails `text-title` anywhere else.
 */
function PageHeader({ heading, description }: { heading: ReactNode; description?: ReactNode }) {
  return (
    <header data-slot="page-header" className="grid gap-1">
      <h1 className="text-title font-semibold tracking-tight">{heading}</h1>
      {description !== undefined && <p className="text-sm text-fg-muted">{description}</p>}
    </header>
  )
}

export { PageHeader }
