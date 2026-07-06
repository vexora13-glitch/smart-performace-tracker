export const SITE_VISIT_STATUSES = [
  'Booked',
  'Completed',
  'Report Sent',
  'Quote Sent',
  'Won',
  'Lost / Closed',
] as const

export const QUOTE_STATUSES = ['Draft', 'Sent', 'Follow Up', 'Booked', 'Lost'] as const

export const BOOKING_VERIFICATION_STATUSES = [
  'Estimated',
  'Verified',
  'Mismatch',
  'Not Found',
] as const

export const BOOKING_STATUSES = ['Won', 'Cancelled'] as const

export const TASK_STATUSES = ['To Do', 'In Progress', 'Completed'] as const

export const TASK_TYPES = [
  'Follow-up',
  'Report',
  'Quote',
  'Booking Admin',
  'Training',
  'Consultancy',
  'General',
] as const

export type SiteVisitStatus = (typeof SITE_VISIT_STATUSES)[number]
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]
export type BookingVerificationStatus = (typeof BOOKING_VERIFICATION_STATUSES)[number]
export type BookingStatus = (typeof BOOKING_STATUSES)[number]
export type TaskStatus = (typeof TASK_STATUSES)[number]
export type TaskType = (typeof TASK_TYPES)[number]

export type PageKey = 'dashboard' | 'work' | 'tasks' | 'kpi' | 'reports' | 'settings'

export type SiteVisit = {
  id: string
  reference_number: string
  customer_full_name: string
  contact_person: string | null
  contact_number: string
  email: string | null
  address: string | null
  suburb: string
  booked_date: string
  booked_time: string
  move_type: string | null
  notes: string | null
  status: SiteVisitStatus
  estimated_quote_value: number | null
  created_at: string
  updated_at: string
}

export type Quote = {
  id: string
  site_visit_id: string | null
  quote_reference: string
  customer_full_name: string
  quote_value: number | null
  quote_sent_date: string | null
  status: QuoteStatus
  created_at: string
  updated_at: string
}

export type Booking = {
  id: string
  site_visit_id: string | null
  quote_id: string | null
  booking_number: string
  customer_full_name: string
  booking_date: string
  estimated_value: number
  actual_value: number | null
  verification_status: BookingVerificationStatus
  status: BookingStatus
  notes: string | null
  created_at: string
  updated_at: string
}

export type Task = {
  id: string
  site_visit_id: string | null
  title: string
  description: string | null
  due_date: string | null
  status: TaskStatus
  task_type: TaskType
  created_at: string
  updated_at: string
}

export type ActivityTimelineItem = {
  id: string
  entity_type: string
  entity_id: string
  event_type: string
  event_label: string
  event_description: string | null
  created_at: string
}

export type PerformanceData = {
  siteVisits: SiteVisit[]
  quotes: Quote[]
  bookings: Booking[]
  tasks: Task[]
}

export type MonthlyKpis = {
  salesWon: number
  siteVisitsDone: number
  quotesSent: number
  trainingSessions: number
  consultancyMeetings: number
}

export type NewSiteVisitInput = {
  customer_full_name: string
  contact_person: string
  contact_number: string
  email: string
  address: string
  suburb: string
  booked_date: string
  booked_time: string
  move_type: string
  notes: string
  estimated_quote_value: number | null
}

export type NewTaskInput = {
  site_visit_id: string | null
  title: string
  description: string
  due_date: string | null
  status: TaskStatus
  task_type: TaskType
}
