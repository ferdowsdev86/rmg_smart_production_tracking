from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("employees", "0002_stationassignment_employee_id_charfield"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AddField(
                    model_name="stationassignment",
                    name="layour_id",
                    field=models.IntegerField(db_column="layour_id"),
                ),
                migrations.AddField(
                    model_name="stationassignment",
                    name="process_id",
                    field=models.IntegerField(blank=True, null=True),
                ),
                migrations.AlterField(
                    model_name="stationassignment",
                    name="employee_id",
                    field=models.CharField(blank=True, max_length=100, null=True),
                ),
                migrations.AlterModelTable(
                    name="stationassignment",
                    table="employees_stationassignment",
                ),
            ],
            database_operations=[],
        ),
    ]
