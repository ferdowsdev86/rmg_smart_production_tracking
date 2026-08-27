"""Sync finishing_process rows (legacy columns: process_name, SAM, machin_type)."""

from django.core.management.base import BaseCommand

from floors.models import FinishingProcess

PROCESSES = [
    {"display_order": 1, "process_name": "Loop cutting", "station_count": 2, "code": "LC", "product_type": "shart", "sam": ".32", "machin_type": "Helper"},
    {"display_order": 2, "process_name": "Top side thread cutting", "station_count": 2, "code": "TT", "product_type": "shart", "sam": "", "machin_type": "Helper"},
    {"display_order": 3, "process_name": "Top side quality check", "station_count": 2, "code": "TQ", "product_type": "shart", "sam": "", "machin_type": "Quality"},
    {"display_order": 4, "process_name": "Inside thread cutting", "station_count": 3, "code": "IC", "product_type": "shart", "sam": "", "machin_type": "Helper"},
    {"display_order": 5, "process_name": "Inside back pocket reinforcement cutting", "station_count": 1, "code": "BR", "product_type": "shart", "sam": "", "machin_type": "Helper"},
    {"display_order": 6, "process_name": "Inside waist band ironing", "station_count": 2, "code": "WI", "product_type": "shart", "sam": "", "machin_type": "Helper"},
    {"display_order": 7, "process_name": "Inside quality check", "station_count": 2, "code": "IQ", "product_type": "shart", "sam": "", "machin_type": "Quality"},
    {"display_order": 8, "process_name": "Thread shaking", "station_count": 1, "code": "TS", "product_type": "shart", "sam": "", "machin_type": "Helper"},
    {"display_order": 9, "process_name": "Button attach", "station_count": 4, "code": "BA", "product_type": "shart", "sam": "", "machin_type": "Helper"},
    {"display_order": 10, "process_name": "Top side ironing", "station_count": 4, "code": "TI", "product_type": "shart", "sam": "", "machin_type": "Helper"},
    {"display_order": 11, "process_name": "Final trim", "station_count": 2, "code": "FT", "product_type": "shart", "sam": "", "machin_type": "Helper"},
    {"display_order": 12, "process_name": "Measurement", "station_count": 2, "code": "MS", "product_type": "shart", "sam": "", "machin_type": "Quality"},
    {"display_order": 13, "process_name": "Getup", "station_count": 2, "code": "GT", "product_type": "shart", "sam": "", "machin_type": "Helper"},
    {"display_order": 14, "process_name": "Waist tack", "station_count": 2, "code": "WT", "product_type": "shart", "sam": "", "machin_type": "Helper"},
    {"display_order": 15, "process_name": "Hand tack", "station_count": 2, "code": "HT", "product_type": "shart", "sam": "", "machin_type": "Helper"},
]


class Command(BaseCommand):
    help = "Upsert finishing_process rows (process_name, SAM, machin_type)."

    def handle(self, *args, **options):
        created = 0
        updated = 0
        for row in PROCESSES:
            obj, was_created = FinishingProcess.objects.update_or_create(
                display_order=row["display_order"],
                defaults={
                    "process_name": row["process_name"],
                    "station_count": row["station_count"],
                    "code": row["code"],
                    "product_type": row.get("product_type", ""),
                    "sam": row.get("sam", ""),
                    "machin_type": row.get("machin_type", ""),
                    "is_active": True,
                },
            )
            if was_created:
                created += 1
            else:
                updated += 1
        total = FinishingProcess.objects.filter(is_active=True).count()
        self.stdout.write(
            self.style.SUCCESS(
                f"finishing_process: {created} created, {updated} updated — {total} active"
            )
        )
