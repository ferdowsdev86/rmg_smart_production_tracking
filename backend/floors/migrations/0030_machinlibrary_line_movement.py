from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("floors", "0029_dailynptstatus_event_log_ids"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AddField(
                    model_name="machinlibrary",
                    name="line",
                    field=models.IntegerField(default=0),
                ),
                migrations.AddField(
                    model_name="machinlibrary",
                    name="supplier_name",
                    field=models.CharField(blank=True, default="", max_length=100),
                ),
                migrations.AddField(
                    model_name="machinlibrary",
                    name="install_date",
                    field=models.DateField(blank=True, null=True),
                ),
                migrations.AddField(
                    model_name="machinlibrary",
                    name="movement_date",
                    field=models.DateTimeField(blank=True, null=True),
                ),
            ],
            database_operations=[],
        ),
    ]
