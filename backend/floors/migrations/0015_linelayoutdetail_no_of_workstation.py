from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("floors", "0014_line_layout_master_and_finishing_process"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AddField(
                    model_name="linelayouttemplatedetail",
                    name="no_of_workstation",
                    field=models.PositiveIntegerField(blank=True, default=1, null=True),
                ),
            ],
            database_operations=[],
        ),
    ]
