from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("floors", "0026_dailynptstatus_npt_hour"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AddField(
                    model_name="dailynptstatus",
                    name="machin_id",
                    field=models.IntegerField(db_index=True, default=0),
                ),
            ],
            database_operations=[],
        ),
    ]
