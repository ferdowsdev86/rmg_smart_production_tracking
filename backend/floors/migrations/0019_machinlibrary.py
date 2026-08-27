from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("floors", "0018_machine"),
    ]

    operations = [
        migrations.CreateModel(
            name="MachinLibrary",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("machin_no", models.IntegerField()),
                ("machin_name", models.CharField(blank=True, default="", max_length=100)),
                ("brand", models.CharField(blank=True, default="", max_length=100)),
                ("model_no", models.CharField(blank=True, default="", max_length=100)),
                ("floor", models.IntegerField(default=0)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "db_table": "machin_library",
                "ordering": ["machin_no"],
                "verbose_name": "machine library entry",
                "verbose_name_plural": "machine library entries",
            },
        ),
    ]
