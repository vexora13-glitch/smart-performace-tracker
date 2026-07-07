import type { ReactNode } from 'react'
import { LogOut } from 'lucide-react'
import type { PageKey } from '../types/performance'

export type SidebarNavItem = {
  key: PageKey
  label: string
  icon: ReactNode
}

type SidebarProps = {
  items: SidebarNavItem[]
  activePage: PageKey
  userEmail?: string | null
  onNavigate: (page: PageKey) => void
  onLogout?: () => void
}

export function Sidebar({ items, activePage, userEmail = null, onNavigate, onLogout }: SidebarProps) {
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

      {onLogout ? (
        <div className="sidebar__footer">
          {userEmail ? (
            <div className="sidebar__session">
              <span>Signed in</span>
              <strong>{userEmail}</strong>
            </div>
          ) : null}
          <button className="sidebar__logout" type="button" onClick={onLogout}>
            <LogOut size={18} aria-hidden="true" />
            Log out
          </button>
        </div>
      ) : null}
    </aside>
  )
}
