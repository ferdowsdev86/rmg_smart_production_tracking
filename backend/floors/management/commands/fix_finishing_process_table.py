"""Repair finishing_process schema then seed rows. Run: python manage.py fix_finishing_process_table"""

import os

from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import connection


class Command(BaseCommand):
    help = "Apply floors migration 0004 and seed finishing_process if schema was wrong."

    def handle(self, *args, **options):
        # Ensure we hit MariaDB when .env has USE_SQLITE=False (shell env can override).
        os.environ.setdefault("USE_SQLITE", "False")
        call_command("migrate", "floors", "0013_align_finishing_process_model", verbosity=1)
        call_command("seed_finishing_processes", verbosity=1)

        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM finishing_process")
            count = cursor.fetchone()[0]
        self.stdout.write(self.style.SUCCESS(f"finishing_process rows: {count}"))
