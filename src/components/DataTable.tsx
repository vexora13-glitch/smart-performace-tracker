import type { KeyboardEvent, ReactNode } from 'react'

export type DataTableColumn<T> = {
  key: string
  header: string
  render: (record: T) => ReactNode
  align?: 'left' | 'right'
  className?: string
}

type DataTableProps<T extends { id: string }> = {
  columns: DataTableColumn<T>[]
  records: T[]
  onRowClick?: (record: T) => void
  getRowLabel?: (record: T) => string
}

export function DataTable<T extends { id: string }>({
  columns,
  records,
  onRowClick,
  getRowLabel,
}: DataTableProps<T>) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, record: T) => {
    if (!onRowClick) {
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onRowClick(record)
    }
  }

  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.align === 'right' ? 'align-right' : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr
              key={record.id}
              className={onRowClick ? 'data-table__row--clickable' : undefined}
              role={onRowClick ? 'button' : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              aria-label={getRowLabel?.(record)}
              onClick={() => onRowClick?.(record)}
              onKeyDown={(event) => handleKeyDown(event, record)}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={[
                    column.align === 'right' ? 'align-right' : '',
                    column.className ?? '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {column.render(record)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
