"""Align employee_id (user_id) and legacy ERP columns on floors_linelayouttemplate."""

from django.db import migrations, models


def _column_names(schema_editor, table):
    with schema_editor.connection.cursor() as cursor:
        return {
            col.name
            for col in schema_editor.connection.introspection.get_table_description(cursor, table)
        }


def align_employee_and_legacy_columns(apps, schema_editor):
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

    if "status" not in existing:
        field = models.IntegerField(default=1)
        field.set_attributes_from_name("status")
        schema_editor.add_field(LineLayoutTemplate, field)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("floors", "0007_linelayouttemplate_layout_name"),
    ]

    operations = [
        migrations.RunPython(align_employee_and_legacy_columns, noop_reverse),
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.RenameField(
                    model_name="linelayouttemplate",
                    old_name="name",
                    new_name="employee_id",
                ),
                migrations.AlterField(
                    model_name="linelayouttemplate",
                    name="employee_id",
                    field=models.CharField(
                        blank=True,
                        db_column="user_id",
                        default="",
                        max_length=120,
                    ),
                ),
                migrations.AddField(
                    model_name="linelayouttemplate",
                    name="stations_id",
                    field=models.IntegerField(default=0, help_text="Legacy counter / preset id"),
                ),
                migrations.AddField(
                    model_name="linelayouttemplate",
                    name="line_id",
                    field=models.IntegerField(default=0, help_text="Line number on floor"),
                ),
                migrations.AddField(
                    model_name="linelayouttemplate",
                    name="status",
                    field=models.IntegerField(default=1, help_text="1=active, 0=inactive"),
                ),
            ],
        ),
    ]
