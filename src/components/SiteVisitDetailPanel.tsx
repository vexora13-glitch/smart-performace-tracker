import { CalendarCheck, Mail, Phone, Plus } from 'lucide-react'
import { useMemo, useState, type ChangeEvent } from 'react'
import {
  SITE_VISIT_STATUSES,
  TASK_STATUSES,
  type ActivityTimelineItem,
  type Booking,
  type NewQuoteInput,
  type NewTaskInput,
  type Quote,
  type QuoteBookingInput,
  type QuoteStatus,
  type SiteVisit,
  type SiteVisitStatus,
  type Task,
  type TaskStatus,
} from '../types/performance'
import { formatCurrency, formatDate, getBookingVariance } from '../utils/kpi'
import { BookingCompletionForm } from './BookingCompletionForm'
import { QuoteForm } from './QuoteForm'
import { StatusPill } from './StatusPill'
import { TaskForm } from './TaskForm'

type SiteVisitDetailPanelProps = {
  siteVisit: SiteVisit
  allSiteVisits: SiteVisit[]
  linkedTasks: Task[]
  linkedQuotes: Quote[]
  linkedBookings: Booking[]
  activityItems: ActivityTimelineItem[]
  nextQuoteSequence: number
  nextBookingSequence: number
  onUpdateStatus: (siteVisit: SiteVisit, status: SiteVisitStatus) => void
  onAddTask: (input: NewTaskInput) => void
  onUpdateTaskStatus: (task: Task, status: TaskStatus) => void
  onCreateQuote: (input: NewQuoteInput, bookingInput: QuoteBookingInput | null) => void
  onUpdateQuoteStatus: (quote: Quote, status: QuoteStatus) => void
  onBookQuote: (quote: Quote, bookingInput: QuoteBookingInput) => void
}

const formatTime = (value: string) => value.slice(0, 5)

const formatActivityDate = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

function formatBookingVariance(booking: Booking) {
  const variance = getBookingVariance(booking)

  if (variance === null) {
    return '-'
  }

  const prefix = variance > 0 ? '+' : ''
  return `${prefix}${formatCurrency(variance)}`
}

