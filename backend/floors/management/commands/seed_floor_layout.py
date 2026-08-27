from django.core.management.base import BaseCommand

from floors.constants import OPERATION_CHOICES
from floors.models import Floor, Line, WorkStation


class Command(BaseCommand):
    help = "Seed one finishing floor with 8 lines × 50 stations (predefined operations)."

    def handle(self, *args, **options):
        floor, _ = Floor.objects.get_or_create(
            name="Finishing Floor",
            defaults={"total_lines": 8},
        )

        operation_codes = [c[0] for c in OPERATION_CHOICES]

        for line_num in range(1, 9):
            line, _ = Line.objects.get_or_create(
                floor=floor,
                line_number=line_num,
                defaults={
                    "name": f"Line {line_num}",
                    "daily_target": 1000,
                    "is_active": True,
                },
            )
            for station_num in range(1, 51):
                op = operation_codes[(station_num - 1) % len(operation_codes)]
                col = (station_num - 1) % 10
                row = (station_num - 1) // 10
                WorkStation.objects.update_or_create(
                    line=line,
                    station_number=station_num,
                    defaults={
                        "operation_type": op,
                        "position_x": float(col),
                        "position_y": float(row),
                        "machine_type": f"{op.replace('_', ' ').title()} unit",
                        "standard_time": round(0.45 + (station_num % 12) * 0.04, 3),
                        "symbol_icon": op,
                        "required_skill_level": 1 + (station_num % 5),
                    },
                )

        self.stdout.write(self.style.SUCCESS("Seeded 8 lines × 50 stations on Finishing Floor."))
