from django.db import migrations, models


class Migration(migrations.Migration):
    """is_active uses 1=Active, 2=Inactive. Switch the Django field from Boolean
    to a small integer. DB column (tinyint) already stores 1/2 — state only."""

    dependencies = [
        ("floors", "0022_nptlibrary"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.AlterField(
                    model_name="machinlibrary",
                    name="is_active",
                    field=models.PositiveSmallIntegerField(default=1),
                ),
            ],
        ),
    ]
