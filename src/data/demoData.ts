import type { ActivityTimelineItem, Booking, PerformanceData, Quote, SiteVisit, Task } from '../types/performance'

const formatDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const dateWithOffset = (offsetDays: number) => {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return formatDate(date)
}

const nowIso = () => new Date().toISOString()

export function createDemoPerformanceData(): PerformanceData {
  const createdAt = nowIso()

  const siteVisits: SiteVisit[] = [
    {
      id: 'demo-site-visit-1',
      reference_number: 'SV-DEMO-001',
      customer_full_name: 'Mia Thompson',
      contact_person: 'Mia Thompson',
      contact_number: '021 555 010',
      email: 'mia@example.com',
      address: '14 Hinemoa Street',
      suburb: 'Birkenhead',
      booked_date: dateWithOffset(1),
      booked_time: '09:30',
      move_type: 'Residential move',
      notes: 'Two-bedroom apartment, lift access.',
      status: 'Booked',
      estimated_quote_value: 1450,
      created_at: createdAt,
      updated_at: createdAt,
    },
    {
      id: 'demo-site-visit-2',
      reference_number: 'SV-DEMO-002',
      customer_full_name: 'Arjun Patel',
      contact_person: 'Arjun Patel',
      contact_number: '022 555 017',
      email: 'arjun@example.com',
      address: '8 Manukau Road',
      suburb: 'Epsom',
      booked_date: dateWithOffset(-2),
      booked_time: '13:00',
      move_type: 'Office move',
      notes: 'Needs report before quote.',
      status: 'Report Sent',
      estimated_quote_value: 3800,
      created_at: createdAt,
      updated_at: createdAt,
    },
    {
      id: 'demo-site-visit-3',
      reference_number: 'SV-DEMO-003',
      customer_full_name: 'Hannah Lee',
      contact_person: 'Hannah Lee',
      contact_number: '027 555 018',
      email: 'hannah@example.com',
      address: '52 Lake Road',
      suburb: 'Takapuna',
      booked_date: dateWithOffset(-5),
      booked_time: '10:15',
      move_type: 'Residential move',
      notes: 'Quote sent and awaiting booking.',
      status: 'Quote Sent',
      estimated_quote_value: 2200,
      created_at: createdAt,
      updated_at: createdAt,
    },
  ]

  const quotes: Quote[] = [
    {
      id: 'demo-quote-1',
      site_visit_id: 'demo-site-visit-2',
      quote_reference: 'Q-DEMO-001',
      customer_full_name: 'Arjun Patel',
      quote_value: 3800,
      quote_sent_date: dateWithOffset(-1),
      status: 'Sent',
      created_at: createdAt,
      updated_at: createdAt,
    },
    {
      id: 'demo-quote-2',
      site_visit_id: 'demo-site-visit-3',
      quote_reference: 'Q-DEMO-002',
      customer_full_name: 'Hannah Lee',
      quote_value: 2200,
      quote_sent_date: dateWithOffset(-4),
      status: 'Follow Up',
      created_at: createdAt,
      updated_at: createdAt,
    },
  ]

  const bookings: Booking[] = [
    {
      id: 'demo-booking-1',
      site_visit_id: 'demo-site-visit-2',
      quote_id: 'demo-quote-1',
      booking_number: 'B-DEMO-001',
      customer_full_name: 'Arjun Patel',
      booking_date: dateWithOffset(4),
      estimated_value: 3800,
      actual_value: null,
      verification_status: 'Estimated',
      status: 'Won',
      booking_source: 'Quote',
      notes: 'Manual verification pending.',
      created_at: createdAt,
      updated_at: createdAt,
    },
    {
      id: 'demo-booking-2',
      site_visit_id: 'demo-site-visit-3',
      quote_id: 'demo-quote-2',
      booking_number: 'B-DEMO-002',
      customer_full_name: 'Hannah Lee',
      booking_date: dateWithOffset(-1),
      estimated_value: 2200,
      actual_value: 2300,
      verification_status: 'Verified',
      status: 'Won',
      booking_source: 'Quote',
      notes: 'Verified manually for Prompt 1 sample data.',
      created_at: createdAt,
      updated_at: createdAt,
    },
    {
      id: 'demo-booking-3',
      site_visit_id: null,
      quote_id: null,
      booking_number: 'B-DEMO-003',
      customer_full_name: 'Manual Booking Sample',
      booking_date: dateWithOffset(2),
      estimated_value: 1650,
      actual_value: null,
      verification_status: 'Estimated',
      status: 'Won',
      booking_source: 'Manual',
      notes: 'Created without a site visit or quote.',
      created_at: createdAt,
      updated_at: createdAt,
    },
  ]

  const tasks: Task[] = [
    {
      id: 'demo-task-1',
      site_visit_id: 'demo-site-visit-2',
      title: 'Send report notes to Arjun',
      description: 'Attach site access notes and inventory summary.',
      due_date: dateWithOffset(0),
      status: 'In Progress',
      task_type: 'Report',
      created_at: createdAt,
      updated_at: createdAt,
    },
    {
      id: 'demo-task-2',
      site_visit_id: null,
      title: 'Crew packing training',
      description: 'Monthly internal training session.',
      due_date: dateWithOffset(-3),
      status: 'Completed',
      task_type: 'Training',
      created_at: createdAt,
      updated_at: createdAt,
    },
    {
      id: 'demo-task-3',
      site_visit_id: null,
      title: 'Storage process consultation',
      description: 'Consultancy meeting with commercial lead.',
      due_date: dateWithOffset(-6),
      status: 'Completed',
      task_type: 'Consultancy',
      created_at: createdAt,
      updated_at: createdAt,
    },
  ]

  const activityTimeline: ActivityTimelineItem[] = [
    {
      id: 'demo-activity-1',
      entity_type: 'site_visits',
      entity_id: 'demo-site-visit-3',
      event_type: 'status_changed',
      event_label: 'Site visit status changed',
      event_description: 'Hannah Lee moved to Quote Sent.',
      created_at: createdAt,
    },
    {
      id: 'demo-activity-2',
      entity_type: 'bookings',
      entity_id: 'demo-booking-3',
      event_type: 'created',
      event_label: 'Manual booking created',
      event_description: 'Manual Booking Sample',
      created_at: createdAt,
    },
    {
      id: 'demo-activity-3',
      entity_type: 'tasks',
      entity_id: 'demo-task-2',
      event_type: 'completed',
      event_label: 'Task completed',
      event_description: 'Crew packing training',
      created_at: createdAt,
    },
  ]

  return { siteVisits, quotes, bookings, tasks, activityTimeline }
}
