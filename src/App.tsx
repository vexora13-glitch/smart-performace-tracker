import { FileText, Settings } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { AppShell } from './components/AppShell'
import { createLocalSiteVisit, createLocalTask, loadPerformanceData, saveSiteVisit, saveTask } from './services/performanceService'
import type { NewSiteVisitInput, NewTaskInput, PageKey, PerformanceData, SiteVisit, Task } from './types/performance'
import { calculateMonthlyKpis, getCurrentMonthRange } from './utils/kpi'
import { DashboardPage } from './pages/DashboardPage'
import { KpiPage } from './pages/KpiPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { TasksPage } from './pages/TasksPage'
import { WorkPage } from './pages/WorkPage'

const initialData: PerformanceData = {
  siteVisits: [],
  quotes: [],
  bookings: [],
  tasks: [],
}

function App() {
  const [activePage, setActivePage] = useState<PageKey>('dashboard')
  const [data, setData] = useState<PerformanceData>(initialData)
  const [notice, setNotice] = useState('Loading performance data...')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSiteVisit, setSelectedSiteVisit] = useState<SiteVisit | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadData() {
      const result = await loadPerformanceData()

      if (!isMounted) {
        return
      }

      setData(result.data)
      setNotice(result.notice)
      setSelectedSiteVisit(result.data.siteVisits[0] ?? null)
    }

    void loadData()

    return () => {
      isMounted = false
    }
  }, [])

  const monthRange = useMemo(() => getCurrentMonthRange(), [])
  const kpis = useMemo(() => calculateMonthlyKpis(data), [data])

  const replaceSiteVisit = (draft: SiteVisit, saved: SiteVisit) => {
    setData((current) => ({
      ...current,
      siteVisits: current.siteVisits.map((siteVisit) => (siteVisit.id === draft.id ? saved : siteVisit)),
    }))
    setSelectedSiteVisit(saved)
  }

  const replaceTask = (draft: Task, saved: Task) => {
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((task) => (task.id === draft.id ? saved : task)),
    }))
  }

  const handleAddSiteVisit = (input: NewSiteVisitInput) => {
    const draft = createLocalSiteVisit(input, data.siteVisits.length + 1)
    setData((current) => ({ ...current, siteVisits: [draft, ...current.siteVisits] }))
    setSelectedSiteVisit(draft)

    void saveSiteVisit(draft)
      .then((saved) => {
        replaceSiteVisit(draft, saved)
        setNotice('Site visit saved.')
      })
      .catch((error: Error) => {
        setNotice(`Site visit is kept locally for this session. Supabase save failed: ${error.message}`)
      })
  }

  const handleAddTask = (input: NewTaskInput) => {
    const draft = createLocalTask(input)
    setData((current) => ({ ...current, tasks: [draft, ...current.tasks] }))

    void saveTask(draft)
      .then((saved) => {
        replaceTask(draft, saved)
        setNotice('Task saved.')
      })
      .catch((error: Error) => {
        setNotice(`Task is kept locally for this session. Supabase save failed: ${error.message}`)
      })
  }

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':
        return (
          <DashboardPage
            data={data}
            kpis={kpis}
            monthLabel={monthRange.label}
            searchQuery={searchQuery}
            selectedSiteVisit={selectedSiteVisit}
            onSearchChange={setSearchQuery}
            onAddSiteVisit={handleAddSiteVisit}
            onAddTask={handleAddTask}
            onSelectSiteVisit={setSelectedSiteVisit}
          />
        )
      case 'work':
        return (
          <WorkPage
            data={data}
            selectedSiteVisit={selectedSiteVisit}
            onAddSiteVisit={handleAddSiteVisit}
            onSelectSiteVisit={setSelectedSiteVisit}
          />
        )
      case 'tasks':
        return <TasksPage data={data} onAddTask={handleAddTask} />
      case 'kpi':
        return <KpiPage data={data} kpis={kpis} monthLabel={monthRange.label} />
      case 'reports':
        return (
          <PlaceholderPage
            eyebrow="Reports"
            title="Reports"
            description="Placeholder page for future report workflow work."
            icon={<FileText size={32} />}
          >
            <h2>Report Foundation</h2>
            <p>Site visit report records can be added in Prompt 2 without changing the navigation structure.</p>
          </PlaceholderPage>
        )
      case 'settings':
        return (
          <PlaceholderPage
            eyebrow="Settings"
            title="Settings"
            description="Placeholder page for app configuration."
            icon={<Settings size={32} />}
          >
            <h2>Environment</h2>
            <p>Use VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY when connecting this app to Supabase.</p>
          </PlaceholderPage>
        )
      default:
        return null
    }
  }

  return (
    <AppShell activePage={activePage} notice={notice} onNavigate={setActivePage}>
      {renderPage()}
    </AppShell>
  )
}

export default App
