import { CalendarPlus, Phone } from 'lucide-react'
import { useMemo } from 'react'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { EmptyState } from '../components/EmptyState'
import { MobileRecordCard } from '../components/MobileRecordCard'
import { SiteVisitDetailPanel } from '../components/SiteVisitDetailPanel'
import { SiteVisitForm } from '../components/SiteVisitForm'
import { StatusPill } from '../components/StatusPill'
import type {
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
import { formatCurrency, formatDateTime, sortSiteVisitsBySchedule } from '../utils/kpi'

type WorkPageProps = {
  data: PerformanceData
  selectedSiteVisit: SiteVisit | null
  onAddSiteVisit: (input: NewSiteVisitInput) => void
  onAddTask: (input: NewTaskInput) => void
  onSelectSiteVisit: (siteVisit: SiteVisit) => void
  onUpdateSiteVisitStatus: (siteVisit: SiteVisit, status: SiteVisitStatus) => void
  onUpdateTaskStatus: (task: Task, status: TaskStatus) => void
  onCreateQuote: (input: NewQuoteInput, bookingInput: QuoteBookingInput | null) => void
  onUpdateQuoteStatus: (quote: Quote, status: QuoteStatus) => void
  onBookQuote: (quote: Quote, bookingInput: QuoteBookingInput) => void
}

export function WorkPage({
  data,
  selectedSiteVisit,
  onAddSiteVisit,
  onAddTask,
  onSelectSiteVisit,
  onUpdateSiteVisitStatus,
  onUpdateTaskStatus,
  onCreateQuote,
  onUpdateQuoteStatus,
  onBookQuote,
}: WorkPageProps) {
  const siteVisits = useMemo(() => sortSiteVisitsBySchedule(data.siteVisits), [data.siteVisits])
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
    { key: 'reference', header: 'Reference', render: (siteVisit) => siteVisit.reference_number },
    { key: 'customer', header: 'Customer', render: (siteVisit) => siteVisit.customer_full_name },
    { key: 'suburb', header: 'Suburb', render: (siteVisit) => siteVisit.suburb },
    {
      key: 'phone',
      header: 'Phone',
      render: (siteVisit) => (
        <a className="inline-link" href={`tel:${siteVisit.contact_number}`} onClick={(event) => event.stopPropagation()}>
          <Phone size={15} aria-hidden="true" />
          {siteVisit.contact_number}
        </a>
      ),
    },
    { key: 'date', header: 'Date/Time', render: (siteVisit) => formatDateTime(siteVisit.booked_date, siteVisit.booked_time) },
    {
      key: 'value',
      header: 'Est. Value',
      align: 'right',
      render: (siteVisit) => (siteVisit.estimated_quote_value ? formatCurrency(siteVisit.estimated_quote_value) : '-'),
    },
    { key: 'status', header: 'Status', render: (siteVisit) => <StatusPill status={siteVisit.status} /> },
  ]

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">Work</span>
          <h1>Site Visits</h1>
          <p>Foundation for the Site Visit to Report to Quote workflow.</p>
        </div>
      </header>

      <section className="surface">
        <div className="section-header">
          <div>
            <span className="eyebrow">New work</span>
            <h2>Add Site Visit</h2>
          </div>
        </div>
        <SiteVisitForm onSubmit={onAddSiteVisit} />
      </section>

      <section className="content-split">
        <div className="surface">
          <div className="section-header">
            <div>
              <span className="eyebrow">Records</span>
              <h2>All Site Visits</h2>
            </div>
            <span className="record-count">{siteVisits.length}</span>
          </div>

          {siteVisits.length ? (
            <>
              <div className="desktop-table">
                <DataTable
                  columns={columns}
                  records={siteVisits}
                  onRowClick={onSelectSiteVisit}
                  getRowLabel={(siteVisit) => `Open ${siteVisit.reference_number}`}
                />
              </div>
              <div className="mobile-record-list">
                {siteVisits.map((siteVisit) => (
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
            <EmptyState icon={<CalendarPlus size={24} />} title="No site visits yet" message="Add the first site visit record." />
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
            <EmptyState icon={<CalendarPlus size={24} />} title="Select a site visit" message="Details will appear here." />
          </div>
        )}
      </section>
    </div>
  )
}
