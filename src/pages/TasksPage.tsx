import { CheckSquare, ListPlus } from 'lucide-react'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { EmptyState } from '../components/EmptyState'
import { MobileRecordCard } from '../components/MobileRecordCard'
import { StatusPill } from '../components/StatusPill'
import { TaskForm } from '../components/TaskForm'
import type { NewTaskInput, PerformanceData, Task } from '../types/performance'
import { formatDate } from '../utils/kpi'

type TasksPageProps = {
  data: PerformanceData
  onAddTask: (input: NewTaskInput) => void
}

export function TasksPage({ data, onAddTask }: TasksPageProps) {
  const findSiteVisitLabel = (siteVisitId: string | null) => {
    const siteVisit = data.siteVisits.find((record) => record.id === siteVisitId)
    return siteVisit ? `${siteVisit.reference_number} - ${siteVisit.customer_full_name}` : 'None'
  }

  const columns: DataTableColumn<Task>[] = [
    { key: 'title', header: 'Task', render: (task) => task.title },
    { key: 'type', header: 'Type', render: (task) => task.task_type },
    { key: 'due', header: 'Due Date', render: (task) => formatDate(task.due_date) },
    { key: 'siteVisit', header: 'Site Visit', render: (task) => findSiteVisitLabel(task.site_visit_id) },
    { key: 'status', header: 'Status', render: (task) => <StatusPill status={task.status} /> },
  ]

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">Tasks</span>
          <h1>Task Foundation</h1>
          <p>Follow-ups, reports, quotes, booking admin, training, consultancy, and general work.</p>
        </div>
      </header>

      <section className="surface">
        <div className="section-header">
          <div>
            <span className="eyebrow">New task</span>
            <h2>Add Task</h2>
          </div>
        </div>
        <TaskForm siteVisits={data.siteVisits} onSubmit={onAddTask} />
      </section>

      <section className="surface">
        <div className="section-header">
          <div>
            <span className="eyebrow">Records</span>
            <h2>All Tasks</h2>
          </div>
          <span className="record-count">{data.tasks.length}</span>
        </div>

        {data.tasks.length ? (
          <>
            <div className="desktop-table">
              <DataTable columns={columns} records={data.tasks} />
            </div>
            <div className="mobile-record-list">
              {data.tasks.map((task) => (
                <MobileRecordCard
                  key={task.id}
                  title={task.title}
                  subtitle={task.task_type}
                  status={task.status}
                  fields={[
                    { label: 'Due', value: formatDate(task.due_date) },
                    { label: 'Site visit', value: findSiteVisitLabel(task.site_visit_id) },
                  ]}
                />
              ))}
            </div>
          </>
        ) : (
          <EmptyState icon={<CheckSquare size={24} />} title="No tasks yet" message="Add a task to begin tracking follow-up work." />
        )}
      </section>

      <section className="surface manual-booking-placeholder">
        <div>
          <span className="eyebrow">KPI support</span>
          <h2>Training and Consultancy</h2>
          <p>Completed Training and Consultancy tasks feed the monthly KPI cards.</p>
        </div>
        <ListPlus size={24} aria-hidden="true" />
      </section>
    </div>
  )
}
