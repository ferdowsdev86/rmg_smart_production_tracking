from django.db import migrations, models


class Migration(migrations.Migration):
    """npt_library.catogery_id already exists in the DB — sync model state only."""

    dependencies = [
        ("floors", "0024_dailynptstatus"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.AddField(
                    model_name="nptlibrary",
                    name="catogery_id",
                    field=models.IntegerField(db_column="catogery_id", default=0),
                ),
            ],
        ),
    ]
