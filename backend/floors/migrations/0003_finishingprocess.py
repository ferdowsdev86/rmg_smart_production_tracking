from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("floors", "0002_workstation_required_skill_level_linelayouttemplate"),
    ]

    operations = [
        migrations.CreateModel(
            name="FinishingProcess",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("display_order", models.PositiveSmallIntegerField(help_text="Process sequence on the finishing line (1–15).")),
                ("slug", models.SlugField(max_length=64, unique=True)),
                ("name", models.CharField(max_length=200)),
                ("station_count", models.PositiveSmallIntegerField(default=1)),
                ("code", models.CharField(help_text="Station code prefix, e.g. LC", max_length=8)),
                ("caption", models.CharField(blank=True, default="", max_length=200)),
                ("legend_label", models.CharField(max_length=80)),
                ("panel", models.CharField(default="bg-slate-50 border-slate-300", max_length=120)),
                ("title_bar", models.CharField(default="bg-slate-200 text-slate-900", max_length=120)),
                ("tile", models.CharField(default="bg-slate-400 border-slate-600", max_length=120)),
                ("tile_muted", models.CharField(default="bg-slate-200 border-slate-400", max_length=120)),
                ("is_active", models.BooleanField(default=True)),
            ],
            options={
                "verbose_name": "finishing process",
                "verbose_name_plural": "finishing processes",
                "db_table": "finishing_process",
                "ordering": ["display_order"],
            },
        ),
        migrations.AddConstraint(
            model_name="finishingprocess",
            constraint=models.UniqueConstraint(fields=("display_order",), name="uniq_finishing_process_order"),
        ),
    ]
