"""Add stations JSON column to floors_linelayouttemplate (legacy ERP table)."""

from django.db import migrations, models


def _column_names(schema_editor, table):
    with schema_editor.connection.cursor() as cursor:
        return {
            col.name
            for col in schema_editor.connection.introspection.get_table_description(cursor, table)
        }


def add_stations_json(apps, schema_editor):
    table = "floors_linelayouttemplate"
    with schema_editor.connection.cursor() as cursor:
        tables = schema_editor.connection.introspection.table_names(cursor)
    if table not in tables:
        return
    if "stations" in _column_names(schema_editor, table):
        return
    LineLayoutTemplate = apps.get_model("floors", "LineLayoutTemplate")
    field = models.JSONField(blank=True, default=list, null=True)
    field.set_attributes_from_name("stations")
    schema_editor.add_field(LineLayoutTemplate, field)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("floors", "0005_linelayouttemplate_layout_type"),
    ]

    operations = [
        migrations.RunPython(add_stations_json, noop_reverse),
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.AddField(
                    model_name="linelayouttemplate",
                    name="stations",
                    field=models.JSONField(blank=True, default=list, null=True),
                ),
            ],
        ),
    ]
