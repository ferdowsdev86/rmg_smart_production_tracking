import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeCanvas } from "qrcode.react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  Eye,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import api from "../lib/api";
import { useAuthStore } from "../store/useAuthStore";

function qrValue(row) {
  return `${row.machin_name} ${row.brand} ${row.model_no}, id:${row.id}`;
}

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value) {
  if (!value || String(value).startsWith("0000")) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

const EMPTY_FORM = {
  machin_no: "",
  machin_name: "",
  brand: "",
  model_no: "",
  floor: "",
  line: "",
  unit: "",
  owner: 1,
  is_active: 1,
  movement_date: "",
  supplier_name: "",
};

function toDatetimeLocal(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const FILTER_KEYS = [
  "machin_no",
  "machin_name",
  "brand",
  "model_no",
  "floor",
  "line_no",
  "unit_label",
  "ownership_label",
  "status_label",
  "supplier_name",
  "movement_date",
];

function SortIcon({ active, dir }) {
  if (!active) return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />;
  return dir === "asc" ? (
    <ArrowUp className="h-3.5 w-3.5 text-primary" />
  ) : (
    <ArrowDown className="h-3.5 w-3.5 text-primary" />
  );
}

function MachineViewModal({ machine, onClose }) {
  if (!machine) return null;

  const fields = [
    ["Machine No", machine.machin_no],
    ["Machine Name", machine.machin_name],
    ["Brand", machine.brand || "—"],
    ["Model No", machine.model_no || "—"],
    ["Floor", machine.floor ?? "—"],
    ["Line", machine.line_no || machine.line || "—"],
    ["Unit", machine.unit_label || "—"],
    ["Ownership", machine.ownership_label || "—"],
    ["Status", machine.status_label || "—"],
    ["Supplier", machine.supplier_name || "—"],
    ["Install Date", formatDate(machine.install_date)],
    ["Movement Date", formatDateTime(machine.movement_date)],
    ["Created At", formatDateTime(machine.created_at)],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Machine details</h2>
            <p className="text-xs text-slate-500">
              #{machine.machin_no} · {machine.machin_name}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <dl className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2">
          {fields.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {label}
              </dt>
              <dd className="mt-0.5 text-sm font-medium text-slate-800">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function MachineFormModal({ open, initial, onClose, onSubmit, saving }) {
  const [form, setForm] = useState(initial ?? EMPTY_FORM);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({
        machin_no: initial.machin_no ?? "",
        machin_name: initial.machin_name ?? "",
        brand: initial.brand ?? "",
        model_no: initial.model_no ?? "",
        floor: initial.floor ?? "",
        line: initial.line_no ?? initial.line ?? "",
        unit: initial.unit ?? "",
        owner: initial.owner === 2 ? 2 : 1,
        is_active: initial.is_active === 2 ? 2 : 1,
        movement_date: toDatetimeLocal(initial.movement_date),
        supplier_name: initial.supplier_name ?? "",
      });
    } else {
      setForm({
        ...EMPTY_FORM,
        movement_date: toDatetimeLocal(new Date().toISOString()),
      });
    }
  }, [initial, open]);

  if (!open) return null;

  function update(patch) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit({
      machin_no: Number(form.machin_no),
      machin_name: form.machin_name.trim(),
      brand: form.brand.trim(),
      model_no: form.model_no.trim(),
      floor: Number(form.floor) || 0,
      line: Number(form.line) || 0,
      unit: form.unit === "" ? null : Number(form.unit),
      owner: Number(form.owner),
      is_active: Number(form.is_active),
      supplier_name: form.supplier_name.trim(),
      movement_date: form.movement_date
        ? new Date(form.movement_date).toISOString()
        : null,
    });
  }

  const inputCls = "mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">
            {initial?.id ? "Edit machine" : "Add machine"}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="max-h-[80vh] space-y-3 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-slate-600">
              No (Machine No)
              <input
                type="number"
                required
                className={inputCls}
                value={form.machin_no}
                onChange={(e) => update({ machin_no: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Name
              <input
                required
                className={inputCls}
                value={form.machin_name}
                onChange={(e) => update({ machin_name: e.target.value })}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-slate-600">
              Brand
              <input
                className={inputCls}
                value={form.brand}
                onChange={(e) => update({ brand: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Model
              <input
                className={inputCls}
                value={form.model_no}
                onChange={(e) => update({ model_no: e.target.value })}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-slate-600">
              Floor
              <input
                type="number"
                className={inputCls}
                value={form.floor}
                onChange={(e) => update({ floor: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Line
              <input
                type="number"
                className={inputCls}
                value={form.line}
                onChange={(e) => update({ line: e.target.value })}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-slate-600">
              Unit
              <select
                className={inputCls}
                value={form.unit}
                onChange={(e) => update({ unit: e.target.value })}
              >
                <option value="">Unassigned</option>
                <option value={1}>MBM</option>
                <option value={2}>CEIL</option>
                <option value={3}>AQL</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Ownership
              <select
                className={inputCls}
                value={form.owner}
                onChange={(e) => update({ owner: Number(e.target.value) })}
              >
                <option value={1}>Owned</option>
                <option value={2}>Rental</option>
              </select>
            </label>
          </div>
          <label className="block text-xs font-medium text-slate-600">
            Supplier Name
            <input
              className={inputCls}
              value={form.supplier_name}
              onChange={(e) => update({ supplier_name: e.target.value })}
              placeholder="Supplier / vendor name"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-slate-600">
              Status
              <select
                className={inputCls}
                value={form.is_active}
                onChange={(e) => update({ is_active: Number(e.target.value) })}
              >
                <option value={1}>Active</option>
                <option value={2}>Inactive</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Movement Date
              <input
                type="datetime-local"
                className={inputCls}
                value={form.movement_date}
                onChange={(e) => update({ movement_date: e.target.value })}
              />
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function QrModal({ machine, onClose }) {
  const ref = useRef(null);

  if (!machine) return null;

  const value = qrValue(machine);

  function download() {
    const canvas = ref.current?.querySelector("canvas");
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `machine-${machine.machin_no}-qr.png`;
    a.click();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-xs rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Machine QR</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex flex-col items-center gap-3 px-5 py-5">
          <div ref={ref} className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
            <QRCodeCanvas value={value} size={200} level="M" includeMargin />
          </div>
          <div className="text-center text-sm font-medium text-slate-800">
            #{machine.machin_no} · {machine.machin_name}
          </div>
          <div className="break-all text-center text-xs text-slate-500">{value}</div>
          <button
            type="button"
            onClick={download}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"
          >
            <Download className="h-4 w-4" />
            Download PNG
          </button>
        </div>
      </div>
    </div>
  );
}

function cellText(row, key) {
  if (key === "line_no") return String(row.line_no || row.line || "");
  if (key === "movement_date") return formatDateTime(row.movement_date);
  if (key === "unit_label") return row.unit_label || "";
  if (key === "ownership_label") return row.ownership_label || "";
  if (key === "status_label") return row.status_label || "";
  return String(row[key] ?? "");
}

export default function MachineList() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [colFilters, setColFilters] = useState({});
  const [sortKey, setSortKey] = useState("machin_no");
  const [sortDir, setSortDir] = useState("asc");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewMachine, setViewMachine] = useState(null);
  const [qrMachine, setQrMachine] = useState(null);

  const { data: machines, isLoading } = useQuery({
    queryKey: ["machin-library", search],
    queryFn: () =>
      api
        .get("/floors/machin-library/", { params: search ? { search } : {} })
        .then((r) => r.data),
    enabled: !!token,
  });

  const saveMutation = useMutation({
    mutationFn: async (payload) => {
      if (editing?.id) {
        await api.put(`/floors/machin-library/${editing.id}/`, payload);
      } else {
        await api.post("/floors/machin-library/", payload);
      }
    },
    onSuccess: () => {
      toast.success(editing?.id ? "Machine updated" : "Machine added");
      qc.invalidateQueries({ queryKey: ["machin-library"] });
      setModalOpen(false);
      setEditing(null);
    },
    onError: () => toast.error("Save failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/floors/machin-library/${id}/`),
    onSuccess: () => {
      toast.success("Machine deleted");
      qc.invalidateQueries({ queryKey: ["machin-library"] });
    },
    onError: () => toast.error("Delete failed"),
  });

  const rows = useMemo(() => {
    let list = machines ?? [];

    list = list.filter((row) =>
      FILTER_KEYS.every((key) => {
        const q = (colFilters[key] || "").trim().toLowerCase();
        if (!q) return true;
        return cellText(row, key).toLowerCase().includes(q);
      })
    );

    list = [...list].sort((a, b) => {
      const av = cellText(a, sortKey).toLowerCase();
      const bv = cellText(b, sortKey).toLowerCase();
      const an = Number(av);
      const bn = Number(bv);
      let cmp = 0;
      if (!Number.isNaN(an) && !Number.isNaN(bn) && av !== "" && bv !== "") {
        cmp = an - bn;
      } else {
        cmp = av.localeCompare(bv);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [machines, colFilters, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(row) {
    setEditing(row);
    setModalOpen(true);
  }

  function confirmDelete(row) {
    if (window.confirm(`Delete machine #${row.machin_no} (${row.machin_name})?`)) {
      deleteMutation.mutate(row.id);
    }
  }

  const columns = [
    { key: "machin_no", label: "No", sortable: true },
    { key: "machin_name", label: "Name", sortable: true },
    { key: "brand", label: "Brand", sortable: true },
    { key: "model_no", label: "Model", sortable: true },
    { key: "floor", label: "Floor", sortable: true },
    { key: "line_no", label: "Line", sortable: true },
    { key: "unit_label", label: "Unit", sortable: true },
    { key: "ownership_label", label: "Ownership", sortable: true },
    { key: "status_label", label: "Status", sortable: true },
    { key: "supplier_name", label: "Supplier", sortable: true },
    { key: "movement_date", label: "Movement Date", sortable: true },
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Machine List</h1>
          <p className="mt-1 text-sm text-slate-600">
            Manage the machine library — search, sort, and filter by column.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            placeholder="Search name / brand / model / supplier…"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white"
          >
            <Plus className="h-4 w-4" />
            Add machine
          </button>
        </div>
      </header>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((col) => (
                <th key={col.key} className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => col.sortable && toggleSort(col.key)}
                    className="inline-flex items-center gap-1 hover:text-slate-800"
                  >
                    {col.label}
                    {col.sortable ? (
                      <SortIcon active={sortKey === col.key} dir={sortDir} />
                    ) : null}
                  </button>
                </th>
              ))}
              <th className="px-3 py-2">QR</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
            <tr className="border-t border-slate-100 bg-white normal-case">
              {columns.map((col) => (
                <th key={`f-${col.key}`} className="px-2 py-1.5">
                  <input
                    type="text"
                    placeholder="Filter…"
                    value={colFilters[col.key] || ""}
                    onChange={(e) =>
                      setColFilters((prev) => ({ ...prev, [col.key]: e.target.value }))
                    }
                    className="w-full min-w-[4.5rem] rounded border border-slate-200 px-2 py-1 text-xs font-normal text-slate-700"
                  />
                </th>
              ))}
              <th className="px-2 py-1.5" />
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td colSpan={columns.length + 2} className="px-4 py-6 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 2} className="px-4 py-6 text-center text-slate-500">
                  No machines found.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2.5 font-medium text-slate-700">{row.machin_no}</td>
                  <td className="px-3 py-2.5 text-slate-800">{row.machin_name}</td>
                  <td className="px-3 py-2.5 text-slate-600">{row.brand || "—"}</td>
                  <td className="px-3 py-2.5 text-slate-600">{row.model_no || "—"}</td>
                  <td className="px-3 py-2.5 text-slate-600">{row.floor}</td>
                  <td className="px-3 py-2.5 text-slate-600">
                    {row.line_no || row.line || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{row.unit_label || "—"}</td>
                  <td className="px-3 py-2.5 text-slate-600">{row.ownership_label}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={[
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                        row.is_active === 1
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-200 text-slate-600",
                      ].join(" ")}
                    >
                      {row.status_label || (row.is_active === 1 ? "Active" : "Inactive")}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{row.supplier_name || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">
                    {formatDateTime(row.movement_date)}
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => setQrMachine(row)}
                      title="View / download QR"
                      className="rounded-md p-1 ring-1 ring-slate-200 hover:ring-slate-300"
                    >
                      <QRCodeCanvas value={qrValue(row)} size={36} level="M" />
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setViewMachine(row)}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        title="View"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => confirmDelete(row)}
                        className="rounded-md p-1.5 text-red-500 hover:bg-red-50"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <MachineFormModal
        open={modalOpen}
        initial={editing}
        saving={saveMutation.isPending}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSubmit={(payload) => saveMutation.mutate(payload)}
      />

      <MachineViewModal machine={viewMachine} onClose={() => setViewMachine(null)} />
      <QrModal machine={qrMachine} onClose={() => setQrMachine(null)} />
    </div>
  );
}
