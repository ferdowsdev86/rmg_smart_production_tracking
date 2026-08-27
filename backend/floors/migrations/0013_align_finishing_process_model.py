"""Align FinishingProcess model with legacy finishing_process table (MySQL)."""

from django.db import migrations, models


def _column_names(schema_editor, table):
    with schema_editor.connection.cursor() as cursor:
        return {
            col.name
            for col in schema_editor.connection.introspection.get_table_description(cursor, table)
        }


def ensure_finishing_process_columns(apps, schema_editor):
    """Add product_type / SAM on DB if an old schema is missing them."""
    table = "finishing_process"
    connection = schema_editor.connection
    vendor = connection.vendor

    with connection.cursor() as cursor:
        tables = connection.introspection.table_names(cursor)
    if table not in tables:
        return

    existing = _column_names(schema_editor, table)
    with connection.cursor() as cursor:
        if "product_type" not in existing:
            if vendor == "mysql":
                cursor.execute(
                    f"ALTER TABLE `{table}` ADD COLUMN `product_type` varchar(30) NOT NULL DEFAULT ''"
                )
            else:
                cursor.execute(
                    f'ALTER TABLE "{table}" ADD COLUMN "product_type" varchar(30) NOT NULL DEFAULT \'\''
                )
        if "SAM" not in existing and "sam" not in existing:
            if vendor == "mysql":
                cursor.execute(
                    f"ALTER TABLE `{table}` ADD COLUMN `SAM` varchar(120) NOT NULL DEFAULT ''"
                )
            else:
                cursor.execute(
                    f'ALTER TABLE "{table}" ADD COLUMN "SAM" varchar(120) NOT NULL DEFAULT \'\''
                )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("floors", "0012_rename_layout_name_to_process_name"),
    ]

    operations = [
        migrations.RunPython(ensure_finishing_process_columns, noop_reverse),
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.RemoveConstraint(
                    model_name="finishingprocess",
                    name="uniq_finishing_process_order",
                ),
                migrations.RemoveField(model_name="finishingprocess", name="slug"),
                migrations.RemoveField(model_name="finishingprocess", name="caption"),
                migrations.RemoveField(model_name="finishingprocess", name="legend_label"),
                migrations.RemoveField(model_name="finishingprocess", name="panel"),
                migrations.RemoveField(model_name="finishingprocess", name="title_bar"),
                migrations.RemoveField(model_name="finishingprocess", name="tile"),
                migrations.RemoveField(model_name="finishingprocess", name="tile_muted"),
                migrations.AddField(
                    model_name="finishingprocess",
                    name="product_type",
                    field=models.CharField(blank=True, default="", max_length=30),
                ),
                migrations.AddField(
                    model_name="finishingprocess",
                    name="sam",
                    field=models.CharField(
                        blank=True,
                        db_column="SAM",
                        default="",
                        help_text="Standard allowed minutes (SAM).",
                        max_length=120,
                    ),
                ),
                migrations.AlterField(
                    model_name="finishingprocess",
                    name="name",
                    field=models.CharField(max_length=200),
                ),
                migrations.AlterField(
                    model_name="finishingprocess",
                    name="display_order",
                    field=models.PositiveSmallIntegerField(
                        help_text="Process sequence on the finishing line (1–15)."
                    ),
                ),
                migrations.AlterModelOptions(
                    name="finishingprocess",
                    options={
                        "ordering": ["display_order"],
                        "verbose_name": "finishing process",
                        "verbose_name_plural": "finishing processes",
                    },
                ),
            ],
        ),
    ]
