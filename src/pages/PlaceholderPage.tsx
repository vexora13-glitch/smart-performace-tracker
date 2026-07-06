import type { ReactNode } from 'react'

type PlaceholderPageProps = {
  eyebrow: string
  title: string
  description: string
  icon: ReactNode
  children?: ReactNode
}

export function PlaceholderPage({ eyebrow, title, description, icon, children }: PlaceholderPageProps) {
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>
      <section className="placeholder-panel">
        <span className="placeholder-panel__icon" aria-hidden="true">
          {icon}
        </span>
        <div>{children}</div>
      </section>
    </div>
  )
}
