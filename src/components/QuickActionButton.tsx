import type { ReactNode } from 'react'

type QuickActionButtonProps = {
  icon: ReactNode
  label: string
  hint: string
  href?: string
  disabled?: boolean
  onClick?: () => void
}

export function QuickActionButton({ icon, label, hint, href, disabled, onClick }: QuickActionButtonProps) {
  const content = (
    <>
      <span className="quick-action__icon" aria-hidden="true">
        {icon}
      </span>
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
    </>
  )

  if (href && !disabled) {
    return (
      <a className="quick-action" href={href}>
        {content}
      </a>
    )
  }

  return (
    <button className="quick-action" type="button" disabled={disabled} onClick={onClick}>
      {content}
    </button>
  )
}
