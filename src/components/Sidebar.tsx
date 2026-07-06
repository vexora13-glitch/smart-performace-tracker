import type { ReactNode } from 'react'
import type { PageKey } from '../types/performance'

export type SidebarNavItem = {
  key: PageKey
  label: string
  icon: ReactNode
}

type SidebarProps = {
  items: SidebarNavItem[]
  activePage: PageKey
  onNavigate: (page: PageKey) => void
}

export function Sidebar({ items, activePage, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="sidebar__brand">
        <span>SP</span>
        <div>
          <strong>Smart Performance</strong>
          <small>Personal tracker</small>
        </div>
      </div>
      <nav className="sidebar__nav">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            className={activePage === item.key ? 'sidebar__nav-item is-active' : 'sidebar__nav-item'}
            onClick={() => onNavigate(item.key)}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  )
}
