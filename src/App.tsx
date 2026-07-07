import { FileText, Settings } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { AppShell } from './components/AppShell'
import { hasSupabaseConfig, supabase } from './lib/supabase'
import {
  createLocalActivityTimelineItem,
  createLocalBooking,
  createLocalQuote,
  createLocalSiteVisit,
  createLocalTask,
  loadKpiTargets,
  loadPerformanceData,
  saveBooking,
  saveKpiTargets,
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
  BookingVerificationUpdate,
  KpiTarget,
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
import { calculateMonthlyKpis, formatCurrency, getMonthRange } from './utils/kpi'
import { createDefaultKpiTargets } from './utils/kpiTargets'
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
  const [selectedMonth, setSelectedMonth] = useState(() => new Date())
  const [kpiTargets, setKpiTargets] = useState<KpiTarget[]>(() => createDefaultKpiTargets())
  const isMountedRef = useRef(true)

  const clearLoadedSessionData = useCallback(() => {
    setData(initialData)
    setKpiTargets(createDefaultKpiTargets())
    setSelectedSiteVisit(null)
    setSelectedTaskId(null)
    setSelectedBookingId(null)
    setSelectedQuoteId(null)
  }, [])

  const loadAppData = useCallback(async (noticeOverride?: string) => {
    try {
      const [performanceResult, targetsResult] = await Promise.all([loadPerformanceData(), loadKpiTargets()])

      if (!isMountedRef.current) {
        return
      }

      setData(performanceResult.data)
      setKpiTargets(targetsResult.targets)
      setNotice(noticeOverride ?? [performanceResult.notice, targetsResult.notice].filter(Boolean).join(' '))
      setSelectedSiteVisit(performanceResult.data.siteVisits[0] ?? null)
      setSelectedTaskId(null)
      setSelectedBookingId(null)
      setSelectedQuoteId(null)
    } catch (error) {
      if (!isMountedRef.current) {
        return
      }

      if (hasSupabaseConfig) {
        clearLoadedSessionData()
      }

      setNotice(error instanceof Error ? `Saved data could not be loaded: ${error.message}` : 'Saved data could not be loaded.')
    }
  }, [clearLoadedSessionData])

  const handlePersistenceFailure = useCallback(
    (label: string, error: Error) => {
      const storageName = hasSupabaseConfig ? 'Supabase' : 'local browser storage'
      const message = `${label} was not saved to ${storageName}: ${error.message}`

      if (hasSupabaseConfig) {
        void loadAppData(message)
        return
      }

      setNotice(message)
    },
    [loadAppData],
  )

  useEffect(() => {
    isMountedRef.current = true
    void loadAppData()

    return () => {
      isMountedRef.current = false
    }
  }, [loadAppData])

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) {
      return undefined
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        clearLoadedSessionData()
        setNotice('Signed out. Supabase records remain saved and will reload after sign in.')
        return
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        void loadAppData()
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [clearLoadedSessionData, loadAppData])

  const monthRange = useMemo(() => getMonthRange(selectedMonth), [selectedMonth])
  const kpis = useMemo(() => calculateMonthlyKpis(data, selectedMonth), [data, selectedMonth])

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

  const handlePreviousMonth = () => {
    setSelectedMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))
  }

  const handleCurrentMonth = () => {
    setSelectedMonth(new Date())
  }

  const handleNextMonth = () => {
    setSelectedMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))
  }

  const handleSaveKpiTargets = (targets: KpiTarget[]) => {
    setKpiTargets(targets)

    void saveKpiTargets(targets)
      .then((savedTargets) => {
        setKpiTargets(savedTargets)
        setNotice('KPI targets saved.')
      })
      .catch((error: Error) => {
        handlePersistenceFailure('KPI targets', error)
      })
  }

  const handleApplyBookingVerifications = (updates: BookingVerificationUpdate[]) => {
    if (!updates.length) {
      return
    }

    const updatesByBookingId = new Map(updates.map((update) => [update.bookingId, update]))
    const now = new Date().toISOString()
    const updatedBookings = data.bookings
      .map((booking) => {
        const update = updatesByBookingId.get(booking.id)

        if (!update) {
          return null
        }

        return {
          ...booking,
          actual_value: update.actualValue,
          verification_status: update.verificationStatus,
          updated_at: now,
        }
      })
      .filter((booking): booking is Booking => Boolean(booking))
    const updatedBookingById = new Map(updatedBookings.map((booking) => [booking.id, booking]))
    const activities = updatedBookings.flatMap((booking) => {
      const update = updatesByBookingId.get(booking.id)
      const verifiedActivity = createWorkflowActivity(
        'bookings',
        booking.id,
        'booking_verified',
        'Booking verified',
        `${booking.booking_number} verified at ${booking.actual_value === null ? 'no actual value' : formatCurrency(booking.actual_value)}.`,
      )

      if (!update?.varianceDetected || update.varianceAmount === undefined) {
        return [verifiedActivity]
      }

      return [
        verifiedActivity,
        createWorkflowActivity(
          'bookings',
          booking.id,
          'booking_variance_detected',
          'Booking variance detected',
          `${booking.booking_number}: estimated ${formatCurrency(booking.estimated_value)}, actual ${formatCurrency(
            booking.actual_value ?? booking.estimated_value,
          )}, variance ${formatCurrency(update.varianceAmount)}.`,
        ),
      ]
    })

    setData((current) => ({
      ...current,
      bookings: current.bookings.map((booking) => updatedBookingById.get(booking.id) ?? booking),
      activityTimeline: [...activities, ...current.activityTimeline],
    }))

    void Promise.all(updatedBookings.map((booking) => updateBooking(booking)))
      .then((savedBookings) => {
        const savedBookingById = new Map(savedBookings.map((booking) => [booking.id, booking]))
        setData((current) => ({
          ...current,
          bookings: current.bookings.map((booking) => savedBookingById.get(booking.id) ?? booking),
        }))
        setNotice(`${savedBookings.length} booking verification update${savedBookings.length === 1 ? '' : 's'} applied.`)
      })
      .catch((error: Error) => {
        handlePersistenceFailure('Booking verification', error)
      })
  }

  const handleMarkBookingsNotFound = (bookingIds: string[]) => {
    if (!bookingIds.length) {
      return
    }

    const bookingIdSet = new Set(bookingIds)
    const now = new Date().toISOString()
    const updatedBookings = data.bookings
      .filter((booking) => bookingIdSet.has(booking.id))
      .map((booking) => ({
        ...booking,
        verification_status: 'Not Found' as const,
        updated_at: now,
      }))
    const updatedBookingById = new Map(updatedBookings.map((booking) => [booking.id, booking]))
    const activities = updatedBookings.map((booking) =>
      createWorkflowActivity(
        'bookings',
        booking.id,
        'booking_not_found',
        'Booking not found',
        `${booking.booking_number} was not found in the monthly import.`,
      ),
    )

    setData((current) => ({
      ...current,
      bookings: current.bookings.map((booking) => updatedBookingById.get(booking.id) ?? booking),
      activityTimeline: [...activities, ...current.activityTimeline],
    }))

    void Promise.all(updatedBookings.map((booking) => updateBooking(booking)))
      .then((savedBookings) => {
        const savedBookingById = new Map(savedBookings.map((booking) => [booking.id, booking]))
        setData((current) => ({
          ...current,
          bookings: current.bookings.map((booking) => savedBookingById.get(booking.id) ?? booking),
        }))
        setNotice(`${savedBookings.length} booking${savedBookings.length === 1 ? '' : 's'} marked Not Found.`)
      })
      .catch((error: Error) => {
        handlePersistenceFailure('Not Found booking status', error)
      })
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
        handlePersistenceFailure('Site visit', error)
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
        handlePersistenceFailure('Site visit status', error)
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
        handlePersistenceFailure('Task', error)
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
        handlePersistenceFailure('Task status', error)
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
        handlePersistenceFailure('Quote workflow', error)
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
        handlePersistenceFailure('Quote status', error)
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
        handlePersistenceFailure('Booked quote', error)
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
        handlePersistenceFailure('Manual booking', error)
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
            targets={kpiTargets}
            monthLabel={monthRange.label}
            searchQuery={searchQuery}
            selectedSiteVisit={selectedSiteVisit}
            onPreviousMonth={handlePreviousMonth}
            onCurrentMonth={handleCurrentMonth}
            onNextMonth={handleNextMonth}
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
            targets={kpiTargets}
            monthRange={monthRange}
            monthLabel={monthRange.label}
            selectedBookingId={selectedBookingId}
            selectedQuoteId={selectedQuoteId}
            onPreviousMonth={handlePreviousMonth}
            onCurrentMonth={handleCurrentMonth}
            onNextMonth={handleNextMonth}
            onSaveTargets={handleSaveKpiTargets}
            onApplyBookingVerifications={handleApplyBookingVerifications}
            onMarkBookingsNotFound={handleMarkBookingsNotFound}
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
