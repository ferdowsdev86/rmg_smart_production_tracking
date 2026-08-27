import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("floors", "0017_day_line_target"),
    ]

    operations = [
        migrations.CreateModel(
            name="Machine",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("machine_code", models.CharField(help_text="Asset/tag number", max_length=30, unique=True)),
                (
                    "machine_type",
                    models.CharField(
                        choices=[
                            ("SNLS", "Single Needle Lock Stitch"),
                            ("DNLS", "Double Needle Lock Stitch"),
                            ("OL", "Over Lock"),
                            ("FL", "Flat Lock"),
                            ("BH", "Button Hole"),
                            ("BS", "Button Stitch"),
                            ("BT", "Bartack"),
                            ("KANSAI", "Kansai Special"),
                            ("FOA", "Feed of the Arm"),
                            ("OTHER", "Other"),
                        ],
                        default="SNLS",
                        max_length=20,
                    ),
                ),
                ("brand", models.CharField(blank=True, default="", max_length=50)),
                ("model_no", models.CharField(blank=True, default="", max_length=50)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "floor",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="machines",
                        to="floors.floor",
                    ),
                ),
            ],
            options={
                "ordering": ["machine_code"],
            },
        ),
    ]
