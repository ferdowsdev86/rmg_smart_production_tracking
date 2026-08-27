from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("floors", "0028_dailynptstatus_machin_id"),
    ]

    operations = [
        migrations.AddField(
            model_name="dailynptstatus",
            name="start_log_id",
            field=models.BigIntegerField(db_index=True, default=0),
        ),
        migrations.AddField(
            model_name="dailynptstatus",
            name="stop_log_id",
            field=models.BigIntegerField(default=0),
        ),
    ]
