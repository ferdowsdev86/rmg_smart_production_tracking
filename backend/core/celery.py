import os
from datetime import timedelta

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")

app = Celery("smart_finishing_floor")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

app.conf.beat_schedule = {
    "broadcast-floor-dashboard": {
        "task": "core.tasks.broadcast_floor_dashboard",
        "schedule": timedelta(seconds=30),
    },
}
