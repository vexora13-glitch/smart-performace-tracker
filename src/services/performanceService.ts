import { createDemoPerformanceData } from '../data/demoData'
import { hasSupabaseConfig, supabase } from '../lib/supabase'
import type {
  ActivityTimelineItem,
  Booking,
  KpiTarget,
  NewBookingInput,
  NewQuoteInput,
  NewSiteVisitInput,
  NewTaskInput,
  PerformanceData,
  Quote,
  SiteVisit,
  Task,
} from '../types/performance'
import { createDefaultKpiTargets, mergeKpiTargets } from '../utils/kpiTargets'

export type PerformanceDataResult = {
  data: PerformanceData
  source: 'supabase' | 'demo'
  notice: string
}

export type KpiTargetsResult = {
  targets: KpiTarget[]
  notice: string
}

const emptyData: PerformanceData = {
  siteVisits: [],
  quotes: [],
  bookings: [],
  tasks: [],
  activityTimeline: [],
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function cleanText(value: string) {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function formatReferenceDate() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${now.getFullYear()}${month}`
}

function cleanMoneyValue(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function buildSiteVisitReference(sequence: number) {
  return `SV-${formatReferenceDate()}-${String(sequence).padStart(3, '0')}`
}

export function buildQuoteReference(sequence: number) {
  return `Q-${formatReferenceDate()}-${String(sequence).padStart(3, '0')}`
}

export function buildBookingReference(sequence: number) {
  return `B-${formatReferenceDate()}-${String(sequence).padStart(3, '0')}`
}

export async function loadPerformanceData(): Promise<PerformanceDataResult> {
  if (!hasSupabaseConfig || !supabase) {
    return {
      data: createDemoPerformanceData(),
      source: 'demo',
      notice: 'Supabase env vars are not configured, so demo data is showing.',
    }
  }

  const [siteVisitsResult, quotesResult, bookingsResult, tasksResult, activityTimelineResult] = await Promise.all([
    supabase.from('site_visits').select('*').order('booked_date', { ascending: true }),
    supabase.from('quotes').select('*').order('quote_sent_date', { ascending: false }),
    supabase.from('bookings').select('*').order('booking_date', { ascending: false }),
    supabase.from('tasks').select('*').order('due_date', { ascending: true }),
    supabase.from('activity_timeline').select('*').order('created_at', { ascending: false }).limit(100),
  ])

  const failedResult = [siteVisitsResult, quotesResult, bookingsResult, tasksResult, activityTimelineResult].find(
    (result) => result.error,
  )

  if (failedResult?.error) {
    return {
      data: createDemoPerformanceData(),
      source: 'demo',
      notice: `Supabase request failed, so demo data is showing: ${failedResult.error.message}`,
    }
  }

  return {
    data: {
      siteVisits: (siteVisitsResult.data ?? emptyData.siteVisits) as SiteVisit[],
      quotes: (quotesResult.data ?? emptyData.quotes) as PerformanceData['quotes'],
      bookings: (bookingsResult.data ?? emptyData.bookings) as PerformanceData['bookings'],
      tasks: (tasksResult.data ?? emptyData.tasks) as Task[],
      activityTimeline: (activityTimelineResult.data ?? emptyData.activityTimeline) as ActivityTimelineItem[],
    },
    source: 'supabase',
    notice: 'Connected to Supabase.',
  }
}

export async function loadKpiTargets(): Promise<KpiTargetsResult> {
  const defaults = createDefaultKpiTargets()

  if (!hasSupabaseConfig || !supabase) {
    return {
      targets: defaults,
      notice: '',
    }
  }

  const { data, error } = await supabase
    .from('kpi_targets')
    .select('*')
    .eq('period_type', 'monthly')
    .eq('is_active', true)

  if (error) {
    return {
      targets: defaults,
      notice: `KPI targets are using defaults. Supabase target load failed: ${error.message}`,
    }
  }

  return {
    targets: mergeKpiTargets((data ?? []) as KpiTarget[]),
    notice: '',
  }
}

export async function saveKpiTargets(targets: KpiTarget[]): Promise<KpiTarget[]> {
  if (!supabase) {
    return targets
  }

  const payload = targets.map(({ id: _id, created_at: _createdAt, updated_at: _updatedAt, ...target }) => target)
  const { data, error } = await supabase
    .from('kpi_targets')
    .upsert(payload, { onConflict: 'kpi_key,period_type' })
    .select('*')

  if (error) {
    throw new Error(error.message)
  }

  return mergeKpiTargets((data ?? []) as KpiTarget[])
}

export function createLocalSiteVisit(input: NewSiteVisitInput, sequence: number): SiteVisit {
  const now = new Date().toISOString()

  return {
    id: createId(),
    reference_number: buildSiteVisitReference(sequence),
    customer_full_name: input.customer_full_name.trim(),
    contact_person: cleanText(input.contact_person),
    contact_number: input.contact_number.trim(),
    email: cleanText(input.email),
    address: cleanText(input.address),
    suburb: input.suburb.trim(),
    booked_date: input.booked_date,
    booked_time: input.booked_time,
    move_type: cleanText(input.move_type),
    notes: cleanText(input.notes),
    status: 'Booked',
    estimated_quote_value: cleanMoneyValue(input.estimated_quote_value),
    created_at: now,
    updated_at: now,
  }
}

export async function saveSiteVisit(siteVisit: SiteVisit): Promise<SiteVisit> {
  if (!supabase) {
    return siteVisit
  }

  const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...insertPayload } = siteVisit
  const { data, error } = await supabase.from('site_visits').insert(insertPayload).select('*').single()

  if (error) {
    throw new Error(error.message)
  }

  return data as SiteVisit
}

export async function updateSiteVisit(siteVisit: SiteVisit): Promise<SiteVisit> {
  if (!supabase) {
    return siteVisit
  }

  const { id, created_at: _createdAt, updated_at: _updatedAt, ...updatePayload } = siteVisit
  const { data, error } = await supabase.from('site_visits').update(updatePayload).eq('id', id).select('*').single()

  if (error) {
    throw new Error(error.message)
  }

  return data as SiteVisit
}

export function createLocalQuote(input: NewQuoteInput, sequence: number): Quote {
  const now = new Date().toISOString()
  const quoteReference = input.quote_reference.trim() || buildQuoteReference(sequence)

  return {
    id: createId(),
    site_visit_id: input.site_visit_id,
    quote_reference: quoteReference,
    customer_full_name: input.customer_full_name.trim(),
    quote_value: cleanMoneyValue(input.quote_value),
    quote_sent_date: input.quote_sent_date,
    status: input.status,
    created_at: now,
    updated_at: now,
  }
}

export async function saveQuote(quote: Quote): Promise<Quote> {
  if (!supabase) {
    return quote
  }

  const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...insertPayload } = quote
  const { data, error } = await supabase.from('quotes').insert(insertPayload).select('*').single()

  if (error) {
    throw new Error(error.message)
  }

  return data as Quote
}

export async function updateQuote(quote: Quote): Promise<Quote> {
  if (!supabase) {
    return quote
  }

  const { id, created_at: _createdAt, updated_at: _updatedAt, ...updatePayload } = quote
  const { data, error } = await supabase.from('quotes').update(updatePayload).eq('id', id).select('*').single()

  if (error) {
    throw new Error(error.message)
  }

  return data as Quote
}

export function createLocalBooking(input: NewBookingInput): Booking {
  const now = new Date().toISOString()

  return {
    id: createId(),
    site_visit_id: input.site_visit_id,
    quote_id: input.quote_id,
    booking_number: input.booking_number.trim(),
    customer_full_name: input.customer_full_name.trim(),
    booking_date: input.booking_date,
    estimated_value: input.estimated_value,
    actual_value: null,
    verification_status: 'Estimated',
    status: 'Won',
    booking_source: input.booking_source,
    notes: cleanText(input.notes),
    created_at: now,
    updated_at: now,
  }
}

export async function saveBooking(booking: Booking): Promise<Booking> {
  if (!supabase) {
    return booking
  }

  const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...insertPayload } = booking
  const { data, error } = await supabase.from('bookings').insert(insertPayload).select('*').single()

  if (error) {
    throw new Error(error.message)
  }

  return data as Booking
}

export async function updateBooking(booking: Booking): Promise<Booking> {
  if (!supabase) {
    return booking
  }

  const { id, created_at: _createdAt, updated_at: _updatedAt, ...updatePayload } = booking
  const { data, error } = await supabase.from('bookings').update(updatePayload).eq('id', id).select('*').single()

  if (error) {
    throw new Error(error.message)
  }

  return data as Booking
}

export function createLocalTask(input: NewTaskInput): Task {
  const now = new Date().toISOString()

  return {
    id: createId(),
    site_visit_id: input.site_visit_id,
    title: input.title.trim(),
    description: cleanText(input.description),
    due_date: input.due_date,
    status: input.status,
    task_type: input.task_type,
    created_at: now,
    updated_at: now,
  }
}

export async function saveTask(task: Task): Promise<Task> {
  if (!supabase) {
    return task
  }

  const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...insertPayload } = task
  const { data, error } = await supabase.from('tasks').insert(insertPayload).select('*').single()

  if (error) {
    throw new Error(error.message)
  }

  return data as Task
}

export async function updateTask(task: Task): Promise<Task> {
  if (!supabase) {
    return task
  }

  const { id, created_at: _createdAt, updated_at: _updatedAt, ...updatePayload } = task
  const { data, error } = await supabase.from('tasks').update(updatePayload).eq('id', id).select('*').single()

  if (error) {
    throw new Error(error.message)
  }

  return data as Task
}

export function createLocalActivityTimelineItem(
  entityType: string,
  entityId: string,
  eventType: string,
  eventLabel: string,
  eventDescription: string | null,
): ActivityTimelineItem {
  return {
    id: createId(),
    entity_type: entityType,
    entity_id: entityId,
    event_type: eventType,
    event_label: eventLabel,
    event_description: eventDescription,
    created_at: new Date().toISOString(),
  }
}
