"""Rename model field layout_name → process_name (legacy DB column `process_name`)."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("floors", "0011_alter_linelayouttemplate_options_and_more"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.RenameField(
                    model_name="linelayouttemplate",
                    old_name="layout_name",
                    new_name="process_name",
                ),
                migrations.AlterField(
                    model_name="linelayouttemplate",
                    name="process_name",
                    field=models.CharField(
                        blank=True,
                        db_column="process_name",
                        default="",
                        max_length=120,
                    ),
                ),
            ],
        ),
    ]
