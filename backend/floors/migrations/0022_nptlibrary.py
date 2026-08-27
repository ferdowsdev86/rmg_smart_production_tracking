from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("floors", "0021_machinlibrary_unit_ownership"),
    ]

    operations = [
        migrations.CreateModel(
            name="NptLibrary",
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
                ("category", models.CharField(blank=True, default="", max_length=100)),
                ("npt_reason", models.CharField(blank=True, default="", max_length=255)),
            ],
            options={
                "verbose_name": "NPT library entry",
                "verbose_name_plural": "NPT library entries",
                "db_table": "npt_library",
                "ordering": ["category", "npt_reason"],
            },
        ),
    ]
