from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("floors", "0016_cameradata"),
    ]

    # day_line_target is maintained outside Django (managed = False), so this is
    # a state-only model definition — no schema is created/altered by Django.
    operations = [
        migrations.CreateModel(
            name="DayLineTarget",
            fields=[
                ("id", models.AutoField(primary_key=True, serialize=False)),
                ("floor", models.IntegerField()),
                ("line", models.IntegerField()),
                ("date", models.DateField()),
                ("style", models.CharField(blank=True, default="", max_length=100)),
                ("target_qty", models.IntegerField(default=0)),
                ("layout_id", models.IntegerField(default=0)),
            ],
            options={
                "db_table": "day_line_target",
                "ordering": ["-date", "floor", "line"],
                "managed": False,
            },
        ),
    ]
