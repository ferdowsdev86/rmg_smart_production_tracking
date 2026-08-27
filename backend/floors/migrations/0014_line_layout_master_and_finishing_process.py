"""linelayouttemplate_master/detail tables; finishing_process process_name + machin_type."""

from django.db import migrations, models
import django.db.models.deletion


def _column_names(schema_editor, table):
    with schema_editor.connection.cursor() as cursor:
        return {
            col.name
            for col in schema_editor.connection.introspection.get_table_description(cursor, table)
        }


def create_line_layout_tables(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        tables = connection.introspection.table_names(cursor)
    if "linelayouttemplate_master" in tables and "linelayouttemplate_detail" in tables:
        return
    LineLayoutTemplateMaster = apps.get_model("floors", "LineLayoutTemplateMaster")
    LineLayoutTemplateDetail = apps.get_model("floors", "LineLayoutTemplateDetail")
    if "linelayouttemplate_master" not in tables:
        schema_editor.create_model(LineLayoutTemplateMaster)
    if "linelayouttemplate_detail" not in tables:
        schema_editor.create_model(LineLayoutTemplateDetail)


def ensure_machin_type_on_finishing_process(apps, schema_editor):
    table = "finishing_process"
    with schema_editor.connection.cursor() as cursor:
        tables = schema_editor.connection.introspection.table_names(cursor)
    if table not in tables:
        return
    if "machin_type" in _column_names(schema_editor, table):
        return
    FinishingProcess = apps.get_model("floors", "FinishingProcess")
    field = models.CharField(max_length=50, blank=True, default="")
    field.set_attributes_from_name("machin_type")
    schema_editor.add_field(FinishingProcess, field)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("floors", "0013_align_finishing_process_model"),
    ]

    operations = [
        migrations.RunPython(ensure_machin_type_on_finishing_process, noop_reverse),
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.RenameField(
                    model_name="finishingprocess",
                    old_name="name",
                    new_name="process_name",
                ),
                migrations.AlterField(
                    model_name="finishingprocess",
                    name="process_name",
                    field=models.CharField(db_column="process_name", max_length=200),
                ),
                migrations.AddField(
                    model_name="finishingprocess",
                    name="machin_type",
                    field=models.CharField(blank=True, default="", max_length=50),
                ),
            ],
        ),
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.CreateModel(
                    name="LineLayoutTemplateMaster",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("unit", models.CharField(blank=True, default="", max_length=100)),
                        ("style", models.CharField(blank=True, default="", max_length=100)),
                        ("product", models.CharField(blank=True, default="", max_length=100)),
                        ("product_type", models.CharField(blank=True, db_index=True, default="", max_length=30)),
                        ("layout_date", models.DateField()),
                        ("created_at", models.DateTimeField(auto_now_add=True)),
                        ("updated_at", models.DateTimeField(auto_now=True)),
                        (
                            "floor",
                            models.ForeignKey(
                                db_column="floor_id",
                                on_delete=django.db.models.deletion.CASCADE,
                                related_name="line_layout_masters",
                                to="floors.floor",
                            ),
                        ),
                        (
                            "line",
                            models.ForeignKey(
                                db_column="line_id",
                                on_delete=django.db.models.deletion.CASCADE,
                                related_name="line_layout_masters",
                                to="floors.line",
                            ),
                        ),
                    ],
                    options={
                        "db_table": "linelayouttemplate_master",
                        "ordering": ["-layout_date", "-id"],
                    },
                ),
                migrations.CreateModel(
                    name="LineLayoutTemplateDetail",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("process_name", models.CharField(max_length=200)),
                        ("sam", models.CharField(blank=True, db_column="SAM", default="", max_length=120)),
                        ("machin_type", models.CharField(blank=True, default="", max_length=50)),
                        ("display_order", models.PositiveSmallIntegerField(default=0)),
                        (
                            "finishing_process",
                            models.ForeignKey(
                                db_column="process_id",
                                on_delete=django.db.models.deletion.PROTECT,
                                related_name="layout_details",
                                to="floors.finishingprocess",
                            ),
                        ),
                        (
                            "master",
                            models.ForeignKey(
                                db_column="layout_id",
                                on_delete=django.db.models.deletion.CASCADE,
                                related_name="details",
                                to="floors.linelayouttemplatemaster",
                            ),
                        ),
                    ],
                    options={
                        "db_table": "linelayouttemplate_detail",
                        "ordering": ["display_order", "id"],
                    },
                ),
            ],
        ),
        migrations.RunPython(create_line_layout_tables, noop_reverse),
    ]
