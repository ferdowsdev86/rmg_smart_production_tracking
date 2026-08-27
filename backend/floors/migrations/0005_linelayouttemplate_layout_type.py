"""Add layout_type and updated_at to floors_linelayouttemplate (safe for partial schemas)."""

from django.db import migrations, models


def _column_names(schema_editor, table):
    with schema_editor.connection.cursor() as cursor:
        return {
            col.name
            for col in schema_editor.connection.introspection.get_table_description(cursor, table)
        }


def align_linelayouttemplate(apps, schema_editor):
    table = "floors_linelayouttemplate"
    connection = schema_editor.connection

    with connection.cursor() as cursor:
        tables = connection.introspection.table_names(cursor)
    if table not in tables:
        return

    existing = _column_names(schema_editor, table)
    LineLayoutTemplate = apps.get_model("floors", "LineLayoutTemplate")

    if "layout_type" not in existing:
        field = models.CharField(
            max_length=20,
            choices=[("sewing", "Sewing line"), ("finishing", "Finishing line")],
            default="sewing",
            db_index=True,
        )
        field.set_attributes_from_name("layout_type")
        schema_editor.add_field(LineLayoutTemplate, field)

    if "updated_at" not in existing:
        field = models.DateTimeField(auto_now=True)
        field.set_attributes_from_name("updated_at")
        schema_editor.add_field(LineLayoutTemplate, field)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("floors", "0004_align_finishing_process_table"),
    ]

    operations = [
        migrations.RunPython(align_linelayouttemplate, noop_reverse),
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.AddField(
                    model_name="linelayouttemplate",
                    name="layout_type",
                    field=models.CharField(
                        choices=[("sewing", "Sewing line"), ("finishing", "Finishing line")],
                        db_index=True,
                        default="sewing",
                        max_length=20,
                    ),
                ),
                migrations.AddField(
                    model_name="linelayouttemplate",
                    name="updated_at",
                    field=models.DateTimeField(auto_now=True),
                ),
                migrations.AlterModelTable(
                    name="linelayouttemplate",
                    table="floors_linelayouttemplate",
                ),
            ],
        ),
    ]
