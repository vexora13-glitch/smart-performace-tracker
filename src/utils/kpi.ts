import type { Booking, MonthlyKpis, PerformanceData, Quote, SiteVisit, Task } from '../types/performance'

const completedSiteVisitStatuses = new Set(['Report Sent', 'Quote Sent', 'Won', 'Lost / Closed'])
const sentQuoteStatuses = new Set(['Sent', 'Follow Up', 'Booked', 'Lost'])

export type MonthRange = {
  start: Date
  end: Date
  label: string
}

export function parseDate(value: string | null | undefined) {
  if (!value) {
    return null
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(year, month - 1, day)
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function isWithinMonth(value: string | null | undefined, range: MonthRange) {
  const date = parseDate(value)
  return Boolean(date && date >= range.start && date <= range.end)
}

export function getBookingVerifiedSalesValue(booking: Booking) {
  if (booking.verification_status === 'Verified' && booking.actual_value !== null) {
    return booking.actual_value
  }

  return booking.estimated_value
}

export function getBookingVariance(booking: Booking) {
  if (booking.actual_value === null) {
    return null
  }

  return booking.actual_value - booking.estimated_value
}

function countCompletedSiteVisits(siteVisits: SiteVisit[], range: MonthRange) {
  return siteVisits.filter(
    (siteVisit) =>
      completedSiteVisitStatuses.has(siteVisit.status) && isWithinMonth(siteVisit.booked_date, range),
  ).length
}

function countSentQuotes(quotes: Quote[], range: MonthRange) {
  return quotes.filter(
    (quote) => sentQuoteStatuses.has(quote.status) && isWithinMonth(quote.quote_sent_date, range),
  ).length
}

function countCompletedTasks(tasks: Task[], taskType: Task['task_type'], range: MonthRange) {
  return tasks.filter(
    (task) =>
      task.status === 'Completed' &&
      task.task_type === taskType &&
      isWithinMonth(task.due_date ?? task.created_at, range),
  ).length
}

export function getMonthRange(referenceDate = new Date()): MonthRange {
  const start = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1)
  const end = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0, 23, 59, 59, 999)
  const label = referenceDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return { start, end, label }
}

export function getCurrentMonthRange(referenceDate = new Date()): MonthRange {
  return getMonthRange(referenceDate)
}

export function filterBookingsForMonth(bookings: Booking[], range: MonthRange) {
  return bookings.filter((booking) => booking.status === 'Won' && isWithinMonth(booking.booking_date, range))
}

export function filterQuotesForMonth(quotes: Quote[], range: MonthRange) {
  return quotes.filter((quote) => isWithinMonth(quote.quote_sent_date, range))
}

export function calculateMonthlyKpis(data: PerformanceData, referenceDate = new Date()): MonthlyKpis {
  const range = getMonthRange(referenceDate)
  const monthBookings = filterBookingsForMonth(data.bookings, range)
  const estimatedBookings = monthBookings.filter((booking) => booking.verification_status === 'Estimated')
  const verifiedBookings = monthBookings.filter((booking) => booking.verification_status === 'Verified')
  const mismatchBookings = monthBookings.filter((booking) => booking.verification_status === 'Mismatch')
  const notFoundBookings = monthBookings.filter((booking) => booking.verification_status === 'Not Found')

  const estimatedSalesWon = estimatedBookings.reduce((total, booking) => total + booking.estimated_value, 0)
  const verifiedSalesWon = verifiedBookings.reduce(
    (total, booking) => total + getBookingVerifiedSalesValue(booking),
    0,
  )
  const mismatchSales = mismatchBookings.reduce((total, booking) => total + getBookingVerifiedSalesValue(booking), 0)
  const notFoundSales = notFoundBookings.reduce((total, booking) => total + booking.estimated_value, 0)

  return {
    estimatedSalesWon,
    verifiedSalesWon,
    totalSalesProgress: estimatedSalesWon + verifiedSalesWon,
    mismatchSales,
    notFoundSales,
    estimatedBookingCount: estimatedBookings.length,
    verifiedBookingCount: verifiedBookings.length,
    mismatchBookingCount: mismatchBookings.length,
    notFoundBookingCount: notFoundBookings.length,
    siteVisitsDone: countCompletedSiteVisits(data.siteVisits, range),
    quotesSent: countSentQuotes(data.quotes, range),
    bookingsWon: monthBookings.length,
    trainingSessions: countCompletedTasks(data.tasks, 'Training', range),
    consultancyMeetings: countCompletedTasks(data.tasks, 'Consultancy', range),
  }
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'NZD',
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatDate(value: string | null | undefined) {
  const date = parseDate(value)

  if (!date) {
    return 'Not set'
  }

  return date.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(dateValue: string, timeValue: string) {
  const time = timeValue.slice(0, 5)
  return `${formatDate(dateValue)} at ${time}`
}

export function sortSiteVisitsBySchedule(siteVisits: SiteVisit[]) {
  return [...siteVisits].sort((first, second) => {
    const firstDate = parseDate(`${first.booked_date}T${first.booked_time}`)?.getTime() ?? 0
    const secondDate = parseDate(`${second.booked_date}T${second.booked_time}`)?.getTime() ?? 0
    return firstDate - secondDate
  })
}
