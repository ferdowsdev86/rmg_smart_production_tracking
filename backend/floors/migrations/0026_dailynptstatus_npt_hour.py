from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("floors", "0025_nptlibrary_catogery_id"),
    ]

    operations = [
        migrations.AddField(
            model_name="dailynptstatus",
            name="npt_hour",
            field=models.FloatField(default=0, help_text="Total NPT in hours"),
        ),
    ]
