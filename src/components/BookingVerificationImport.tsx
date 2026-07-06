import { FileUp, RotateCcw } from 'lucide-react'
import { useState, type ChangeEvent } from 'react'
import type { Booking, BookingVerificationUpdate } from '../types/performance'
import type { MonthRange } from '../utils/kpi'
import { formatCurrency } from '../utils/kpi'
import {
  buildBookingVerificationReviewRows,
  parseBookingVerificationCsv,
  type BookingVerificationReviewRow,
} from '../utils/bookingVerificationImport'
import { DataTable, type DataTableColumn } from './DataTable'
import { EmptyState } from './EmptyState'
import { StatusPill } from './StatusPill'

type BookingVerificationImportProps = {
  bookings: Booking[]
  monthRange: MonthRange
  onApplyBookingVerifications: (updates: BookingVerificationUpdate[]) => void
  onMarkBookingsNotFound: (bookingIds: string[]) => void
}

function formatNullableCurrency(value: number | null) {
  return value === null ? '-' : formatCurrency(value)
}

function formatDifference(row: BookingVerificationReviewRow) {
  if (row.difference === null) {
    return '-'
  }

  const prefix = row.difference > 0 ? '+' : ''
  const percentage = row.variancePercent === null ? '' : ` (${prefix}${Math.round(row.variancePercent * 100)}%)`
  return `${prefix}${formatCurrency(row.difference)}${percentage}`
}

function buildVerificationUpdate(row: BookingVerificationReviewRow): BookingVerificationUpdate | null {
  if (!row.bookingId || row.actualValue === null) {
    return null
  }

  return {
    bookingId: row.bookingId,
    actualValue: row.actualValue,
    verificationStatus: 'Verified',
    varianceAmount: row.difference ?? undefined,
    variancePercent: row.variancePercent,
    varianceDetected: row.matchStatus === 'Mismatch',
  }
}

