# Align Django model state with legacy floors_linelayouttemplate (no DB ALTER on MySQL).

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("floors", "0010_linelayouttemplate_mysql_columns"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.AlterModelOptions(
                    name="linelayouttemplate",
                    options={"ordering": ["-updated_at", "-created_at"]},
                ),
                migrations.AlterModelOptions(
                    name="productionentry",
                    options={"ordering": ["-date", "-hour"]},
                ),
                migrations.RemoveConstraint(
                    model_name="productionentry",
                    name="uniq_production_line_station_date_hour",
                ),
                migrations.AlterField(
                    model_name="linelayouttemplate",
                    name="floor",
                    field=models.ForeignKey(
                        blank=True,
                        db_column="floor_id",
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="layout_templates",
                        to="floors.floor",
                    ),
                ),
                migrations.AlterField(
                    model_name="linelayouttemplate",
                    name="layout_name",
                    field=models.CharField(
                        blank=True,
                        db_column="process_name",
                        default="",
                        max_length=120,
                    ),
                ),
                migrations.AlterField(
                    model_name="linelayouttemplate",
                    name="stations",
                    field=models.JSONField(
                        blank=True,
                        default=list,
                        help_text="Sewing slots or finishing process blocks (JSON).",
                        null=True,
                    ),
                ),
            ],
        ),
    ]
