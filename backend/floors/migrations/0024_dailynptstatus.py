from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("floors", "0023_machinlibrary_is_active_int"),
    ]

    operations = [
        migrations.CreateModel(
            name="DailyNptStatus",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("unit", models.CharField(blank=True, default="", max_length=100)),
                ("floor", models.IntegerField(default=0)),
                ("line", models.IntegerField(default=0)),
                ("date", models.DateField()),
                ("category", models.CharField(blank=True, default="", max_length=100)),
                ("npt_reason", models.CharField(blank=True, default="", max_length=255)),
                ("remarks", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "verbose_name": "daily NPT status",
                "verbose_name_plural": "daily NPT status",
                "db_table": "daily_npt_status",
                "ordering": ["-date", "-id"],
            },
        ),
    ]
