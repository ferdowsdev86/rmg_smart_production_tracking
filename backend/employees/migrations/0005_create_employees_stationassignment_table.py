"""Create employees_stationassignment when missing (state-only migrations never created the table)."""

from django.db import migrations


CREATE_SQL = """
CREATE TABLE IF NOT EXISTS employees_stationassignment (
    id BIGINT AUTO_INCREMENT NOT NULL PRIMARY KEY,
    employee_id VARCHAR(100) NULL,
    layour_id INT NOT NULL,
    process_id INT NULL,
    assigned_date DATE NOT NULL,
    is_active TINYINT(1) NOT NULL,
    line_id BIGINT NOT NULL,
    station_id BIGINT NOT NULL,
    INDEX employees_s_assigne_ddb09d_idx (assigned_date, is_active),
    CONSTRAINT employees_stationassignment_line_id_fk
        FOREIGN KEY (line_id) REFERENCES floors_line (id),
    CONSTRAINT employees_stationassignment_station_id_fk
        FOREIGN KEY (station_id) REFERENCES floors_workstation (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


class Migration(migrations.Migration):

    dependencies = [
        ("employees", "0004_create_stationassignment_table"),
        ("floors", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(
            sql=CREATE_SQL,
            reverse_sql="DROP TABLE IF EXISTS employees_stationassignment;",
        ),
    ]
