import { BarChart3, ClipboardList } from 'lucide-react'
import { useMemo } from 'react'
import { BookingVerificationImport } from '../components/BookingVerificationImport'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { EmptyState } from '../components/EmptyState'
import { KpiSummaryGrid } from '../components/KpiSummaryGrid'
import { KpiTargetsPanel } from '../components/KpiTargetsPanel'
import { MobileRecordCard } from '../components/MobileRecordCard'
import { MonthSelector } from '../components/MonthSelector'
import { StatusPill } from '../components/StatusPill'
import type { Booking, BookingVerificationUpdate, KpiTarget, MonthlyKpis, PerformanceData, Quote } from '../types/performance'
import type { MonthRange } from '../utils/kpi'
import { filterBookingsForMonth, filterQuotesForMonth, formatCurrency, formatDate, getBookingVariance } from '../utils/kpi'

type KpiPageProps = {
  data: PerformanceData
  kpis: MonthlyKpis
  targets: KpiTarget[]
  monthRange: MonthRange
  monthLabel: string
  selectedBookingId: string | null
  selectedQuoteId: string | null
  onPreviousMonth: () => void
  onCurrentMonth: () => void
  onNextMonth: () => void
  onSaveTargets: (targets: KpiTarget[]) => void
  onApplyBookingVerifications: (updates: BookingVerificationUpdate[]) => void
  onMarkBookingsNotFound: (bookingIds: string[]) => void
}

function displayBookingSource(booking: Booking) {
  return booking.booking_source === 'Manual' ? 'Manual' : 'Workflow'
}

function formatVariance(booking: Booking) {
  const variance = getBookingVariance(booking)

  if (variance === null) {
    return '-'
  }

  const prefix = variance > 0 ? '+' : ''
  return `${prefix}${formatCurrency(variance)}`
}

