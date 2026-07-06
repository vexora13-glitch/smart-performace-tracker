import type { ReactNode } from 'react'

type KpiCardProps = {
  title: string
  value: string
  detail: string
  icon: ReactNode
  tone: 'blue' | 'green' | 'amber' | 'teal' | 'indigo' | 'gray' | 'red'
}

export function KpiCard({ title, value, detail, icon, tone }: KpiCardProps) {
  return (
    <article className={`kpi-card kpi-card--${tone}`}>
      <div className="kpi-card__header">
        <span className="kpi-card__icon" aria-hidden="true">
          {icon}
        </span>
        <span className="kpi-card__title">{title}</span>
      </div>
      <strong>{value}</strong>
      <span className="kpi-card__detail">{detail}</span>
    </article>
  )
}
