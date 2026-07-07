import { BarChart3, CheckSquare, ClipboardList, FileText, LayoutDashboard, Menu, Settings, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { PageKey } from '../types/performance'
import { Sidebar, type SidebarNavItem } from './Sidebar'

type AppShellProps = {
  activePage: PageKey
  children: ReactNode
  notice: string
  userEmail?: string | null
  onNavigate: (page: PageKey) => void
  onLogout?: () => void
}

export function AppShell({ activePage, children, notice, userEmail = null, onNavigate, onLogout }: AppShellProps) {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const navItems = useMemo<SidebarNavItem[]>(
    () => [
      { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
      { key: 'work', label: 'Work', icon: <ClipboardList size={18} /> },
      { key: 'tasks', label: 'Tasks', icon: <CheckSquare size={18} /> },
      { key: 'kpi', label: 'KPI', icon: <BarChart3 size={18} /> },
      { key: 'reports', label: 'Reports', icon: <FileText size={18} /> },
      { key: 'settings', label: 'Settings', icon: <Settings size={18} /> },
    ],
    [],
  )
  const activeLabel = navItems.find((item) => item.key === activePage)?.label ?? 'Dashboard'

  const handleNavigate = (page: PageKey) => {
    onNavigate(page)
    setIsMobileNavOpen(false)
  }

  return (
    <div className="app-shell">
      <div className="desktop-sidebar">
        <Sidebar
          items={navItems}
          activePage={activePage}
          userEmail={userEmail}
          onNavigate={handleNavigate}
          onLogout={onLogout}
        />
      </div>

      <div className="app-main">
        <header className="mobile-header">
          <button
            type="button"
            className="icon-button"
            aria-label="Open navigation"
            onClick={() => setIsMobileNavOpen(true)}
          >
            <Menu size={22} />
          </button>
          <strong>{activeLabel}</strong>
        </header>

        {notice ? <div className="app-notice">{notice}</div> : null}
        <main>{children}</main>
      </div>

      {isMobileNavOpen ? (
        <div className="mobile-nav-layer">
          <button
            type="button"
            className="mobile-nav-layer__backdrop"
            aria-label="Close navigation"
            onClick={() => setIsMobileNavOpen(false)}
          />
          <div className="mobile-nav-layer__panel">
            <button
              type="button"
              className="icon-button mobile-nav-layer__close"
              aria-label="Close navigation"
              onClick={() => setIsMobileNavOpen(false)}
            >
              <X size={22} />
            </button>
            <Sidebar
              items={navItems}
              activePage={activePage}
              userEmail={userEmail}
              onNavigate={handleNavigate}
              onLogout={onLogout}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
