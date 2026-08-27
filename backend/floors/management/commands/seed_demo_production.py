import random
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from floors.models import Line, ProductionEntry, WorkStation


class Command(BaseCommand):
    help = "Create sample hourly production entries for today and yesterday (demo charts)."

    def handle(self, *args, **options):
        today = timezone.localdate()
        yesterday = today - timedelta(days=1)

        for line in Line.objects.all().order_by("line_number"):
            stations = list(line.stations.order_by("station_number")[:10])
            if not stations:
                continue
            for day in (today, yesterday):
                for hour in range(8, 18):
                    for st in stations[:3]:
                        target = 30 + (line.line_number % 5) * 2
                        qty = max(0, target - random.randint(-8, 10))
                        ProductionEntry.objects.update_or_create(
                            line=line,
                            station=st,
                            date=day,
                            hour=hour,
                            defaults={
                                "quantity": qty,
                                "target": target,
                            },
                        )

        self.stdout.write(self.style.SUCCESS("Seeded demo production entries (08–17h, subset of stations)."))
