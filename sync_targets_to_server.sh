#!/bin/bash
# Mirror day_line_target rows from the NEW DB (10.135.50.27:3336) to the OLD DB
# (172.16.101.70) that the deployed server still reads.
# Runs automatically every 2 minutes via LaunchAgent com.mbm.sff.synctargets
# (interim until 172.16.101.5 gets network access to the new DB).
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
PROJECT="/Users/ferdows/Documents/Software_Dev/SmartFinishingFloor"
cd "$PROJECT/backend"

ROWS=$("$PROJECT/.venv/bin/python3.14" manage.py shell -c "
from floors.models import DayLineTarget
import json
rows = [
    dict(floor=t.floor, line=t.line, date=str(t.date), style=t.style,
         target_qty=t.target_qty, layout_id=t.layout_id, target_hour=t.target_hour,
         start_time=str(t.start_time or ''), break_st=str(t.break_st or ''),
         break_end=str(t.break_end or ''))
    for t in DayLineTarget.objects.all()
]
print('JSON:' + json.dumps(rows))
" 2>/dev/null | grep '^JSON:' | cut -c6-)

if [ -z "$ROWS" ]; then
  echo "$(date '+%F %T') ERROR: could not read new DB" >&2
  exit 1
fi

sshpass -p redhat ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 root@172.16.101.5 \
  "docker exec -i smart_finishing_floor-backend-1 python manage.py shell" << PYEOF 2>/dev/null | grep -E "created|updated" || true
import json, datetime
from floors.models import DayLineTarget
rows = json.loads('''$ROWS''')
def t(v):
    return datetime.time.fromisoformat(v) if v else None
for r in rows:
    obj, created = DayLineTarget.objects.update_or_create(
        floor=r["floor"], line=r["line"],
        date=datetime.date.fromisoformat(r["date"]),
        defaults=dict(style=r["style"], target_qty=r["target_qty"],
                      layout_id=r["layout_id"], target_hour=r["target_hour"],
                      start_time=t(r["start_time"]), break_st=t(r["break_st"]),
                      break_end=t(r["break_end"])),
    )
    print(("created" if created else "updated"), obj.date, "F", obj.floor, "L", obj.line, "qty", obj.target_qty)
PYEOF
echo "$(date '+%F %T') sync done"
