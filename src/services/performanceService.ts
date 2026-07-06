import { createDemoPerformanceData } from '../data/demoData'
import { hasSupabaseConfig, supabase } from '../lib/supabase'
import type { NewSiteVisitInput, NewTaskInput, PerformanceData, SiteVisit, Task } from '../types/performance'

export type PerformanceDataResult = {
  data: PerformanceData
  source: 'supabase' | 'demo'
  notice: string
}

const emptyData: PerformanceData = {
  siteVisits: [],
  quotes: [],
  bookings: [],
  tasks: [],
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function cleanText(value: string) {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function buildSiteVisitReference(sequence: number) {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `SV-${now.getFullYear()}${month}-${String(sequence).padStart(3, '0')}`
}

export async function loadPerformanceData(): Promise<PerformanceDataResult> {
  if (!hasSupabaseConfig || !supabase) {
    return {
      data: createDemoPerformanceData(),
      source: 'demo',
      notice: 'Supabase env vars are not configured, so demo data is showing.',
    }
  }

  const [siteVisitsResult, quotesResult, bookingsResult, tasksResult] = await Promise.all([
    supabase.from('site_visits').select('*').order('booked_date', { ascending: true }),
    supabase.from('quotes').select('*').order('quote_sent_date', { ascending: false }),
    supabase.from('bookings').select('*').order('booking_date', { ascending: false }),
    supabase.from('tasks').select('*').order('due_date', { ascending: true }),
  ])

  const failedResult = [siteVisitsResult, quotesResult, bookingsResult, tasksResult].find((result) => result.error)

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
    },
    source: 'supabase',
    notice: 'Connected to Supabase.',
  }
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
    estimated_quote_value: input.estimated_quote_value,
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
