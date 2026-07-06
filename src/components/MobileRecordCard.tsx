import type { KeyboardEvent, ReactNode } from 'react'
import { StatusPill } from './StatusPill'

export type MobileRecordField = {
  label: string
  value: ReactNode
}

type MobileRecordCardProps = {
  title: string
  subtitle: string
  status?: string
  fields: MobileRecordField[]
  onClick?: () => void
}

export function MobileRecordCard({ title, subtitle, status, fields, onClick }: MobileRecordCardProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!onClick) {
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onClick()
    }
  }

  return (
    <article
      className={onClick ? 'mobile-record mobile-record--clickable' : 'mobile-record'}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      <div className="mobile-record__topline">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        {status ? <StatusPill status={status} /> : null}
      </div>
      <dl className="mobile-record__fields">
        {fields.map((field) => (
          <div key={field.label}>
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
    </article>
  )
}
