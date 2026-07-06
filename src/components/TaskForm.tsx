import { ListPlus } from 'lucide-react'
import { useState, type ChangeEvent, type FormEvent } from 'react'
import { TASK_STATUSES, TASK_TYPES, type NewTaskInput, type SiteVisit } from '../types/performance'

type TaskFormProps = {
  siteVisits: SiteVisit[]
  onSubmit: (input: NewTaskInput) => void
}

type TaskFormState = Omit<NewTaskInput, 'due_date'> & {
  due_date: string
}

const formatToday = () => {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const initialState = (): TaskFormState => ({
  site_visit_id: null,
  title: '',
  description: '',
  due_date: formatToday(),
  status: 'To Do',
  task_type: 'General',
})

export function TaskForm({ siteVisits, onSubmit }: TaskFormProps) {
  const [form, setForm] = useState<TaskFormState>(initialState)

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = event.target
    setForm((current) => ({
      ...current,
      [name]: name === 'site_visit_id' && value === '' ? null : value,
    }))
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit({
      ...form,
      due_date: form.due_date || null,
    })
    setForm(initialState())
  }

  return (
    <form className="form-grid" onSubmit={handleSubmit}>
      <label className="span-2">
        Task title
        <input required name="title" value={form.title} onChange={handleChange} placeholder="Task title" />
      </label>
      <label>
        Type
        <select name="task_type" value={form.task_type} onChange={handleChange}>
          {TASK_TYPES.map((taskType) => (
            <option key={taskType}>{taskType}</option>
          ))}
        </select>
      </label>
      <label>
        Status
        <select name="status" value={form.status} onChange={handleChange}>
          {TASK_STATUSES.map((status) => (
            <option key={status}>{status}</option>
          ))}
        </select>
      </label>
      <label>
        Due date
        <input name="due_date" type="date" value={form.due_date} onChange={handleChange} />
      </label>
      <label>
        Site visit
        <select name="site_visit_id" value={form.site_visit_id ?? ''} onChange={handleChange}>
          <option value="">No site visit</option>
          {siteVisits.map((siteVisit) => (
            <option key={siteVisit.id} value={siteVisit.id}>
              {siteVisit.reference_number} - {siteVisit.customer_full_name}
            </option>
          ))}
        </select>
      </label>
      <label className="span-2">
        Description
        <textarea name="description" value={form.description} onChange={handleChange} rows={3} placeholder="Optional" />
      </label>
      <button className="primary-button span-2" type="submit">
        <ListPlus size={18} aria-hidden="true" />
        Add Task
      </button>
    </form>
  )
}
