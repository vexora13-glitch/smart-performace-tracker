import { createDemoPerformanceData } from '../data/demoData'
import { hasSupabaseConfig, supabase, supabaseConfigError } from '../lib/supabase'
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
  source: 'supabase' | 'demo' | 'local'
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

const localPerformanceDataKey = 'smart-performance-tracker:performance-data:v1'
const localKpiTargetsKey = 'smart-performance-tracker:kpi-targets:v1'

function getLocalStorage() {
  return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
}

function readLocalJson<T>(key: string): T | null {
  const storage = getLocalStorage()

  if (!storage) {
    return null
  }

  const rawValue = storage.getItem(key)

  if (!rawValue) {
    return null
  }

  try {
    return JSON.parse(rawValue) as T
  } catch {
    return null
  }
}

function writeLocalJson(key: string, value: unknown) {
  const storage = getLocalStorage()

  if (!storage) {
    throw new Error('Browser local storage is not available.')
  }

  storage.setItem(key, JSON.stringify(value))
}

function normalizeLocalPerformanceData(value: unknown): PerformanceData | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Partial<Record<keyof PerformanceData, unknown>>

  return {
    siteVisits: Array.isArray(record.siteVisits) ? (record.siteVisits as SiteVisit[]) : [],
    quotes: Array.isArray(record.quotes) ? (record.quotes as Quote[]) : [],
    bookings: Array.isArray(record.bookings) ? (record.bookings as Booking[]) : [],
    tasks: Array.isArray(record.tasks) ? (record.tasks as Task[]) : [],
    activityTimeline: Array.isArray(record.activityTimeline)
      ? (record.activityTimeline as ActivityTimelineItem[])
      : [],
  }
}

function readLocalPerformanceData() {
  return normalizeLocalPerformanceData(readLocalJson(localPerformanceDataKey))
}

function loadLocalPerformanceData() {
  return readLocalPerformanceData() ?? createDemoPerformanceData()
}

function persistLocalPerformanceData(updater: (current: PerformanceData) => PerformanceData) {
  const nextData = updater(loadLocalPerformanceData())
  writeLocalJson(localPerformanceDataKey, nextData)
  return nextData
}

function saveLocalPerformanceRecord<K extends keyof Pick<PerformanceData, 'siteVisits' | 'quotes' | 'bookings' | 'tasks'>>(
  collectionKey: K,
  record: PerformanceData[K][number],
) {
  persistLocalPerformanceData((current) => ({
    ...current,
    [collectionKey]: [record, ...current[collectionKey]],
  }))

  return record
}

function updateLocalPerformanceRecord<K extends keyof Pick<PerformanceData, 'siteVisits' | 'quotes' | 'bookings' | 'tasks'>>(
  collectionKey: K,
  record: PerformanceData[K][number],
) {
  persistLocalPerformanceData((current) => ({
    ...current,
    [collectionKey]: current[collectionKey].map((currentRecord) =>
      currentRecord.id === record.id ? record : currentRecord,
    ) as PerformanceData[K],
  }))

  return record
}

export async function getActiveSupabaseUserId(): Promise<string | null> {
  if (!hasSupabaseConfig || !supabase) {
    return null
  }

  const { data, error } = await supabase.auth.getSession()

  if (error) {
    throw new Error(error.message)
  }

  return data.session?.user.id ?? null
}