export function BookingVerificationImport({
  bookings,
  monthRange,
  onApplyBookingVerifications,
  onMarkBookingsNotFound,
}: BookingVerificationImportProps) {
  const [reviewRows, setReviewRows] = useState<BookingVerificationReviewRow[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const [manualPlaceholder, setManualPlaceholder] = useState<BookingVerificationReviewRow | null>(null)

  const applyableRows = reviewRows.filter(
    (row) => (row.matchStatus === 'Verified' || row.matchStatus === 'Mismatch') && row.bookingId && row.actualValue !== null,
  )

  const removeReviewRows = (rowIds: string[]) => {
    const rowIdSet = new Set(rowIds)
    setReviewRows((current) => current.filter((row) => !rowIdSet.has(row.id)))
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    setFileName(file.name)
    setManualPlaceholder(null)

    void file
      .text()
      .then((content) => {
        const result = parseBookingVerificationCsv(content)
        const rows = buildBookingVerificationReviewRows(bookings, result.rows, monthRange)
        setErrors(result.errors)
        setReviewRows(rows)
      })
      .catch((error: Error) => {
        setErrors([`CSV import failed: ${error.message}`])
        setReviewRows([])
      })
  }

  const handleApplyRow = (row: BookingVerificationReviewRow) => {
    const update = buildVerificationUpdate(row)

    if (!update) {
      return
    }

    onApplyBookingVerifications([update])
    removeReviewRows([row.id])
  }

  const handleApplyAll = () => {
    const updates = applyableRows.map(buildVerificationUpdate).filter((update): update is BookingVerificationUpdate => Boolean(update))

    if (!updates.length) {
      return
    }

    onApplyBookingVerifications(updates)
    removeReviewRows(applyableRows.map((row) => row.id))
  }

  const handleMarkNotFound = (row: BookingVerificationReviewRow) => {
    if (!row.bookingId) {
      return
    }

    onMarkBookingsNotFound([row.bookingId])
    removeReviewRows([row.id])
  }

  const columns: DataTableColumn<BookingVerificationReviewRow>[] = [
    { key: 'booking', header: 'Booking Number', render: (row) => row.bookingNumber },
    { key: 'customer', header: 'Customer', render: (row) => row.customerName ?? '-' },
    {
      key: 'estimated',
      header: 'Estimated Value',
      align: 'right',
      render: (row) => formatNullableCurrency(row.estimatedValue),
    },
    {
      key: 'actual',
      header: 'Actual Value',
      align: 'right',
      render: (row) => formatNullableCurrency(row.actualValue),
    },
    { key: 'difference', header: 'Difference', align: 'right', render: (row) => formatDifference(row) },
    {
      key: 'status',
      header: 'Match Status',
      render: (row) => (
        <span className="status-stack">
          <StatusPill status={row.matchStatus} />
          <small>{row.note}</small>
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      render: (row) => (
        <span className="table-action-group">
          {row.matchStatus === 'Verified' || row.matchStatus === 'Mismatch' ? (
            <button type="button" className="secondary-button secondary-button--compact" onClick={() => handleApplyRow(row)}>
              Apply verification
            </button>
          ) : null}
          {row.matchStatus === 'Not Found' ? (
            <button type="button" className="secondary-button secondary-button--compact" onClick={() => handleMarkNotFound(row)}>
              Mark Not Found
            </button>
          ) : null}
          {row.matchStatus === 'External Only' ? (
            <button type="button" className="secondary-button secondary-button--compact" onClick={() => setManualPlaceholder(row)}>
              Create Manual Booking placeholder
            </button>
          ) : null}
          <button type="button" className="text-button" onClick={() => removeReviewRows([row.id])}>
            Ignore
          </button>
        </span>
      ),
    },
  ]

  return (
    <section className="surface">
      <div className="section-header">
        <div>
          <span className="eyebrow">Verification import</span>
          <h2>Monthly Booking Verification</h2>
        </div>
        {applyableRows.length ? (
          <button type="button" className="primary-button" onClick={handleApplyAll}>
            Apply {applyableRows.length} verified
          </button>
        ) : null}
      </div>

      <label className="file-drop">
        <FileUp size={20} aria-hidden="true" />
        <span>{fileName ? fileName : 'Upload CSV'}</span>
        <input accept=".csv,text/csv" type="file" onChange={handleFileChange} />
      </label>

      {errors.length ? (
        <div className="import-errors" role="status">
          {errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      ) : null}

      {manualPlaceholder ? (
        <div className="placeholder-note">
          <strong>{manualPlaceholder.bookingNumber}</strong>
          <span>{formatNullableCurrency(manualPlaceholder.actualValue)} is ready to re-enter as a manual booking later.</span>
        </div>
      ) : null}

      {reviewRows.length ? (
        <>
          <div className="desktop-table review-table">
            <DataTable columns={columns} records={reviewRows} />
          </div>
          <div className="mobile-record-list">
            {reviewRows.map((row) => (
              <article className="mobile-record" key={row.id}>
                <div className="mobile-record__topline">
                  <div>
                    <h3>{row.bookingNumber}</h3>
                    <p>{row.customerName ?? 'External booking'}</p>
                  </div>
                  <StatusPill status={row.matchStatus} />
                </div>
                <dl className="mobile-record__fields">
                  <div>
                    <dt>Estimated</dt>
                    <dd>{formatNullableCurrency(row.estimatedValue)}</dd>
                  </div>
                  <div>
                    <dt>Actual</dt>
                    <dd>{formatNullableCurrency(row.actualValue)}</dd>
                  </div>
                  <div>
                    <dt>Difference</dt>
                    <dd>{formatDifference(row)}</dd>
                  </div>
                  <div>
                    <dt>Note</dt>
                    <dd>{row.note}</dd>
                  </div>
                </dl>
                <div className="table-action-group">
                  {row.matchStatus === 'Verified' || row.matchStatus === 'Mismatch' ? (
                    <button type="button" className="secondary-button secondary-button--compact" onClick={() => handleApplyRow(row)}>
                      Apply verification
                    </button>
                  ) : null}
                  {row.matchStatus === 'Not Found' ? (
                    <button type="button" className="secondary-button secondary-button--compact" onClick={() => handleMarkNotFound(row)}>
                      Mark Not Found
                    </button>
                  ) : null}
                  {row.matchStatus === 'External Only' ? (
                    <button type="button" className="secondary-button secondary-button--compact" onClick={() => setManualPlaceholder(row)}>
                      Create Manual Booking placeholder
                    </button>
                  ) : null}
                  <button type="button" className="text-button" onClick={() => removeReviewRows([row.id])}>
                    Ignore
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <EmptyState
          icon={<RotateCcw size={24} />}
          title="No import review yet"
          message="Upload a CSV export to compare booking numbers and actual values."
        />
      )}
    </section>
  )
}
