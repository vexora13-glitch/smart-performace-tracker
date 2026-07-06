import { CalendarCheck } from 'lucide-react'
import { useState, type ChangeEvent, type FormEvent } from 'react'
import { buildBookingReference } from '../services/performanceService'
import type { Booking, Quote, QuoteBookingInput, SiteVisit } from '../types/performance'

type BookingCompletionFormProps = {
  quote: Quote
  siteVisit: SiteVisit | null
  existingBooking: Booking | null
  nextBookingSequence: number
  onCancel: () => void
  onSubmit: (input: QuoteBookingInput) => void
}

type BookingCompletionFormState = {
  booking_number: string
  customer_full_name: string
  booking_date: string
  estimated_value: string
  notes: string
}

const formatToday = () => {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const createInitialState = (
  quote: Quote,
  siteVisit: SiteVisit | null,
  existingBooking: Booking | null,
  nextBookingSequence: number,
): BookingCompletionFormState => ({
  booking_number: existingBooking?.booking_number ?? buildBookingReference(nextBookingSequence),
  customer_full_name: existingBooking?.customer_full_name ?? quote.customer_full_name,
  booking_date: existingBooking?.booking_date ?? formatToday(),
  estimated_value: String(existingBooking?.estimated_value ?? quote.quote_value ?? siteVisit?.estimated_quote_value ?? ''),
  notes: existingBooking?.notes ?? '',
})

export function BookingCompletionForm({
  quote,
  siteVisit,
  existingBooking,
  nextBookingSequence,
  onCancel,
  onSubmit,
}: BookingCompletionFormProps) {
  const [form, setForm] = useState<BookingCompletionFormState>(() =>
    createInitialState(quote, siteVisit, existingBooking, nextBookingSequence),
  )

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const estimatedValue = Number(form.estimated_value)

    if (!form.booking_number.trim() || !form.customer_full_name.trim() || !form.booking_date || !Number.isFinite(estimatedValue)) {
      return
    }

    onSubmit({
      booking_number: form.booking_number,
      customer_full_name: form.customer_full_name,
      booking_date: form.booking_date,
      estimated_value: estimatedValue,
      notes: form.notes,
    })
  }

  return (
    <form className="form-grid form-grid--compact inline-workflow-form" onSubmit={handleSubmit}>
      <label>
        Booking number
        <input required name="booking_number" value={form.booking_number} onChange={handleChange} />
      </label>
      <label>
        Customer
        <input required name="customer_full_name" value={form.customer_full_name} onChange={handleChange} />
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
      <label className="span-2">
        Notes
        <input name="notes" value={form.notes} onChange={handleChange} />
      </label>
      <div className="form-actions span-2">
        <button className="secondary-button" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary-button" type="submit">
          <CalendarCheck size={18} aria-hidden="true" />
          Create Booking
        </button>
      </div>
    </form>
  )
}
