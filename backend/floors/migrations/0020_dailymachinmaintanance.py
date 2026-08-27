from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("floors", "0019_machinlibrary"),
    ]

    operations = [
        migrations.CreateModel(
            name="DailyMachinMaintanance",
            fields=[
                ("id", models.BigAutoField(primary_key=True, serialize=False)),
                ("maintenance_date", models.DateField()),
                ("machine_id", models.BigIntegerField(db_index=True)),
                ("operator_id", models.BigIntegerField(blank=True, null=True)),
                ("mechanic_id", models.BigIntegerField(blank=True, null=True)),
                ("shift", models.CharField(blank=True, default="", max_length=20)),
                ("machine_status", models.CharField(blank=True, default="", max_length=20)),
                ("remarks", models.TextField(blank=True, default="")),
                ("created_by", models.BigIntegerField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "db_table": "daily_machin_maintanance",
                "ordering": ["-maintenance_date", "-id"],
                "verbose_name": "daily machine maintenance",
                "verbose_name_plural": "daily machine maintenance",
            },
        ),
    ]
