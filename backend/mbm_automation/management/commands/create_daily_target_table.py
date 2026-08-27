"""Create `mbm_automation.daily_target` if missing. Run: python manage.py create_daily_target_table"""

from django.core.management.base import BaseCommand
from django.db import connections


CREATE_SQL = """
CREATE TABLE IF NOT EXISTS daily_target (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    machin_id BIGINT NOT NULL,
    target INT NOT NULL DEFAULT 0,
    operation_type VARCHAR(50) NOT NULL DEFAULT '',
    department_name VARCHAR(100) NOT NULL DEFAULT '',
    date DATE NOT NULL,
    INDEX idx_daily_target_machin_id (machin_id),
    INDEX idx_daily_target_date (date),
    UNIQUE KEY uniq_daily_target_machin_date_op (
        machin_id, date, operation_type
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


class Command(BaseCommand):
    help = "Create daily_target table in the mbm_automation database."

    def handle(self, *args, **options):
        conn = connections["mbm_automation"]
        with conn.cursor() as cursor:
            cursor.execute(CREATE_SQL)
            cursor.execute("DESCRIBE daily_target")
            columns = cursor.fetchall()

        self.stdout.write(self.style.SUCCESS("Table mbm_automation.daily_target is ready."))
        for col in columns:
            self.stdout.write(f"  {col[0]:20} {col[1]}")
