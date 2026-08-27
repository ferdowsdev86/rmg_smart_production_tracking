"""Add layout_name column to floors_linelayouttemplate."""

from django.db import migrations, models


def _column_names(schema_editor, table):
    with schema_editor.connection.cursor() as cursor:
        return {
            col.name
            for col in schema_editor.connection.introspection.get_table_description(cursor, table)
        }


def add_layout_name(apps, schema_editor):
    table = "floors_linelayouttemplate"
    with schema_editor.connection.cursor() as cursor:
        tables = schema_editor.connection.introspection.table_names(cursor)
    if table not in tables or "layout_name" in _column_names(schema_editor, table):
        return
    LineLayoutTemplate = apps.get_model("floors", "LineLayoutTemplate")
    field = models.CharField(max_length=120, blank=True, default="")
    field.set_attributes_from_name("layout_name")
    schema_editor.add_field(LineLayoutTemplate, field)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("floors", "0006_linelayouttemplate_stations_json"),
    ]

    operations = [
        migrations.RunPython(add_layout_name, noop_reverse),
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.AddField(
                    model_name="linelayouttemplate",
                    name="layout_name",
                    field=models.CharField(blank=True, default="", max_length=120),
                ),
            ],
        ),
    ]
