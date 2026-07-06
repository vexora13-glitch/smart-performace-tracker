import { ClipboardList } from 'lucide-react'
import { useState, type ChangeEvent, type FormEvent } from 'react'
import { buildBookingReference } from '../services/performanceService'
import type { NewBookingInput, Quote, SiteVisit } from '../types/performance'

type ManualBookingFormProps = {
  siteVisits: SiteVisit[]
  quotes: Quote[]
  nextBookingSequence: number
  onSubmit: (input: NewBookingInput) => void
}

type ManualBookingFormState = {
  booking_number: string
  customer_full_name: string
  booking_date: string
  estimated_value: string
  notes: string
  site_visit_id: string
  quote_id: string
}

const formatToday = () => {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const createInitialState = (nextBookingSequence: number): ManualBookingFormState => ({
  booking_number: buildBookingReference(nextBookingSequence),
  customer_full_name: '',
  booking_date: formatToday(),
  estimated_value: '',
  notes: '',
  site_visit_id: '',
  quote_id: '',
})

export function ManualBookingForm({ siteVisits, quotes, nextBookingSequence, onSubmit }: ManualBookingFormProps) {
  const [form, setForm] = useState<ManualBookingFormState>(() => createInitialState(nextBookingSequence))

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = event.target

    if (name === 'quote_id') {
      const quote = quotes.find((record) => record.id === value)
      setForm((current) => ({
        ...current,
        quote_id: value,
        site_visit_id: quote?.site_visit_id ?? current.site_visit_id,
        customer_full_name: quote && !current.customer_full_name ? quote.customer_full_name : current.customer_full_name,
        estimated_value:
          quote?.quote_value !== null && quote?.quote_value !== undefined && !current.estimated_value
            ? String(quote.quote_value)
            : current.estimated_value,
      }))
      return
    }

    if (name === 'site_visit_id') {
      const siteVisit = siteVisits.find((record) => record.id === value)
      setForm((current) => ({
        ...current,
        site_visit_id: value,
        customer_full_name:
          siteVisit && !current.customer_full_name ? siteVisit.customer_full_name : current.customer_full_name,
        estimated_value:
          siteVisit?.estimated_quote_value !== null && siteVisit?.estimated_quote_value !== undefined && !current.estimated_value
            ? String(siteVisit.estimated_quote_value)
            : current.estimated_value,
      }))
      return
    }

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
      site_visit_id: form.site_visit_id || null,
      quote_id: form.quote_id || null,
      booking_source: 'Manual',
    })
    setForm(createInitialState(nextBookingSequence + 1))
  }

  return (
    <form className="form-grid" onSubmit={handleSubmit}>
      <label>
        Booking number
        <input required name="booking_number" value={form.booking_number} onChange={handleChange} />
      </label>
      <label>
        Customer name
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
      <label>
        Linked quote
        <select name="quote_id" value={form.quote_id} onChange={handleChange}>
          <option value="">No quote</option>
          {quotes.map((quote) => (
            <option key={quote.id} value={quote.id}>
              {quote.quote_reference} - {quote.customer_full_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Linked site visit
        <select name="site_visit_id" value={form.site_visit_id} onChange={handleChange}>
          <option value="">No site visit</option>
          {siteVisits.map((siteVisit) => (
            <option key={siteVisit.id} value={siteVisit.id}>
              {siteVisit.reference_number} - {siteVisit.customer_full_name}
            </option>
          ))}
        </select>
      </label>
      <label className="span-2">
        Notes
        <textarea name="notes" value={form.notes} onChange={handleChange} rows={3} />
      </label>
      <button className="primary-button span-2" type="submit">
        <ClipboardList size={18} aria-hidden="true" />
        Add Manual Booking
      </button>
    </form>
  )
}