export function SiteVisitDetailPanel({
  siteVisit,
  allSiteVisits,
  linkedTasks,
  linkedQuotes,
  linkedBookings,
  activityItems,
  nextQuoteSequence,
  nextBookingSequence,
  onUpdateStatus,
  onAddTask,
  onUpdateTaskStatus,
  onCreateQuote,
  onUpdateQuoteStatus,
  onBookQuote,
}: SiteVisitDetailPanelProps) {
  const [showQuoteForm, setShowQuoteForm] = useState(false)
  const [bookingQuoteId, setBookingQuoteId] = useState<string | null>(null)
  const hasLinkedQuotes = linkedQuotes.length > 0
  const relatedEntityIds = useMemo(
    () =>
      new Set([
        siteVisit.id,
        ...linkedTasks.map((task) => task.id),
        ...linkedQuotes.map((quote) => quote.id),
        ...linkedBookings.map((booking) => booking.id),
      ]),
    [linkedBookings, linkedQuotes, linkedTasks, siteVisit.id],
  )
  const relatedActivityItems = useMemo(
    () => activityItems.filter((item) => relatedEntityIds.has(item.entity_id)).slice(0, 8),
    [activityItems, relatedEntityIds],
  )

  const handleSiteVisitStatusChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const status = event.target.value as SiteVisitStatus

    if (status !== siteVisit.status) {
      onUpdateStatus(siteVisit, status)
    }
  }

  const handleTaskStatusChange = (task: Task, status: TaskStatus) => {
    if (status !== task.status) {
      onUpdateTaskStatus(task, status)
    }
  }

  const handleQuoteStatusChange = (quote: Quote, status: QuoteStatus) => {
    if (status === quote.status) {
      return
    }

    if (status === 'Booked') {
      setBookingQuoteId(quote.id)
      return
    }

    onUpdateQuoteStatus(quote, status)
  }

  const handleBookQuote = (quote: Quote, bookingInput: QuoteBookingInput) => {
    onBookQuote(quote, bookingInput)
    setBookingQuoteId(null)
  }

  return (
    <aside className="detail-panel" aria-label="Site visit details">
      <div className="detail-panel__header">
        <div>
          <span className="eyebrow">{siteVisit.reference_number}</span>
          <h2>{siteVisit.customer_full_name}</h2>
        </div>
        <StatusPill status={siteVisit.status} />
      </div>

      <div className="sticky-action-area">
        <label>
          Status
          <select className="compact-select" value={siteVisit.status} onChange={handleSiteVisitStatusChange}>
            {SITE_VISIT_STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
      </div>

      <dl className="detail-list detail-list--two-column">
        <div>
          <dt>Reference</dt>
          <dd>{siteVisit.reference_number}</dd>
        </div>
        <div>
          <dt>Customer</dt>
          <dd>{siteVisit.customer_full_name}</dd>
        </div>
        <div>
          <dt>Contact person</dt>
          <dd>{siteVisit.contact_person ?? siteVisit.customer_full_name}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>
            <a className="inline-link" href={`tel:${siteVisit.contact_number}`}>
              <Phone size={15} aria-hidden="true" />
              {siteVisit.contact_number}
            </a>
          </dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>
            {siteVisit.email ? (
              <a className="inline-link" href={`mailto:${siteVisit.email}`}>
                <Mail size={15} aria-hidden="true" />
                {siteVisit.email}
              </a>
            ) : (
              'Not set'
            )}
          </dd>
        </div>
        <div>
          <dt>Suburb</dt>
          <dd>{siteVisit.suburb}</dd>
        </div>
        <div className="span-2">
          <dt>Full address</dt>
          <dd>{siteVisit.address ? `${siteVisit.address}, ${siteVisit.suburb}` : siteVisit.suburb}</dd>
        </div>
        <div>
          <dt>Booked date</dt>
          <dd>{formatDate(siteVisit.booked_date)}</dd>
        </div>
        <div>
          <dt>Booked time</dt>
          <dd>{formatTime(siteVisit.booked_time)}</dd>
        </div>
        <div>
          <dt>Move type</dt>
          <dd>{siteVisit.move_type ?? 'Not set'}</dd>
        </div>
        <div>
          <dt>Estimated quote</dt>
          <dd>{siteVisit.estimated_quote_value ? formatCurrency(siteVisit.estimated_quote_value) : 'Not set'}</dd>
        </div>
        <div className="span-2">
          <dt>Notes</dt>
          <dd>{siteVisit.notes ?? 'No notes yet'}</dd>
        </div>
      </dl>

      <section className="detail-section">
        <div className="section-header section-header--compact">
          <div>
            <span className="eyebrow">Quote</span>
            <h3>Linked Quote</h3>
          </div>
          {hasLinkedQuotes ? (
            <button className="secondary-button" type="button" onClick={() => setShowQuoteForm((current) => !current)}>
              <Plus size={16} aria-hidden="true" />
              Add Quote
            </button>
          ) : null}
        </div>

        {linkedQuotes.map((quote) => {
          const existingBooking = linkedBookings.find((booking) => booking.quote_id === quote.id) ?? null

          return (
            <article className="record-card" key={quote.id}>
              <div className="record-card__topline">
                <div>
                  <strong>{quote.quote_reference}</strong>
                  <span>{quote.quote_value ? formatCurrency(quote.quote_value) : 'No value set'}</span>
                </div>
                <StatusPill status={quote.status} />
              </div>
              <label>
                Quote status
                <select
                  className="compact-select"
                  value={quote.status}
                  onChange={(event) => handleQuoteStatusChange(quote, event.target.value as QuoteStatus)}
                >
                  <option>Draft</option>
                  <option>Sent</option>
                  <option>Follow Up</option>
                  <option>Booked</option>
                  <option>Lost</option>
                </select>
              </label>
              {bookingQuoteId === quote.id ? (
                <BookingCompletionForm
                  quote={quote}
                  siteVisit={siteVisit}
                  existingBooking={existingBooking}
                  nextBookingSequence={nextBookingSequence}
                  onCancel={() => setBookingQuoteId(null)}
                  onSubmit={(bookingInput) => handleBookQuote(quote, bookingInput)}
                />
              ) : null}
            </article>
          )
        })}

        {!hasLinkedQuotes || showQuoteForm ? (
          <QuoteForm
            key={`${siteVisit.id}-${nextQuoteSequence}`}
            siteVisit={siteVisit}
            nextQuoteSequence={nextQuoteSequence}
            nextBookingSequence={nextBookingSequence}
            onSubmit={onCreateQuote}
          />
        ) : null}
      </section>

      <section className="detail-section">
        <div className="section-header section-header--compact">
          <div>
            <span className="eyebrow">Booking</span>
            <h3>Linked Booking</h3>
          </div>
          <CalendarCheck size={20} aria-hidden="true" />
        </div>

        {linkedBookings.length ? (
          <div className="record-card-list">
            {linkedBookings.map((booking) => (
              <article className="record-card" key={booking.id}>
                <div className="record-card__topline">
                  <div>
                    <strong>{booking.booking_number}</strong>
                    <span>{booking.booking_source === 'Manual' ? 'Manual Booking' : 'Workflow Booking'}</span>
                  </div>
                  <StatusPill status={booking.verification_status} />
                </div>
                <dl className="mini-detail-list">
                  <div>
                    <dt>Date</dt>
                    <dd>{formatDate(booking.booking_date)}</dd>
                  </div>
                  <div>
                    <dt>Estimated value</dt>
                    <dd>{formatCurrency(booking.estimated_value)}</dd>
                  </div>
                  <div>
                    <dt>Actual value</dt>
                    <dd>{booking.actual_value === null ? '-' : formatCurrency(booking.actual_value)}</dd>
                  </div>
                  <div>
                    <dt>Variance</dt>
                    <dd>{formatBookingVariance(booking)}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <StatusPill status={booking.status} />
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted-copy">No linked booking.</p>
        )}
      </section>

      <section className="detail-section">
        <div className="section-header section-header--compact">
          <div>
            <span className="eyebrow">Tasks</span>
            <h3>Linked Tasks</h3>
          </div>
          <span className="record-count">{linkedTasks.length}</span>
        </div>

        {linkedTasks.length ? (
          <div className="record-card-list">
            {linkedTasks.map((task) => (
              <article className="record-card" key={task.id}>
                <div className="record-card__topline">
                  <div>
                    <strong>{task.title}</strong>
                    <span>{task.task_type}</span>
                  </div>
                  <StatusPill status={task.status} />
                </div>
                <label>
                  Task status
                  <select
                    className="compact-select"
                    value={task.status}
                    onChange={(event) => handleTaskStatusChange(task, event.target.value as TaskStatus)}
                  >
                    {TASK_STATUSES.map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                </label>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted-copy">No linked tasks.</p>
        )}

        <TaskForm
          key={siteVisit.id}
          siteVisits={allSiteVisits}
          defaultSiteVisitId={siteVisit.id}
          lockSiteVisit
          submitLabel="Add Linked Task"
          onSubmit={onAddTask}
        />
      </section>

      <section className="detail-section">
        <div className="section-header section-header--compact">
          <div>
            <span className="eyebrow">Activity</span>
            <h3>Recent Activity</h3>
          </div>
        </div>

        {relatedActivityItems.length ? (
          <ol className="activity-list">
            {relatedActivityItems.map((item) => (
              <li key={item.id}>
                <strong>{item.event_label}</strong>
                <span>{item.event_description ?? item.event_type}</span>
                <time>{formatActivityDate(item.created_at)}</time>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted-copy">No activity yet.</p>
        )}
      </section>
    </aside>
  )
}
