import { FileText, Settings } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { AppShell } from './components/AppShell'
import {
  createLocalActivityTimelineItem,
  createLocalBooking,
  createLocalQuote,
  createLocalSiteVisit,
  createLocalTask,
  loadPerformanceData,
  saveBooking,
  saveQuote,
  saveSiteVisit,
  saveTask,
  updateBooking,
  updateQuote,
  updateSiteVisit,
  updateTask,
} from './services/performanceService'
import type {
  Booking,
  NewBookingInput,
  NewQuoteInput,
  NewSiteVisitInput,
  NewTaskInput,
  PageKey,
  PerformanceData,
  Quote,
  QuoteBookingInput,
  QuoteStatus,
  SiteVisit,
  SiteVisitStatus,
  Task,
  TaskStatus,
} from './types/performance'
import { calculateMonthlyKpis, getCurrentMonthRange } from './utils/kpi'
import type { SearchResult } from './utils/search'
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
  activityTimeline: [],
}

const quoteSentStatuses = new Set<QuoteStatus>(['Sent', 'Follow Up', 'Booked', 'Lost'])

const formatToday = () => {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const createWorkflowActivity = (
  entityType: string,
  entityId: string,
  eventType: string,
  eventLabel: string,
  eventDescription: string | null,
) => createLocalActivityTimelineItem(entityType, entityId, eventType, eventLabel, eventDescription)

const shouldMoveSiteVisitToQuoteSent = (siteVisit: SiteVisit) =>
  !['Quote Sent', 'Won', 'Lost / Closed'].includes(siteVisit.status)

const createUpdatedQuote = (quote: Quote, status: QuoteStatus): Quote => ({
  ...quote,
  status,
  quote_sent_date: quoteSentStatuses.has(status) ? quote.quote_sent_date ?? formatToday() : quote.quote_sent_date,
  updated_at: new Date().toISOString(),
})

function App() {
  const [activePage, setActivePage] = useState<PageKey>('dashboard')
  const [data, setData] = useState<PerformanceData>(initialData)
  const [notice, setNotice] = useState('Loading performance data...')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSiteVisit, setSelectedSiteVisit] = useState<SiteVisit | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null)
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null)

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
      quotes: current.quotes.map((quote) =>
        quote.site_visit_id === draft.id ? { ...quote, site_visit_id: saved.id } : quote,
      ),
      bookings: current.bookings.map((booking) =>
        booking.site_visit_id === draft.id ? { ...booking, site_visit_id: saved.id } : booking,
      ),
      tasks: current.tasks.map((task) => (task.site_visit_id === draft.id ? { ...task, site_visit_id: saved.id } : task)),
      activityTimeline: current.activityTimeline.map((item) =>
        item.entity_type === 'site_visits' && item.entity_id === draft.id ? { ...item, entity_id: saved.id } : item,
      ),
    }))
    setSelectedSiteVisit((current) => (current?.id === draft.id ? saved : current))
  }

  const replaceQuote = (draft: Quote, saved: Quote) => {
    setData((current) => ({
      ...current,
      quotes: current.quotes.map((quote) => (quote.id === draft.id ? saved : quote)),
      bookings: current.bookings.map((booking) =>
        booking.quote_id === draft.id ? { ...booking, quote_id: saved.id } : booking,
      ),
      activityTimeline: current.activityTimeline.map((item) =>
        item.entity_type === 'quotes' && item.entity_id === draft.id ? { ...item, entity_id: saved.id } : item,
      ),
    }))
  }

  const replaceBooking = (draft: Booking, saved: Booking) => {
    setData((current) => ({
      ...current,
      bookings: current.bookings.map((booking) => (booking.id === draft.id ? saved : booking)),
      activityTimeline: current.activityTimeline.map((item) =>
        item.entity_type === 'bookings' && item.entity_id === draft.id ? { ...item, entity_id: saved.id } : item,
      ),
    }))
  }

  const replaceTask = (draft: Task, saved: Task) => {
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((task) => (task.id === draft.id ? saved : task)),
      activityTimeline: current.activityTimeline.map((item) =>
        item.entity_type === 'tasks' && item.entity_id === draft.id ? { ...item, entity_id: saved.id } : item,
      ),
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

  const handleUpdateSiteVisitStatus = (siteVisit: SiteVisit, status: SiteVisitStatus) => {
    const updatedSiteVisit = { ...siteVisit, status, updated_at: new Date().toISOString() }
    const activity = createWorkflowActivity(
      'site_visits',
      siteVisit.id,
      'status_changed',
      'Site visit status changed',
      `${siteVisit.reference_number}: ${siteVisit.status} to ${status}`,
    )

    setData((current) => ({
      ...current,
      siteVisits: current.siteVisits.map((record) => (record.id === siteVisit.id ? updatedSiteVisit : record)),
      activityTimeline: [activity, ...current.activityTimeline],
    }))
    setSelectedSiteVisit(updatedSiteVisit)

    void updateSiteVisit(updatedSiteVisit)
      .then((saved) => {
        replaceSiteVisit(updatedSiteVisit, saved)
        setNotice('Site visit status updated.')
      })
      .catch((error: Error) => {
        setNotice(`Site visit status is kept locally for this session. Supabase update failed: ${error.message}`)
      })
  }

  const handleAddTask = (input: NewTaskInput) => {
    const draft = createLocalTask(input)
    const taskCreatedActivity = createWorkflowActivity('tasks', draft.id, 'created', 'Task created', draft.title)
    const taskCompletedActivity =
      draft.status === 'Completed'
        ? createWorkflowActivity('tasks', draft.id, 'completed', 'Task completed', draft.title)
        : null

    setData((current) => ({
      ...current,
      tasks: [draft, ...current.tasks],
      activityTimeline: [taskCreatedActivity, ...(taskCompletedActivity ? [taskCompletedActivity] : []), ...current.activityTimeline],
    }))

    void saveTask(draft)
      .then((saved) => {
        replaceTask(draft, saved)
        setNotice('Task saved.')
      })
      .catch((error: Error) => {
        setNotice(`Task is kept locally for this session. Supabase save failed: ${error.message}`)
      })
  }

  const handleUpdateTaskStatus = (task: Task, status: TaskStatus) => {
    const updatedTask = { ...task, status, updated_at: new Date().toISOString() }
    const completionActivity =
      status === 'Completed' && task.status !== 'Completed'
        ? createWorkflowActivity('tasks', task.id, 'completed', 'Task completed', task.title)
        : null

    setData((current) => ({
      ...current,
      tasks: current.tasks.map((record) => (record.id === task.id ? updatedTask : record)),
      activityTimeline: completionActivity ? [completionActivity, ...current.activityTimeline] : current.activityTimeline,
    }))

    void updateTask(updatedTask)
      .then((saved) => {
        replaceTask(updatedTask, saved)
        setNotice('Task status updated.')
      })
      .catch((error: Error) => {
        setNotice(`Task status is kept locally for this session. Supabase update failed: ${error.message}`)
      })
  }

  const handleCreateQuote = (input: NewQuoteInput, bookingInput: QuoteBookingInput | null) => {
    if (input.status === 'Booked' && !bookingInput?.booking_number.trim()) {
      setNotice('A booking number is required before a quote can be marked Booked.')
      return
    }

    const draftQuote = createLocalQuote(input, data.quotes.length + 1)
    const linkedSiteVisit = data.siteVisits.find((siteVisit) => siteVisit.id === input.site_visit_id) ?? null
    const shouldCreateBooking = draftQuote.status === 'Booked' && bookingInput
    const draftBooking = shouldCreateBooking
      ? createLocalBooking({
          ...bookingInput,
          site_visit_id: draftQuote.site_visit_id,
          quote_id: draftQuote.id,
          booking_source: 'Quote',
        })
      : null
    const updatedSiteVisit =
      linkedSiteVisit && draftQuote.status === 'Booked'
        ? { ...linkedSiteVisit, status: 'Won' as SiteVisitStatus, updated_at: new Date().toISOString() }
        : linkedSiteVisit && draftQuote.status === 'Sent' && shouldMoveSiteVisitToQuoteSent(linkedSiteVisit)
          ? { ...linkedSiteVisit, status: 'Quote Sent' as SiteVisitStatus, updated_at: new Date().toISOString() }
          : null

    const activities = [
      createWorkflowActivity(
        'quotes',
        draftQuote.id,
        'created',
        'Quote created',
        `${draftQuote.quote_reference} - ${draftQuote.customer_full_name}`,
      ),
      ...(draftBooking
        ? [
            createWorkflowActivity(
              'bookings',
              draftBooking.id,
              'created',
              'Booking created',
              `${draftBooking.booking_number} - ${draftBooking.customer_full_name}`,
            ),
          ]
        : []),
      ...(updatedSiteVisit
        ? [
            createWorkflowActivity(
              'site_visits',
              updatedSiteVisit.id,
              'status_changed',
              'Site visit status changed',
              `${updatedSiteVisit.reference_number}: ${linkedSiteVisit?.status} to ${updatedSiteVisit.status}`,
            ),
          ]
        : []),
    ]

    setData((current) => ({
      ...current,
      siteVisits: updatedSiteVisit
        ? current.siteVisits.map((siteVisit) => (siteVisit.id === updatedSiteVisit.id ? updatedSiteVisit : siteVisit))
        : current.siteVisits,
      quotes: [draftQuote, ...current.quotes],
      bookings: draftBooking ? [draftBooking, ...current.bookings] : current.bookings,
      activityTimeline: [...activities, ...current.activityTimeline],
    }))

    if (updatedSiteVisit) {
      setSelectedSiteVisit(updatedSiteVisit)
    }

    void saveQuote(draftQuote)
      .then(async (savedQuote) => {
        replaceQuote(draftQuote, savedQuote)

        if (updatedSiteVisit) {
          const savedSiteVisit = await updateSiteVisit(updatedSiteVisit)
          replaceSiteVisit(updatedSiteVisit, savedSiteVisit)
        }

        if (draftBooking) {
          const savedBooking = await saveBooking({ ...draftBooking, quote_id: savedQuote.id })
          replaceBooking(draftBooking, savedBooking)
        }

        setNotice(draftBooking ? 'Quote booked and booking saved.' : 'Quote saved.')
      })
      .catch((error: Error) => {
        setNotice(`Quote workflow is kept locally for this session. Supabase save failed: ${error.message}`)
      })
  }

  const handleUpdateQuoteStatus = (quote: Quote, status: QuoteStatus) => {
    if (status === 'Booked') {
      setNotice('Enter a booking number before marking a quote Booked.')
      return
    }

    const updatedQuote = createUpdatedQuote(quote, status)
    const linkedSiteVisit = data.siteVisits.find((siteVisit) => siteVisit.id === quote.site_visit_id) ?? null
    const updatedSiteVisit =
      status === 'Sent' && linkedSiteVisit && shouldMoveSiteVisitToQuoteSent(linkedSiteVisit)
        ? { ...linkedSiteVisit, status: 'Quote Sent' as SiteVisitStatus, updated_at: new Date().toISOString() }
        : null
    const activities = [
      createWorkflowActivity(
        'quotes',
        quote.id,
        'status_changed',
        'Quote status changed',
        `${quote.quote_reference}: ${quote.status} to ${status}`,
      ),
      ...(updatedSiteVisit
        ? [
            createWorkflowActivity(
              'site_visits',
              updatedSiteVisit.id,
              'status_changed',
              'Site visit status changed',
              `${updatedSiteVisit.reference_number}: ${linkedSiteVisit?.status} to ${updatedSiteVisit.status}`,
            ),
          ]
        : []),
    ]

    setData((current) => ({
      ...current,
      siteVisits: updatedSiteVisit
        ? current.siteVisits.map((siteVisit) => (siteVisit.id === updatedSiteVisit.id ? updatedSiteVisit : siteVisit))
        : current.siteVisits,
      quotes: current.quotes.map((record) => (record.id === quote.id ? updatedQuote : record)),
      activityTimeline: [...activities, ...current.activityTimeline],
    }))

    if (updatedSiteVisit) {
      setSelectedSiteVisit(updatedSiteVisit)
    }

    void updateQuote(updatedQuote)
      .then(async (savedQuote) => {
        replaceQuote(updatedQuote, savedQuote)

        if (updatedSiteVisit) {
          const savedSiteVisit = await updateSiteVisit(updatedSiteVisit)
          replaceSiteVisit(updatedSiteVisit, savedSiteVisit)
        }

        setNotice('Quote status updated.')
      })
      .catch((error: Error) => {
        setNotice(`Quote status is kept locally for this session. Supabase update failed: ${error.message}`)
      })
  }

  const handleBookQuote = (quote: Quote, bookingInput: QuoteBookingInput) => {
    if (!bookingInput.booking_number.trim()) {
      setNotice('A booking number is required before a quote can be marked Booked.')
      return
    }

    const existingBooking = data.bookings.find((booking) => booking.quote_id === quote.id) ?? null
    const linkedSiteVisit = data.siteVisits.find((siteVisit) => siteVisit.id === quote.site_visit_id) ?? null
    const updatedQuote = createUpdatedQuote(quote, 'Booked')
    const draftBooking: Booking = existingBooking
      ? {
          ...existingBooking,
          booking_number: bookingInput.booking_number.trim(),
          customer_full_name: bookingInput.customer_full_name.trim(),
          booking_date: bookingInput.booking_date,
          estimated_value: bookingInput.estimated_value,
          actual_value: null,
          verification_status: 'Estimated',
          status: 'Won',
          booking_source: 'Quote',
          notes: bookingInput.notes.trim() ? bookingInput.notes.trim() : null,
          updated_at: new Date().toISOString(),
        }
      : createLocalBooking({
          ...bookingInput,
          site_visit_id: quote.site_visit_id,
          quote_id: quote.id,
          booking_source: 'Quote',
        })
    const updatedSiteVisit = linkedSiteVisit
      ? { ...linkedSiteVisit, status: 'Won' as SiteVisitStatus, updated_at: new Date().toISOString() }
      : null
    const activities = [
      createWorkflowActivity(
        'quotes',
        quote.id,
        'status_changed',
        'Quote status changed',
        `${quote.quote_reference}: ${quote.status} to Booked`,
      ),
      createWorkflowActivity(
        'bookings',
        draftBooking.id,
        existingBooking ? 'updated' : 'created',
        existingBooking ? 'Booking updated' : 'Booking created',
        `${draftBooking.booking_number} - ${draftBooking.customer_full_name}`,
      ),
      ...(linkedSiteVisit && updatedSiteVisit && linkedSiteVisit.status !== 'Won'
        ? [
            createWorkflowActivity(
              'site_visits',
              updatedSiteVisit.id,
              'status_changed',
              'Site visit status changed',
              `${updatedSiteVisit.reference_number}: ${linkedSiteVisit.status} to Won`,
            ),
          ]
        : []),
    ]

    setData((current) => ({
      ...current,
      siteVisits: updatedSiteVisit
        ? current.siteVisits.map((siteVisit) => (siteVisit.id === updatedSiteVisit.id ? updatedSiteVisit : siteVisit))
        : current.siteVisits,
      quotes: current.quotes.map((record) => (record.id === quote.id ? updatedQuote : record)),
      bookings: existingBooking
        ? current.bookings.map((booking) => (booking.id === existingBooking.id ? draftBooking : booking))
        : [draftBooking, ...current.bookings],
      activityTimeline: [...activities, ...current.activityTimeline],
    }))

    if (updatedSiteVisit) {
      setSelectedSiteVisit(updatedSiteVisit)
    }

    void updateQuote(updatedQuote)
      .then(async (savedQuote) => {
        replaceQuote(updatedQuote, savedQuote)
        const bookingToSave = { ...draftBooking, quote_id: savedQuote.id }
        const savedBooking = existingBooking ? await updateBooking(bookingToSave) : await saveBooking(bookingToSave)
        replaceBooking(draftBooking, savedBooking)

        if (updatedSiteVisit) {
          const savedSiteVisit = await updateSiteVisit(updatedSiteVisit)
          replaceSiteVisit(updatedSiteVisit, savedSiteVisit)
        }

        setNotice('Quote booked and booking saved.')
      })
      .catch((error: Error) => {
        setNotice(`Booked quote is kept locally for this session. Supabase save failed: ${error.message}`)
      })
  }

  const handleCreateManualBooking = (input: NewBookingInput) => {
    const draft = createLocalBooking(input)
    const activity = createWorkflowActivity(
      'bookings',
      draft.id,
      'created',
      'Manual booking created',
      `${draft.booking_number} - ${draft.customer_full_name}`,
    )

    setData((current) => ({
      ...current,
      bookings: [draft, ...current.bookings],
      activityTimeline: [activity, ...current.activityTimeline],
    }))
    setSelectedBookingId(draft.id)

    void saveBooking(draft)
      .then((saved) => {
        replaceBooking(draft, saved)
        setSelectedBookingId(saved.id)
        setNotice('Manual booking saved.')
      })
      .catch((error: Error) => {
        setNotice(`Manual booking is kept locally for this session. Supabase save failed: ${error.message}`)
      })
  }

  const handleSearchResultSelect = (result: SearchResult) => {
    if (result.type === 'site_visit') {
      const siteVisit = data.siteVisits.find((record) => record.id === result.id)

      if (siteVisit) {
        setSelectedSiteVisit(siteVisit)
        setActivePage('work')
      }
      return
    }

    if (result.type === 'task') {
      setSelectedTaskId(result.id)
      setActivePage('tasks')

      if (result.siteVisitId) {
        const siteVisit = data.siteVisits.find((record) => record.id === result.siteVisitId)
        setSelectedSiteVisit(siteVisit ?? selectedSiteVisit)
      }
      return
    }

    if (result.type === 'booking') {
      setSelectedBookingId(result.id)
      setActivePage('kpi')
      return
    }

    setSelectedQuoteId(result.id)

    if (result.siteVisitId) {
      const siteVisit = data.siteVisits.find((record) => record.id === result.siteVisitId)
      setSelectedSiteVisit(siteVisit ?? selectedSiteVisit)
      setActivePage('work')
      return
    }

    setActivePage('kpi')
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
            onCreateManualBooking={handleCreateManualBooking}
            onSelectSearchResult={handleSearchResultSelect}
            onSelectSiteVisit={setSelectedSiteVisit}
            onUpdateSiteVisitStatus={handleUpdateSiteVisitStatus}
            onUpdateTaskStatus={handleUpdateTaskStatus}
            onCreateQuote={handleCreateQuote}
            onUpdateQuoteStatus={handleUpdateQuoteStatus}
            onBookQuote={handleBookQuote}
          />
        )
      case 'work':
        return (
          <WorkPage
            data={data}
            selectedSiteVisit={selectedSiteVisit}
            onAddSiteVisit={handleAddSiteVisit}
            onAddTask={handleAddTask}
            onSelectSiteVisit={setSelectedSiteVisit}
            onUpdateSiteVisitStatus={handleUpdateSiteVisitStatus}
            onUpdateTaskStatus={handleUpdateTaskStatus}
            onCreateQuote={handleCreateQuote}
            onUpdateQuoteStatus={handleUpdateQuoteStatus}
            onBookQuote={handleBookQuote}
          />
        )
      case 'tasks':
        return (
          <TasksPage
            data={data}
            selectedTaskId={selectedTaskId}
            onAddTask={handleAddTask}
            onUpdateTaskStatus={handleUpdateTaskStatus}
          />
        )
      case 'kpi':
        return (
          <KpiPage
            data={data}
            kpis={kpis}
            monthLabel={monthRange.label}
            selectedBookingId={selectedBookingId}
            selectedQuoteId={selectedQuoteId}
          />
        )
      case 'reports':
        return (
          <PlaceholderPage
            eyebrow="Reports"
            title="Reports"
            description="Placeholder page for future report workflow work."
            icon={<FileText size={32} />}
          >
            <h2>Report Foundation</h2>
            <p>Report Sent status is available in the site visit workflow.</p>
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
