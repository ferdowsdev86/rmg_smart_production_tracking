"""Align legacy finishing_process (process_name, process_sequence_id) with Django model."""

from django.db import migrations, models


def _column_names(schema_editor, table):
    with schema_editor.connection.cursor() as cursor:
        return {
            col.name
            for col in schema_editor.connection.introspection.get_table_description(
                cursor, table
            )
        }


def _run_sql(connection, sql):
    with connection.cursor() as cursor:
        cursor.execute(sql)


def align_finishing_process(apps, schema_editor):
    table = "finishing_process"
    connection = schema_editor.connection

    with connection.cursor() as cursor:
        tables = connection.introspection.table_names(cursor)
    if table not in tables:
        return

    existing = _column_names(schema_editor, table)

    if "process_name" in existing and "name" not in existing:
        _run_sql(
            connection,
            f"ALTER TABLE {table} CHANGE COLUMN process_name name VARCHAR(200) NOT NULL",
        )
        existing = _column_names(schema_editor, table)

    if "process_sequence_id" in existing and "display_order" not in existing:
        _run_sql(
            connection,
            f"ALTER TABLE {table} CHANGE COLUMN process_sequence_id display_order SMALLINT UNSIGNED NOT NULL",
        )
        existing = _column_names(schema_editor, table)

    add_columns = [
        ("display_order", "SMALLINT UNSIGNED NOT NULL DEFAULT 1"),
        ("slug", "VARCHAR(64) NOT NULL DEFAULT ''"),
        ("name", "VARCHAR(200) NOT NULL DEFAULT ''"),
        ("legend_label", "VARCHAR(80) NOT NULL DEFAULT ''"),
        ("panel", "VARCHAR(120) NOT NULL DEFAULT 'bg-slate-50 border-slate-300'"),
        ("title_bar", "VARCHAR(120) NOT NULL DEFAULT 'bg-slate-200 text-slate-900'"),
        ("tile", "VARCHAR(120) NOT NULL DEFAULT 'bg-slate-400 border-slate-600'"),
        ("tile_muted", "VARCHAR(120) NOT NULL DEFAULT 'bg-slate-200 border-slate-400'"),
        ("is_active", "TINYINT(1) NOT NULL DEFAULT 1"),
    ]
    for col, ddl in add_columns:
        if col not in existing:
            _run_sql(connection, f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")
            existing.add(col)

    if connection.vendor == "mysql":
        _run_sql(
            connection,
            f"UPDATE {table} SET slug = CONCAT('process-', id) "
            f"WHERE slug IS NULL OR slug = ''",
        )
        _run_sql(
            connection,
            f"UPDATE {table} SET legend_label = name "
            f"WHERE legend_label IS NULL OR legend_label = ''",
        )
        _run_sql(
            connection,
            f"UPDATE {table} SET display_order = id "
            f"WHERE display_order IS NULL OR display_order = 0",
        )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("floors", "0003_finishingprocess"),
    ]

    operations = [
        migrations.RunPython(align_finishing_process, noop_reverse),
    ]
