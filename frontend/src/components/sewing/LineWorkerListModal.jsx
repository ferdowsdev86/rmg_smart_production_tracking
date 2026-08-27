import { X, Users } from "lucide-react";

function WorkerTable({ workers, emptyMessage }) {
  if (!workers?.length) {
    return <p className="py-10 text-center text-sm text-slate-500">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-600">
            <th className="px-3 py-2.5">Employee</th>
            <th className="px-3 py-2.5">ID</th>
            <th className="px-3 py-2.5">Floor</th>
            <th className="px-3 py-2.5">Line</th>
            <th className="px-3 py-2.5">Process</th>
            <th className="px-3 py-2.5">Workstation</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {workers.map((row, index) => {
            const multi = Boolean(row.multi_employee_station);
            const rowKey = `${row.line_label}-${row.workstation_code}-${row.employee_id}-${index}`;
            return (
              <tr
                key={rowKey}
                className={multi ? "bg-amber-50/80" : "bg-white"}
                title={multi ? "Multiple employees worked at this workstation" : undefined}
              >
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{row.employee_name || "—"}</span>
                    {multi ? (
                      <span className="shrink-0 rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-900">
                        Shared WS
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-slate-700">{row.employee_id || "—"}</td>
                <td className="px-3 py-2.5 text-slate-700">{row.floor_label || "—"}</td>
                <td className="px-3 py-2.5 text-slate-700">{row.line_label || "—"}</td>
                <td className="px-3 py-2.5 text-slate-700">{row.process_name || "—"}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-slate-800">
                  {row.workstation_code || row.workstation_id || "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function LineWorkerListModal({ open, title, subtitle, workers, onClose }) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="line-worker-modal-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 shrink-0 text-blue-600" aria-hidden />
              <h2 id="line-worker-modal-title" className="text-lg font-semibold text-slate-900">
                {title}
              </h2>
            </div>
            {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
            <p className="mt-1 text-xs text-amber-700">
              Rows highlighted in amber: more than one employee at the same workstation.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <WorkerTable workers={workers} emptyMessage="No employees in this list." />
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
          <span className="text-sm text-slate-600">{workers?.length ?? 0} employee(s)</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
