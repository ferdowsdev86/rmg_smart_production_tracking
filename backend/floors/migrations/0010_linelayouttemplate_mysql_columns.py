"""Add missing `stations` JSON column on legacy floors_linelayouttemplate (MySQL)."""

from django.db import migrations, models


def _column_names(schema_editor, table):
    with schema_editor.connection.cursor() as cursor:
        return {
            col.name
            for col in schema_editor.connection.introspection.get_table_description(cursor, table)
        }


def ensure_stations_column(apps, schema_editor):
    table = "floors_linelayouttemplate"
    connection = schema_editor.connection
    vendor = connection.vendor

    with connection.cursor() as cursor:
        tables = connection.introspection.table_names(cursor)
    if table not in tables:
        return

    if "stations" in _column_names(schema_editor, table):
        return

    LineLayoutTemplate = apps.get_model("floors", "LineLayoutTemplate")
    with connection.cursor() as cursor:
        if vendor == "mysql":
            cursor.execute(f"ALTER TABLE `{table}` ADD COLUMN `stations` JSON NULL")
        elif vendor == "sqlite":
            cursor.execute(f'ALTER TABLE "{table}" ADD COLUMN "stations" TEXT NULL')
        else:
            field = models.JSONField(blank=True, default=list, null=True)
            field.set_attributes_from_name("stations")
            schema_editor.add_field(LineLayoutTemplate, field)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("floors", "0009_linelayouttemplate_legacy_columns"),
    ]

    operations = [
        migrations.RunPython(ensure_stations_column, noop_reverse),
    ]
