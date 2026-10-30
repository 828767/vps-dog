import type { ReactNode } from 'react';
import { Spinner } from './Spinner';

export interface Column<T> {
  key: string;
  header: string;
  /** Cell renderer; receives the row and its index. */
  render: (row: T, index: number) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Extra classes applied to both the `th` and `td`. */
  className?: string;
  /** Hide below the `sm` breakpoint (keeps mobile tables readable). */
  hideOnMobile?: boolean;
}

export interface TableProps<T> {
  columns: ReadonlyArray<Column<T>>;
  rows: ReadonlyArray<T>;
  rowKey: (row: T, index: number) => string;
  loading?: boolean;
  loadingLabel?: string;
  empty?: ReactNode;
  /** Rendered below the table, e.g. a count. */
  caption?: ReactNode;
}

const ALIGN: Record<'left' | 'right' | 'center', string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

/** Data table that scrolls horizontally on small screens instead of squashing. */
export function Table<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  loadingLabel = '',
  empty,
  caption,
}: TableProps<T>): ReactNode {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-14 text-muted">
        <Spinner size={20} />
        <span className="text-sm">{loadingLabel}</span>
      </div>
    );
  }

  if (rows.length === 0) return <>{empty}</>;

  return (
    <div className="flex flex-col">
      <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[42rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap text-muted first:pl-0 last:pr-0 ${
                    ALIGN[column.align ?? 'left']
                  } ${column.hideOnMobile === true ? 'hidden md:table-cell' : ''} ${column.className ?? ''}`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={rowKey(row, index)}
                className="border-b border-border/70 transition-colors duration-150 last:border-b-0 hover:bg-surface-2/60"
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-3 py-2.5 align-middle text-text first:pl-0 last:pr-0 ${
                      ALIGN[column.align ?? 'left']
                    } ${column.hideOnMobile === true ? 'hidden md:table-cell' : ''} ${column.className ?? ''}`}
                  >
                    {column.render(row, index)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {caption !== undefined ? (
        <div className="pt-3 text-xs text-muted">{caption}</div>
      ) : null}
    </div>
  );
}