async function requireActiveSupabaseUserId() {
  const userId = await getActiveSupabaseUserId()

  if (!userId) {
    throw new Error('Sign in before saving Supabase data.')
  }

  return userId
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
    const localData = readLocalPerformanceData()
    const configNotice = supabaseConfigError ?? 'Missing Supabase configuration.'

    return {
      data: localData ?? createDemoPerformanceData(),
      source: localData ? 'local' : 'demo',
      notice: localData
        ? `${configNotice} Browser-local development data is showing.`
        : `${configNotice} Demo data is showing. New changes will persist in this browser.`,
    }
  }

  const ownerUserId = await getActiveSupabaseUserId()

  if (!ownerUserId) {
    return {
      data: emptyData,
      source: 'supabase',
      notice: 'Supabase is configured. Sign in to load saved performance data.',
    }
  }

  const [siteVisitsResult, quotesResult, bookingsResult, tasksResult, activityTimelineResult] = await Promise.all([
    supabase.from('site_visits').select('*').eq('owner_user_id', ownerUserId).order('booked_date', { ascending: true }),
    supabase.from('quotes').select('*').eq('owner_user_id', ownerUserId).order('quote_sent_date', { ascending: false }),
    supabase.from('bookings').select('*').eq('owner_user_id', ownerUserId).order('booking_date', { ascending: false }),
    supabase.from('tasks').select('*').eq('owner_user_id', ownerUserId).order('due_date', { ascending: true }),
    supabase
      .from('activity_timeline')
      .select('*')
      .eq('owner_user_id', ownerUserId)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const failedResult = [siteVisitsResult, quotesResult, bookingsResult, tasksResult, activityTimelineResult].find(
    (result) => result.error,
  )

  if (failedResult?.error) {
    return {
      data: emptyData,
      source: 'supabase',
      notice: `Supabase request failed. Saved data was not replaced with demo data: ${failedResult.error.message}`,
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
    const localTargets = readLocalJson<KpiTarget[]>(localKpiTargetsKey)

    return {
      targets: localTargets ? mergeKpiTargets(localTargets) : defaults,
      notice: '',
    }
  }

  const ownerUserId = await getActiveSupabaseUserId()

  if (!ownerUserId) {
    return {
      targets: defaults,
      notice: '',
    }
  }

  const { data, error } = await supabase
    .from('kpi_targets')
    .select('*')
    .eq('owner_user_id', ownerUserId)
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
  if (!hasSupabaseConfig || !supabase) {
    const savedTargets = mergeKpiTargets(targets)
    writeLocalJson(localKpiTargetsKey, savedTargets)
    return savedTargets
  }

  const ownerUserId = await requireActiveSupabaseUserId()

  if (!supabase) {
    return targets
  }

  const payload = targets.map(
    ({ id: _id, created_at: _createdAt, updated_at: _updatedAt, owner_user_id: _ownerUserId, ...target }) => ({
      ...target,
      owner_user_id: ownerUserId,
    }),
  )
  const { data, error } = await supabase
    .from('kpi_targets')
    .upsert(payload, { onConflict: 'owner_user_id,kpi_key,period_type' })
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
    owner_user_id: null,
    job_id: cleanText(input.job_id),
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
  if (!hasSupabaseConfig || !supabase) {
    return saveLocalPerformanceRecord('siteVisits', siteVisit) as SiteVisit
  }

  const ownerUserId = await requireActiveSupabaseUserId()
  const { id: _id, created_at: _createdAt, updated_at: _updatedAt, owner_user_id: _ownerUserId, ...insertPayload } = siteVisit
  const { data, error } = await supabase
    .from('site_visits')
    .insert({ ...insertPayload, owner_user_id: ownerUserId })
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data as SiteVisit
}

export async function updateSiteVisit(siteVisit: SiteVisit): Promise<SiteVisit> {
  if (!hasSupabaseConfig || !supabase) {
    return updateLocalPerformanceRecord('siteVisits', siteVisit) as SiteVisit
  }

  const ownerUserId = await requireActiveSupabaseUserId()
  const { id, created_at: _createdAt, updated_at: _updatedAt, owner_user_id: _ownerUserId, ...updatePayload } = siteVisit
  const { data, error } = await supabase
    .from('site_visits')
    .update({ ...updatePayload, owner_user_id: ownerUserId })
    .eq('id', id)
    .eq('owner_user_id', ownerUserId)
    .select('*')
    .single()

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
    owner_user_id: null,
    quote_value: cleanMoneyValue(input.quote_value),
    quote_sent_date: input.quote_sent_date,
    status: input.status,
    created_at: now,
    updated_at: now,
  }
}

export async function saveQuote(quote: Quote): Promise<Quote> {
  if (!hasSupabaseConfig || !supabase) {
    return saveLocalPerformanceRecord('quotes', quote) as Quote
  }

  const ownerUserId = await requireActiveSupabaseUserId()
  const { id: _id, created_at: _createdAt, updated_at: _updatedAt, owner_user_id: _ownerUserId, ...insertPayload } = quote
  const { data, error } = await supabase
    .from('quotes')
    .insert({ ...insertPayload, owner_user_id: ownerUserId })
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data as Quote
}

export async function updateQuote(quote: Quote): Promise<Quote> {
  if (!hasSupabaseConfig || !supabase) {
    return updateLocalPerformanceRecord('quotes', quote) as Quote
  }

  const ownerUserId = await requireActiveSupabaseUserId()
  const { id, created_at: _createdAt, updated_at: _updatedAt, owner_user_id: _ownerUserId, ...updatePayload } = quote
  const { data, error } = await supabase
    .from('quotes')
    .update({ ...updatePayload, owner_user_id: ownerUserId })
    .eq('id', id)
    .eq('owner_user_id', ownerUserId)
    .select('*')
    .single()

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
    owner_user_id: null,
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
  if (!hasSupabaseConfig || !supabase) {
    return saveLocalPerformanceRecord('bookings', booking) as Booking
  }

  const ownerUserId = await requireActiveSupabaseUserId()
  const { id: _id, created_at: _createdAt, updated_at: _updatedAt, owner_user_id: _ownerUserId, ...insertPayload } = booking
  const { data, error } = await supabase
    .from('bookings')
    .insert({ ...insertPayload, owner_user_id: ownerUserId })
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data as Booking
}

export async function updateBooking(booking: Booking): Promise<Booking> {
  if (!hasSupabaseConfig || !supabase) {
    return updateLocalPerformanceRecord('bookings', booking) as Booking
  }

  const ownerUserId = await requireActiveSupabaseUserId()
  const { id, created_at: _createdAt, updated_at: _updatedAt, owner_user_id: _ownerUserId, ...updatePayload } = booking
  const { data, error } = await supabase
    .from('bookings')
    .update({ ...updatePayload, owner_user_id: ownerUserId })
    .eq('id', id)
    .eq('owner_user_id', ownerUserId)
    .select('*')
    .single()

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
    owner_user_id: null,
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
  if (!hasSupabaseConfig || !supabase) {
    return saveLocalPerformanceRecord('tasks', task) as Task
  }

  const ownerUserId = await requireActiveSupabaseUserId()
  const { id: _id, created_at: _createdAt, updated_at: _updatedAt, owner_user_id: _ownerUserId, ...insertPayload } = task
  const { data, error } = await supabase
    .from('tasks')
    .insert({ ...insertPayload, owner_user_id: ownerUserId })
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data as Task
}

export async function updateTask(task: Task): Promise<Task> {
  if (!hasSupabaseConfig || !supabase) {
    return updateLocalPerformanceRecord('tasks', task) as Task
  }

  const ownerUserId = await requireActiveSupabaseUserId()
  const { id, created_at: _createdAt, updated_at: _updatedAt, owner_user_id: _ownerUserId, ...updatePayload } = task
  const { data, error } = await supabase
    .from('tasks')
    .update({ ...updatePayload, owner_user_id: ownerUserId })
    .eq('id', id)
    .eq('owner_user_id', ownerUserId)
    .select('*')
    .single()

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
    owner_user_id: null,
    entity_type: entityType,
    entity_id: entityId,
    event_type: eventType,
    event_label: eventLabel,
    event_description: eventDescription,
    created_at: new Date().toISOString(),
  }
}
