"""Create mastar_line_layout / child_line_layout in the default DB.

Run instead of migrate (the MySQL driver here blocks migrations):
    python manage.py init_layout_tables
"""

from django.core.management.base import BaseCommand

from line_planner import layout_store


class Command(BaseCommand):
    help = "Create the line-layout persistence tables (raw DDL, idempotent)."

    def handle(self, *args, **options):
        layout_store.ensure_tables()
        self.stdout.write(
            self.style.SUCCESS(
                f"Ready: {layout_store.MASTER_TABLE}, {layout_store.CHILD_TABLE}"
            )
        )
