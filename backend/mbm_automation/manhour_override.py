"""Manual overrides for the Man Hour report's COUNT FROM column.

COUNT FROM is normally derived (max of the machine's first punch and 08:00) and
it drives Working Hour + Man Hour. Authorised users may override it per machine
per day; the override is stored here (default DB, raw DDL because this venv's
MySQL driver blocks migrations) and applied when the man-hour summary is built.

Only members of the ``manhour_editor`` group (plus superusers) may edit — see
``can_edit``. Use the ``create_manhour_editor`` management command to create an
editor account and the ``init_manhour_override_table`` command to create the
table.
"""

from __future__ import annotations

from datetime import time as _time_cls

from django.db import connections
from django.utils import timezone

_CONN = "default"
TABLE = "manhour_count_from_override"

# users in this group (and superusers) may edit COUNT FROM
GROUP_NAME = "manhour_editor"

_CREATE = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  work_date DATE NOT NULL,
  machin_no INT NOT NULL,
  count_from_time TIME NOT NULL,
  note VARCHAR(190) NULL,
  updated_by VARCHAR(150) NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_override (work_date, machin_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


def ensure_table() -> None:
    with connections[_CONN].cursor() as cur:
        cur.execute(_CREATE)


def can_edit(user) -> bool:
    """True when the user may edit COUNT FROM.

    Access is restricted to members of the ``manhour_editor`` group ONLY —
    being a superuser/staff is deliberately not enough, so COUNT FROM can be
    locked to specific accounts (e.g. only ``owasik``). Grant access with the
    ``create_manhour_editor`` management command.
    """
    if not user or not user.is_authenticated:
        return False
    return user.groups.filter(name=GROUP_NAME).exists()


def _parse_hhmm(value) -> _time_cls | None:
    """Accept 'HH:MM' or 'HH:MM:SS' (24h) → datetime.time, else None."""
    if value in (None, ""):
        return None
    if isinstance(value, _time_cls):
        return value.replace(second=0, microsecond=0)
    parts = str(value).strip().split(":")
    try:
        hh = int(parts[0])
        mm = int(parts[1]) if len(parts) > 1 else 0
    except (ValueError, IndexError):
        return None
    if not (0 <= hh <= 23 and 0 <= mm <= 59):
        return None
    return _time_cls(hh, mm)


def get_overrides(on_date) -> dict[int, _time_cls]:
    """Map of machin_no → overridden count-from time for the day."""
    ensure_table()
    with connections[_CONN].cursor() as cur:
        cur.execute(
            f"SELECT machin_no, count_from_time FROM {TABLE} WHERE work_date=%s",
            [on_date],
        )
        out: dict[int, _time_cls] = {}
        for machin_no, t in cur.fetchall():
            if t is None:
                continue
            # the driver may hand back a timedelta for TIME columns
            if isinstance(t, _time_cls):
                out[int(machin_no)] = t.replace(second=0, microsecond=0)
            else:
                secs = int(getattr(t, "total_seconds", lambda: 0)())
                out[int(machin_no)] = _time_cls((secs // 3600) % 24, (secs % 3600) // 60)
        return out


def set_override(on_date, machin_no: int, count_from, user=None, note: str | None = None) -> dict:
    """Upsert (or clear, when count_from is empty) one machine's override."""
    ensure_table()
    machin_no = int(machin_no)
    username = getattr(user, "username", None) or None
    t = _parse_hhmm(count_from)
    now = timezone.now()

    with connections[_CONN].cursor() as cur:
        if t is None:
            cur.execute(
                f"DELETE FROM {TABLE} WHERE work_date=%s AND machin_no=%s",
                [on_date, machin_no],
            )
            return {"machin_no": machin_no, "count_from": None, "cleared": True}
        cur.execute(
            f"""
            INSERT INTO {TABLE} (work_date, machin_no, count_from_time, note, updated_by, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s)
            ON DUPLICATE KEY UPDATE
              count_from_time=VALUES(count_from_time), note=VALUES(note),
              updated_by=VALUES(updated_by), updated_at=VALUES(updated_at)
            """,
            [on_date, machin_no, t.strftime("%H:%M:%S"), (note or None), username, now],
        )
    return {
        "machin_no": machin_no,
        "count_from": t.strftime("%H:%M"),
        "updated_by": username,
        "updated_at": now.isoformat(),
        "cleared": False,
    }