export function KpiPage({
  data,
  kpis,
  targets,
  monthRange,
  monthLabel,
  selectedBookingId,
  selectedQuoteId,
  onPreviousMonth,
  onCurrentMonth,
  onNextMonth,
  onSaveTargets,
  onApplyBookingVerifications,
  onMarkBookingsNotFound,
}: KpiPageProps) {
  const monthBookings = useMemo(() => filterBookingsForMonth(data.bookings, monthRange), [data.bookings, monthRange])
  const monthQuotes = useMemo(() => filterQuotesForMonth(data.quotes, monthRange), [data.quotes, monthRange])
  const waitingForVerification = kpis.estimatedSalesWon + kpis.notFoundSales
  const impactSummary = `${monthLabel} has ${formatCurrency(kpis.estimatedSalesWon)} estimated sales and ${formatCurrency(kpis.verifiedSalesWon)} verified sales against the sales target. ${formatCurrency(waitingForVerification)} is still waiting for verification.`

  const bookingColumns: DataTableColumn<Booking>[] = [
    { key: 'booking', header: 'Booking Number', render: (booking) => booking.booking_number },
    { key: 'customer', header: 'Customer', render: (booking) => booking.customer_full_name },
    {
      key: 'source',
      header: 'Source',
      render: (booking) => displayBookingSource(booking),
    },
    { key: 'estimated', header: 'Estimated Value', align: 'right', render: (booking) => formatCurrency(booking.estimated_value) },
    { key: 'date', header: 'Booking Date', render: (booking) => formatDate(booking.booking_date) },
    {
      key: 'actual',
      header: 'Actual Value',
      align: 'right',
      render: (booking) => (booking.actual_value === null ? '-' : formatCurrency(booking.actual_value)),
    },
    { key: 'variance', header: 'Variance', align: 'right', render: (booking) => formatVariance(booking) },
    { key: 'verification', header: 'Verification', render: (booking) => <StatusPill status={booking.verification_status} /> },
    { key: 'status', header: 'Status', render: (booking) => <StatusPill status={booking.status} /> },
  ]

  const quoteColumns: DataTableColumn<Quote>[] = [
    { key: 'quote', header: 'Quote Reference', render: (quote) => quote.quote_reference },
    { key: 'customer', header: 'Customer', render: (quote) => quote.customer_full_name },
    { key: 'date', header: 'Sent Date', render: (quote) => formatDate(quote.quote_sent_date) },
    { key: 'value', header: 'Value', align: 'right', render: (quote) => (quote.quote_value ? formatCurrency(quote.quote_value) : '-') },
    { key: 'status', header: 'Status', render: (quote) => <StatusPill status={quote.status} /> },
  ]

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">KPI</span>
          <h1>Monthly Performance</h1>
          <p>Calculated from the first day to the last day of the selected month.</p>
        </div>
        <MonthSelector
          monthLabel={monthLabel}
          onPreviousMonth={onPreviousMonth}
          onCurrentMonth={onCurrentMonth}
          onNextMonth={onNextMonth}
        />
      </header>

      <KpiSummaryGrid kpis={kpis} targets={targets} monthLabel={monthLabel} />

      <section className="kpi-explanation" aria-label="KPI impact summary">
        <p>{impactSummary}</p>
      </section>

      <BookingVerificationImport
        bookings={data.bookings}
        monthRange={monthRange}
        onApplyBookingVerifications={onApplyBookingVerifications}
        onMarkBookingsNotFound={onMarkBookingsNotFound}
      />

      <section className="surface">
        <div className="section-header">
          <div>
            <span className="eyebrow">Booking foundation</span>
            <h2>Sales Won Records</h2>
          </div>
          <span className="record-count">{monthBookings.length}</span>
        </div>

        {monthBookings.length ? (
          <>
            <div className="desktop-table">
              <DataTable
                columns={bookingColumns}
                records={monthBookings}
                getRowClassName={(booking) => (booking.id === selectedBookingId ? 'is-highlighted' : undefined)}
              />
            </div>
            <div className="mobile-record-list">
              {monthBookings.map((booking) => (
                <MobileRecordCard
                  key={booking.id}
                  title={booking.booking_number}
                  subtitle={booking.customer_full_name}
                  status={booking.verification_status}
                  isHighlighted={booking.id === selectedBookingId}
                  fields={[
                    { label: 'Source', value: displayBookingSource(booking) },
                    { label: 'Date', value: formatDate(booking.booking_date) },
                    { label: 'Estimated', value: formatCurrency(booking.estimated_value) },
                    { label: 'Actual', value: booking.actual_value === null ? '-' : formatCurrency(booking.actual_value) },
                    { label: 'Variance', value: formatVariance(booking) },
                    { label: 'Status', value: <StatusPill status={booking.status} /> },
                  ]}
                />
              ))}
            </div>
          </>
        ) : (
          <EmptyState icon={<ClipboardList size={24} />} title="No bookings for this month" message="Bookings will appear here when their booking date lands in the selected month." />
        )}
      </section>

      <section className="surface">
        <div className="section-header">
          <div>
            <span className="eyebrow">Quote foundation</span>
            <h2>Quote Records</h2>
          </div>
          <span className="record-count">{monthQuotes.length}</span>
        </div>

        {monthQuotes.length ? (
          <>
            <div className="desktop-table">
              <DataTable
                columns={quoteColumns}
                records={monthQuotes}
                getRowClassName={(quote) => (quote.id === selectedQuoteId ? 'is-highlighted' : undefined)}
              />
            </div>
            <div className="mobile-record-list">
              {monthQuotes.map((quote) => (
                <MobileRecordCard
                  key={quote.id}
                  title={quote.quote_reference}
                  subtitle={quote.customer_full_name}
                  status={quote.status}
                  isHighlighted={quote.id === selectedQuoteId}
                  fields={[
                    { label: 'Sent date', value: formatDate(quote.quote_sent_date) },
                    { label: 'Value', value: quote.quote_value ? formatCurrency(quote.quote_value) : '-' },
                  ]}
                />
              ))}
            </div>
          </>
        ) : (
          <EmptyState icon={<BarChart3 size={24} />} title="No quotes for this month" message="Quotes sent in the selected month will appear here." />
        )}
      </section>

      <KpiTargetsPanel targets={targets} onSaveTargets={onSaveTargets} />
    </div>
  )
}
