"""Create the manhour_count_from_override table (raw DDL, idempotent).

Run instead of migrate (the MySQL driver here blocks migrations):
    python manage.py init_manhour_override_table
"""

from django.core.management.base import BaseCommand

from mbm_automation import manhour_override


class Command(BaseCommand):
    help = "Create the COUNT FROM override table."

    def handle(self, *args, **options):
        manhour_override.ensure_table()
        self.stdout.write(self.style.SUCCESS(f"Ready: {manhour_override.TABLE}"))
