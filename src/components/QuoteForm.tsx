import { FilePlus2 } from 'lucide-react'
import { useState, type ChangeEvent, type FormEvent } from 'react'
import { buildBookingReference, buildQuoteReference } from '../services/performanceService'
import { QUOTE_STATUSES, type NewQuoteInput, type QuoteBookingInput, type QuoteStatus, type SiteVisit } from '../types/performance'

type QuoteFormProps = {
  siteVisit: SiteVisit
  nextQuoteSequence: number
  nextBookingSequence: number
  onSubmit: (input: NewQuoteInput, bookingInput: QuoteBookingInput | null) => void
}

type QuoteFormState = {
  quote_reference: string
  customer_full_name: string
  quote_value: string
  quote_sent_date: string
  status: QuoteStatus
  booking_number: string
  booking_date: string
  estimated_value: string
  booking_notes: string
}

const formatToday = () => {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const createInitialState = (
  siteVisit: SiteVisit,
  nextQuoteSequence: number,
  nextBookingSequence: number,
): QuoteFormState => {
  const estimatedValue = siteVisit.estimated_quote_value ? String(siteVisit.estimated_quote_value) : ''

  return {
    quote_reference: buildQuoteReference(nextQuoteSequence),
    customer_full_name: siteVisit.customer_full_name,
    quote_value: estimatedValue,
    quote_sent_date: '',
    status: 'Draft',
    booking_number: buildBookingReference(nextBookingSequence),
    booking_date: formatToday(),
    estimated_value: estimatedValue,
    booking_notes: '',
  }
}

export function QuoteForm({ siteVisit, nextQuoteSequence, nextBookingSequence, onSubmit }: QuoteFormProps) {
  const [form, setForm] = useState<QuoteFormState>(() =>
    createInitialState(siteVisit, nextQuoteSequence, nextBookingSequence),
  )

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = event.target
    setForm((current) => {
      const next = { ...current, [name]: value }

      if (name === 'status' && value !== 'Draft' && !current.quote_sent_date) {
        next.quote_sent_date = formatToday()
      }

      if (name === 'quote_value' && !current.estimated_value) {
        next.estimated_value = value
      }

      return next
    })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const quoteValue = form.quote_value ? Number(form.quote_value) : null
    const estimatedValue = Number(form.estimated_value)
    const needsBooking = form.status === 'Booked'

    if (needsBooking && (!form.booking_number.trim() || !form.booking_date || !Number.isFinite(estimatedValue))) {
      return
    }

    onSubmit(
      {
        site_visit_id: siteVisit.id,
        quote_reference: form.quote_reference,
        customer_full_name: form.customer_full_name,
        quote_value: quoteValue !== null && Number.isFinite(quoteValue) ? quoteValue : null,
        quote_sent_date: form.quote_sent_date || (form.status === 'Draft' ? null : formatToday()),
        status: form.status,
      },
      needsBooking
        ? {
            booking_number: form.booking_number,
            customer_full_name: form.customer_full_name,
            booking_date: form.booking_date,
            estimated_value: estimatedValue,
            notes: form.booking_notes,
          }
        : null,
    )
    setForm(createInitialState(siteVisit, nextQuoteSequence + 1, nextBookingSequence + 1))
  }

  return (
    <form className="form-grid form-grid--compact" onSubmit={handleSubmit}>
      <label>
        Quote reference
        <input required name="quote_reference" value={form.quote_reference} onChange={handleChange} />
      </label>
      <label>
        Customer
        <input required name="customer_full_name" value={form.customer_full_name} onChange={handleChange} />
      </label>
      <label>
        Quote value
        <input
          name="quote_value"
          type="number"
          min="0"
          step="0.01"
          value={form.quote_value}
          onChange={handleChange}
        />
      </label>
      <label>
        Sent date
        <input name="quote_sent_date" type="date" value={form.quote_sent_date} onChange={handleChange} />
      </label>
      <label className="span-2">
        Status
        <select name="status" value={form.status} onChange={handleChange}>
          {QUOTE_STATUSES.map((status) => (
            <option key={status}>{status}</option>
          ))}
        </select>
      </label>

      {form.status === 'Booked' ? (
        <>
          <label>
            Booking number
            <input required name="booking_number" value={form.booking_number} onChange={handleChange} />
          </label>
          <label>
            Booking date
            <input required name="booking_date" type="date" value={form.booking_date} onChange={handleChange} />
          </label>
          <label>
            Estimated value
            <input
              required
              name="estimated_value"
              type="number"
              min="0"
              step="0.01"
              value={form.estimated_value}
              onChange={handleChange}
            />
          </label>
          <label>
            Booking notes
            <input name="booking_notes" value={form.booking_notes} onChange={handleChange} />
          </label>
        </>
      ) : null}

      <button className="primary-button span-2" type="submit">
        <FilePlus2 size={18} aria-hidden="true" />
        Create Quote
      </button>
    </form>
  )
}
