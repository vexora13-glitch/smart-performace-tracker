import { CalendarPlus, ClipboardList, ListPlus, Phone, SearchX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { EmptyState } from '../components/EmptyState'
import { KpiSummaryGrid } from '../components/KpiSummaryGrid'
import { ManualBookingForm } from '../components/ManualBookingForm'
import { MobileRecordCard } from '../components/MobileRecordCard'
import { QuickActionButton } from '../components/QuickActionButton'
import { SearchInput } from '../components/SearchInput'
import { SiteVisitDetailPanel } from '../components/SiteVisitDetailPanel'
import { SiteVisitForm } from '../components/SiteVisitForm'
import { StatusPill } from '../components/StatusPill'
import { TaskForm } from '../components/TaskForm'
import type {
  MonthlyKpis,
  NewBookingInput,
  NewQuoteInput,
  NewSiteVisitInput,
  NewTaskInput,
  PerformanceData,
  Quote,
  QuoteBookingInput,
  QuoteStatus,
  SiteVisit,
  SiteVisitStatus,
  Task,
  TaskStatus,
} from '../types/performance'
import { formatDateTime, sortSiteVisitsBySchedule } from '../utils/kpi'
import { searchPerformanceData, type SearchResult } from '../utils/search'

type DashboardPageProps = {
  data: PerformanceData
  kpis: MonthlyKpis
  monthLabel: string
  searchQuery: string
  selectedSiteVisit: SiteVisit | null
  onSearchChange: (value: string) => void
  onAddSiteVisit: (input: NewSiteVisitInput) => void
  onAddTask: (input: NewTaskInput) => void
  onCreateManualBooking: (input: NewBookingInput) => void
  onSelectSearchResult: (result: SearchResult) => void
  onSelectSiteVisit: (siteVisit: SiteVisit) => void
  onUpdateSiteVisitStatus: (siteVisit: SiteVisit, status: SiteVisitStatus) => void
  onUpdateTaskStatus: (task: Task, status: TaskStatus) => void
  onCreateQuote: (input: NewQuoteInput, bookingInput: QuoteBookingInput | null) => void
  onUpdateQuoteStatus: (quote: Quote, status: QuoteStatus) => void
  onBookQuote: (quote: Quote, bookingInput: QuoteBookingInput) => void
}

export function DashboardPage({
  data,
  kpis,
  monthLabel,
  searchQuery,
  selectedSiteVisit,
  onSearchChange,
  onAddSiteVisit,
  onAddTask,
  onCreateManualBooking,
  onSelectSearchResult,
  onSelectSiteVisit,
  onUpdateSiteVisitStatus,
  onUpdateTaskStatus,
  onCreateQuote,
  onUpdateQuoteStatus,
  onBookQuote,
}: DashboardPageProps) {
  const [showManualBookingForm, setShowManualBookingForm] = useState(false)
  const bookedSiteVisits = useMemo(
    () => sortSiteVisitsBySchedule(data.siteVisits.filter((siteVisit) => siteVisit.status === 'Booked')),
    [data.siteVisits],
  )
  const searchResults = useMemo(() => searchPerformanceData(data, searchQuery), [data, searchQuery])
  const selectedLinkedTasks = useMemo(
    () => (selectedSiteVisit ? data.tasks.filter((task) => task.site_visit_id === selectedSiteVisit.id) : []),
    [data.tasks, selectedSiteVisit],
  )
  const selectedLinkedQuotes = useMemo(
    () => (selectedSiteVisit ? data.quotes.filter((quote) => quote.site_visit_id === selectedSiteVisit.id) : []),
    [data.quotes, selectedSiteVisit],
  )
  const selectedLinkedBookings = useMemo(() => {
    if (!selectedSiteVisit) {
      return []
    }

    const linkedQuoteIds = new Set(selectedLinkedQuotes.map((quote) => quote.id))
    return data.bookings.filter(
      (booking) => booking.site_visit_id === selectedSiteVisit.id || (booking.quote_id ? linkedQuoteIds.has(booking.quote_id) : false),
    )
  }, [data.bookings, selectedLinkedQuotes, selectedSiteVisit])

  const columns: DataTableColumn<SiteVisit>[] = [
    { key: 'reference', header: 'Site Visit Reference', render: (siteVisit) => siteVisit.reference_number },
    { key: 'customer', header: 'Customer Name', render: (siteVisit) => siteVisit.customer_full_name },
    { key: 'suburb', header: 'Suburb', render: (siteVisit) => siteVisit.suburb },
    {
      key: 'phone',
      header: 'Contact Number',
      render: (siteVisit) => (
        <a className="inline-link" href={`tel:${siteVisit.contact_number}`} onClick={(event) => event.stopPropagation()}>
          <Phone size={15} aria-hidden="true" />
          {siteVisit.contact_number}
        </a>
      ),
    },
    { key: 'date', header: 'Date/Time', render: (siteVisit) => formatDateTime(siteVisit.booked_date, siteVisit.booked_time) },
    { key: 'status', header: 'Status', render: (siteVisit) => <StatusPill status={siteVisit.status} /> },
  ]

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">Prompt 1 foundation</span>
          <h1>Dashboard</h1>
          <p>Current month performance, booked site visits, tasks, and fast entry.</p>
        </div>
      </header>

      <SearchInput
        value={searchQuery}
        onChange={onSearchChange}
        placeholder="Search site visits, customers, suburbs, phone numbers, or tasks"
      />

      {searchQuery.trim() ? (
        <section className="surface">
          <div className="section-header">
            <div>
              <span className="eyebrow">Search</span>
              <h2>Results</h2>
            </div>
          </div>
          {searchResults.length ? (
            <div className="search-results">
              {searchResults.map((result) => (
                <button
                  className="search-result"
                  key={`${result.type}-${result.id}`}
                  type="button"
                  onClick={() => onSelectSearchResult(result)}
                >
                  <div>
                    <strong>{result.title}</strong>
                    <span>{result.type.replace('_', ' ')} - {result.subtitle}</span>
                  </div>
                  <StatusPill status={result.status} />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState icon={<SearchX size={24} />} title="No matches" message="Try another customer, suburb, phone, reference, or task title." />
          )}
        </section>
      ) : null}

      <KpiSummaryGrid kpis={kpis} monthLabel={monthLabel} />

      <section className="quick-actions-grid" aria-label="Quick actions">
        <QuickActionButton icon={<CalendarPlus size={20} />} label="Add Site Visit" hint="Fast booking entry" href="#quick-site-visit" />
        <QuickActionButton icon={<ListPlus size={20} />} label="Add Task" hint="Follow-up and KPI tasks" href="#quick-task" />
        <QuickActionButton
          icon={<ClipboardList size={20} />}
          label="Manual Booking"
          hint="Estimated sales entry"
          onClick={() => setShowManualBookingForm((current) => !current)}
        />
      </section>

      {showManualBookingForm ? (
        <section className="surface" id="manual-booking">
          <div className="section-header">
            <div>
              <span className="eyebrow">Manual Booking</span>
              <h2>Manual Booking Entry</h2>
            </div>
            <StatusPill status="Estimated" />
          </div>
          <ManualBookingForm
            siteVisits={data.siteVisits}
            quotes={data.quotes}
            nextBookingSequence={data.bookings.length + 1}
            onSubmit={onCreateManualBooking}
          />
        </section>
      ) : null}

      <section className="dashboard-entry-grid">
        <div className="surface" id="quick-site-visit">
          <div className="section-header">
            <div>
              <span className="eyebrow">Work</span>
              <h2>Quick Site Visit Booking</h2>
            </div>
          </div>
          <SiteVisitForm onSubmit={onAddSiteVisit} />
        </div>

        <div className="surface" id="quick-task">
          <div className="section-header">
            <div>
              <span className="eyebrow">Tasks</span>
              <h2>Add Task</h2>
            </div>
          </div>
          <TaskForm siteVisits={data.siteVisits} onSubmit={onAddTask} />
        </div>
      </section>

      <section className="content-split">
        <div className="surface">
          <div className="section-header">
            <div>
              <span className="eyebrow">Booked work</span>
              <h2>Booked Site Visits</h2>
            </div>
            <span className="record-count">{bookedSiteVisits.length}</span>
          </div>

          {bookedSiteVisits.length ? (
            <>
              <div className="desktop-table">
                <DataTable
                  columns={columns}
                  records={bookedSiteVisits}
                  onRowClick={onSelectSiteVisit}
                  getRowLabel={(siteVisit) => `Open ${siteVisit.reference_number}`}
                />
              </div>
              <div className="mobile-record-list">
                {bookedSiteVisits.map((siteVisit) => (
                  <MobileRecordCard
                    key={siteVisit.id}
                    title={siteVisit.reference_number}
                    subtitle={siteVisit.customer_full_name}
                    status={siteVisit.status}
                    onClick={() => onSelectSiteVisit(siteVisit)}
                    fields={[
                      { label: 'Suburb', value: siteVisit.suburb },
                      {
                        label: 'Phone',
                        value: (
                          <a className="inline-link" href={`tel:${siteVisit.contact_number}`} onClick={(event) => event.stopPropagation()}>
                            <Phone size={15} aria-hidden="true" />
                            {siteVisit.contact_number}
                          </a>
                        ),
                      },
                      { label: 'Date/time', value: formatDateTime(siteVisit.booked_date, siteVisit.booked_time) },
                    ]}
                  />
                ))}
              </div>
            </>
          ) : (
            <EmptyState icon={<CalendarPlus size={24} />} title="No booked site visits" message="Add a site visit to start the workflow." />
          )}
        </div>

        {selectedSiteVisit ? (
          <SiteVisitDetailPanel
            siteVisit={selectedSiteVisit}
            allSiteVisits={data.siteVisits}
            linkedTasks={selectedLinkedTasks}
            linkedQuotes={selectedLinkedQuotes}
            linkedBookings={selectedLinkedBookings}
            activityItems={data.activityTimeline}
            nextQuoteSequence={data.quotes.length + 1}
            nextBookingSequence={data.bookings.length + 1}
            onUpdateStatus={onUpdateSiteVisitStatus}
            onAddTask={onAddTask}
            onUpdateTaskStatus={onUpdateTaskStatus}
            onCreateQuote={onCreateQuote}
            onUpdateQuoteStatus={onUpdateQuoteStatus}
            onBookQuote={onBookQuote}
          />
        ) : (
          <div className="surface muted-surface">
            <EmptyState icon={<ClipboardList size={24} />} title="No record selected" message="Open a site visit row or card to preview details." />
          </div>
        )}
      </section>
    </div>
  )
}
