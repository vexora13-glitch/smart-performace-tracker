import { BarChart3, ClipboardList } from 'lucide-react'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { EmptyState } from '../components/EmptyState'
import { KpiSummaryGrid } from '../components/KpiSummaryGrid'
import { MobileRecordCard } from '../components/MobileRecordCard'
import { StatusPill } from '../components/StatusPill'
import type { Booking, MonthlyKpis, PerformanceData, Quote } from '../types/performance'
import { formatCurrency, formatDate } from '../utils/kpi'

type KpiPageProps = {
  data: PerformanceData
  kpis: MonthlyKpis
  monthLabel: string
}

export function KpiPage({ data, kpis, monthLabel }: KpiPageProps) {
  const bookingColumns: DataTableColumn<Booking>[] = [
    { key: 'booking', header: 'Booking Number', render: (booking) => booking.booking_number },
    { key: 'customer', header: 'Customer', render: (booking) => booking.customer_full_name },
    { key: 'date', header: 'Booking Date', render: (booking) => formatDate(booking.booking_date) },
    {
      key: 'value',
      header: 'Sales Value',
      align: 'right',
      render: (booking) => formatCurrency(booking.verification_status === 'Verified' && booking.actual_value !== null ? booking.actual_value : booking.estimated_value),
    },
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
          <p>Calculated from the first day to the last day of the current month.</p>
        </div>
      </header>

      <KpiSummaryGrid kpis={kpis} monthLabel={monthLabel} />

      <section className="surface">
        <div className="section-header">
          <div>
            <span className="eyebrow">Booking foundation</span>
            <h2>Sales Won Records</h2>
          </div>
          <span className="record-count">{data.bookings.length}</span>
        </div>

        {data.bookings.length ? (
          <>
            <div className="desktop-table">
              <DataTable columns={bookingColumns} records={data.bookings} />
            </div>
            <div className="mobile-record-list">
              {data.bookings.map((booking) => (
                <MobileRecordCard
                  key={booking.id}
                  title={booking.booking_number}
                  subtitle={booking.customer_full_name}
                  status={booking.verification_status}
                  fields={[
                    { label: 'Date', value: formatDate(booking.booking_date) },
                    {
                      label: 'Value',
                      value: formatCurrency(
                        booking.verification_status === 'Verified' && booking.actual_value !== null
                          ? booking.actual_value
                          : booking.estimated_value,
                      ),
                    },
                    { label: 'Status', value: <StatusPill status={booking.status} /> },
                  ]}
                />
              ))}
            </div>
          </>
        ) : (
          <EmptyState icon={<ClipboardList size={24} />} title="No bookings yet" message="Manual booking entry is scaffolded for Prompt 2." />
        )}
      </section>

      <section className="surface">
        <div className="section-header">
          <div>
            <span className="eyebrow">Quote foundation</span>
            <h2>Quote Records</h2>
          </div>
          <span className="record-count">{data.quotes.length}</span>
        </div>

        {data.quotes.length ? (
          <DataTable columns={quoteColumns} records={data.quotes} />
        ) : (
          <EmptyState icon={<BarChart3 size={24} />} title="No quotes yet" message="Quote fields and KPI rules are ready in the schema." />
        )}
      </section>
    </div>
  )
}
