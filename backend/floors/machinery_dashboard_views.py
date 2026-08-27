"""Machinery dashboard — summary + details over machin_library and maintenance.

Cards:
  - total machines, active / inactive (active = is_active != 0)
  - ownership: owned vs rental
  - unit-wise: total / active / inactive / owned / rental
  - maintenance: trouble count (every daily_machin_maintanance row = 1 trouble),
    summarised per unit and detailed per machine.
"""

from collections import defaultdict

from django.db.models import Count
from rest_framework.response import Response
from rest_framework.views import APIView

from floors.models import DailyMachinMaintanance, MachinLibrary


def _is_inactive(machine: MachinLibrary) -> bool:
    # is_active: 1 = Active, 2 = Inactive (anything other than 1 counts as inactive)
    return machine.is_active != MachinLibrary.STATUS_ACTIVE


def _unit_label(unit) -> str:
    return MachinLibrary.UNIT_LABELS.get(unit, "Unassigned")


class MachineryDashboardView(APIView):
    """GET /api/floors/machinery-dashboard/"""

    def get(self, request):
        machines = list(MachinLibrary.objects.all())
        total = len(machines)
        inactive = sum(1 for m in machines if _is_inactive(m))
        active = total - inactive
        owned = sum(1 for m in machines if m.owner == MachinLibrary.OWNER_OWNED)
        rental = sum(1 for m in machines if m.owner == MachinLibrary.OWNER_RENTAL)
        owner_unknown = total - owned - rental

        # Unit-wise rollup.
        unit_map = defaultdict(
            lambda: {"total": 0, "active": 0, "inactive": 0, "owned": 0, "rental": 0}
        )
        for m in machines:
            unit_key = m.unit if m.unit is not None else 0
            d = unit_map[unit_key]
            d["total"] += 1
            if _is_inactive(m):
                d["inactive"] += 1
            else:
                d["active"] += 1
            if m.owner == MachinLibrary.OWNER_OWNED:
                d["owned"] += 1
            elif m.owner == MachinLibrary.OWNER_RENTAL:
                d["rental"] += 1
        by_unit = [
            {"unit": k, "unit_label": _unit_label(k), **v}
            for k, v in sorted(unit_map.items())
        ]

        # Maintenance troubles (every record counts once), grouped by machine_id.
        trouble_rows = DailyMachinMaintanance.objects.values("machine_id").annotate(
            troubles=Count("id")
        )
        trouble_by_machine = {r["machine_id"]: r["troubles"] for r in trouble_rows}
        total_troubles = sum(trouble_by_machine.values())

        # Map maintenance machine_id -> machin_library row (by machin_no).
        lib_by_no = {m.machin_no: m for m in machines}
        unit_troubles = defaultdict(int)
        details = []
        for machine_id, cnt in trouble_by_machine.items():
            lib = lib_by_no.get(machine_id)
            unit_key = lib.unit if (lib and lib.unit is not None) else 0
            unit_troubles[unit_key] += cnt
            details.append(
                {
                    "machine_id": machine_id,
                    "machin_no": lib.machin_no if lib else machine_id,
                    "machin_name": lib.machin_name if lib else "",
                    "unit": unit_key,
                    "unit_label": _unit_label(unit_key),
                    "ownership": lib.ownership_label if lib else "Unknown",
                    "troubles": cnt,
                }
            )
        details.sort(key=lambda x: x["troubles"], reverse=True)
        maint_by_unit = [
            {"unit": k, "unit_label": _unit_label(k), "troubles": v}
            for k, v in sorted(unit_troubles.items())
        ]

        return Response(
            {
                "totals": {"total": total, "active": active, "inactive": inactive},
                "ownership": {"owned": owned, "rental": rental, "unknown": owner_unknown},
                "by_unit": by_unit,
                "maintenance": {
                    "total_troubles": total_troubles,
                    "machines_with_trouble": len(trouble_by_machine),
                    "by_unit": maint_by_unit,
                    "details": details,
                },
            }
        )
