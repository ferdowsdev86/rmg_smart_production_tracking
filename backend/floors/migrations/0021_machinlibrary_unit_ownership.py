from django.db import migrations, models


class Migration(migrations.Migration):
    """`owner` and `unit` int columns already exist on machin_library (added
    externally). Sync Django's model state only — no DDL."""

    dependencies = [
        ("floors", "0020_dailymachinmaintanance"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.AddField(
                    model_name="machinlibrary",
                    name="unit",
                    field=models.IntegerField(blank=True, db_column="unit", null=True),
                ),
                migrations.AddField(
                    model_name="machinlibrary",
                    name="owner",
                    field=models.IntegerField(blank=True, db_column="owner", null=True),
                ),
            ],
        ),
    ]
