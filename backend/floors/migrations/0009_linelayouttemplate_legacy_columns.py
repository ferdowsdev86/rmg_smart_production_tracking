"""Ensure stations_id and line_id exist on floors_linelayouttemplate."""

from django.db import migrations, models


def _column_names(schema_editor, table):
    with schema_editor.connection.cursor() as cursor:
        return {
            col.name
            for col in schema_editor.connection.introspection.get_table_description(cursor, table)
        }


def add_missing_legacy_columns(apps, schema_editor):
    table = "floors_linelayouttemplate"
    connection = schema_editor.connection
    vendor = connection.vendor

    with connection.cursor() as cursor:
        tables = connection.introspection.table_names(cursor)
    if table not in tables:
        return

    existing = _column_names(schema_editor, table)
    LineLayoutTemplate = apps.get_model("floors", "LineLayoutTemplate")

    if "user_id" not in existing and "name" in existing:
        with connection.cursor() as cursor:
            if vendor == "sqlite":
                cursor.execute(f"ALTER TABLE {table} RENAME COLUMN name TO user_id")
            elif vendor == "mysql":
                cursor.execute(
                    f"ALTER TABLE `{table}` CHANGE `name` `user_id` varchar(120) NOT NULL DEFAULT ''"
                )
            else:
                cursor.execute(f"ALTER TABLE {table} RENAME COLUMN name TO user_id")

    existing = _column_names(schema_editor, table)

    if "stations_id" not in existing:
        field = models.IntegerField(default=0)
        field.set_attributes_from_name("stations_id")
        schema_editor.add_field(LineLayoutTemplate, field)

    if "line_id" not in existing:
        field = models.IntegerField(default=0)
        field.set_attributes_from_name("line_id")
        schema_editor.add_field(LineLayoutTemplate, field)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("floors", "0008_linelayouttemplate_employee_id_column"),
    ]

    operations = [
        migrations.RunPython(add_missing_legacy_columns, noop_reverse),
    ]
