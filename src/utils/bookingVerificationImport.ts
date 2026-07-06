import type { Booking } from '../types/performance'
import type { MonthRange } from './kpi'
import { filterBookingsForMonth } from './kpi'

export type ParsedBookingVerificationRow = {
  rowNumber: number
  bookingNumber: string
  actualValue: number
}

export type BookingVerificationReviewStatus = 'Verified' | 'Mismatch' | 'Not Found' | 'External Only'

export type BookingVerificationReviewRow = {
  id: string
  bookingNumber: string
  customerName: string | null
  estimatedValue: number | null
  actualValue: number | null
  difference: number | null
  variancePercent: number | null
  matchStatus: BookingVerificationReviewStatus
  bookingId: string | null
  note: string
}

export type BookingVerificationParseResult = {
  rows: ParsedBookingVerificationRow[]
  errors: string[]
}

const bookingNumberHeadings = new Set(['bookingnumber', 'bookingno', 'jobnumber', 'jobno', 'reference'])
const actualValueHeadings = new Set(['actualvalue', 'finalvalue', 'invoicevalue', 'total', 'amount'])
const significantVarianceMinimumAmount = 50
const significantVarianceRatio = 0.05

function normalizeHeading(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function normalizeBookingNumber(value: string) {
  return value.trim().toUpperCase()
}

function parseCsvRows(content: string) {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentCell = ''
  let isQuoted = false

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]
    const nextCharacter = content[index + 1]

    if (character === '"') {
      if (isQuoted && nextCharacter === '"') {
        currentCell += '"'
        index += 1
      } else {
        isQuoted = !isQuoted
      }
      continue
    }

    if (character === ',' && !isQuoted) {
      currentRow.push(currentCell)
      currentCell = ''
      continue
    }

    if ((character === '\n' || character === '\r') && !isQuoted) {
      if (character === '\r' && nextCharacter === '\n') {
        index += 1
      }

      currentRow.push(currentCell)
      if (currentRow.some((cell) => cell.trim().length > 0)) {
        rows.push(currentRow)
      }
      currentRow = []
      currentCell = ''
      continue
    }

    currentCell += character
  }

  currentRow.push(currentCell)
  if (currentRow.some((cell) => cell.trim().length > 0)) {
    rows.push(currentRow)
  }

  return rows
}

function parseMoneyValue(value: string) {
  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  const isNegative = trimmed.startsWith('(') && trimmed.endsWith(')')
  const cleaned = trimmed.replace(/[^\d.-]/g, '')
  const parsed = Number(cleaned)

  if (!Number.isFinite(parsed)) {
    return null
  }

  return isNegative ? -Math.abs(parsed) : parsed
}

function getColumnIndex(headings: string[], supportedHeadings: Set<string>) {
  return headings.findIndex((heading) => supportedHeadings.has(normalizeHeading(heading)))
}

export function isSignificantVariance(estimatedValue: number, actualValue: number) {
  const difference = Math.abs(actualValue - estimatedValue)

  if (estimatedValue === 0) {
    return difference > 0
  }

  return difference >= significantVarianceMinimumAmount && difference / Math.abs(estimatedValue) >= significantVarianceRatio
}

export function parseBookingVerificationCsv(content: string): BookingVerificationParseResult {
  const rows = parseCsvRows(content)
  const [headings, ...dataRows] = rows
  const errors: string[] = []

  if (!headings) {
    return { rows: [], errors: ['The CSV file is empty.'] }
  }

  const bookingNumberIndex = getColumnIndex(headings, bookingNumberHeadings)
  const actualValueIndex = getColumnIndex(headings, actualValueHeadings)

  if (bookingNumberIndex === -1) {
    errors.push('A booking number column was not found.')
  }

  if (actualValueIndex === -1) {
    errors.push('An actual value column was not found.')
  }

  if (bookingNumberIndex === -1 || actualValueIndex === -1) {
    return { rows: [], errors }
  }

  const parsedRows: ParsedBookingVerificationRow[] = []
  const seenBookingNumbers = new Set<string>()

  dataRows.forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 2
    const bookingNumber = row[bookingNumberIndex]?.trim() ?? ''
    const normalizedBookingNumber = normalizeBookingNumber(bookingNumber)
    const actualValue = parseMoneyValue(row[actualValueIndex] ?? '')

    if (!normalizedBookingNumber) {
      errors.push(`Row ${rowNumber} was skipped because the booking number is blank.`)
      return
    }

    if (actualValue === null) {
      errors.push(`Row ${rowNumber} was skipped because the actual value is not valid.`)
      return
    }

    if (seenBookingNumbers.has(normalizedBookingNumber)) {
      errors.push(`Row ${rowNumber} was skipped because ${bookingNumber} is duplicated in the import.`)
      return
    }

    seenBookingNumbers.add(normalizedBookingNumber)
    parsedRows.push({ rowNumber, bookingNumber: bookingNumber.trim(), actualValue })
  })

  return { rows: parsedRows, errors }
}

export function buildBookingVerificationReviewRows(
  bookings: Booking[],
  importedRows: ParsedBookingVerificationRow[],
  range: MonthRange,
): BookingVerificationReviewRow[] {
  const monthBookings = filterBookingsForMonth(bookings, range)
  const bookingByNumber = new Map(monthBookings.map((booking) => [normalizeBookingNumber(booking.booking_number), booking]))
  const importedNumbers = new Set<string>()
  const reviewRows: BookingVerificationReviewRow[] = []

  importedRows.forEach((row) => {
    const normalizedBookingNumber = normalizeBookingNumber(row.bookingNumber)
    const matchedBooking = bookingByNumber.get(normalizedBookingNumber)
    importedNumbers.add(normalizedBookingNumber)

    if (!matchedBooking) {
      reviewRows.push({
        id: `external-${row.rowNumber}-${normalizedBookingNumber}`,
        bookingNumber: row.bookingNumber,
        customerName: null,
        estimatedValue: null,
        actualValue: row.actualValue,
        difference: null,
        variancePercent: null,
        matchStatus: 'External Only',
        bookingId: null,
        note: 'Imported booking was not found in this month.',
      })
      return
    }

    const difference = row.actualValue - matchedBooking.estimated_value
    const variancePercent =
      matchedBooking.estimated_value === 0 ? null : difference / Math.abs(matchedBooking.estimated_value)
    const hasSignificantVariance = isSignificantVariance(matchedBooking.estimated_value, row.actualValue)

    reviewRows.push({
      id: `matched-${matchedBooking.id}`,
      bookingNumber: matchedBooking.booking_number,
      customerName: matchedBooking.customer_full_name,
      estimatedValue: matchedBooking.estimated_value,
      actualValue: row.actualValue,
      difference,
      variancePercent,
      matchStatus: hasSignificantVariance ? 'Mismatch' : 'Verified',
      bookingId: matchedBooking.id,
      note: hasSignificantVariance ? 'Variance detected. Applying will still verify this booking.' : 'Ready to verify.',
    })
  })

  monthBookings.forEach((booking) => {
    const normalizedBookingNumber = normalizeBookingNumber(booking.booking_number)

    if (importedNumbers.has(normalizedBookingNumber) || booking.verification_status === 'Verified') {
      return
    }

    reviewRows.push({
      id: `not-found-${booking.id}`,
      bookingNumber: booking.booking_number,
      customerName: booking.customer_full_name,
      estimatedValue: booking.estimated_value,
      actualValue: booking.actual_value,
      difference: null,
      variancePercent: null,
      matchStatus: 'Not Found',
      bookingId: booking.id,
      note: 'No matching row was found in the import.',
    })
  })

  return reviewRows
}
