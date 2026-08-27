from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("floors", "0015_linelayoutdetail_no_of_workstation"),
    ]

    operations = [
        migrations.RunSQL(
            sql="DROP TABLE IF EXISTS camera_data;",
            reverse_sql=migrations.RunSQL.noop,
        ),
        migrations.CreateModel(
            name="CameraData",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("unit", models.CharField(blank=True, default="", max_length=50)),
                ("floor", models.CharField(blank=True, default="", max_length=100)),
                ("line", models.CharField(blank=True, default="", max_length=100)),
                ("workstation_id", models.CharField(blank=True, default="", max_length=50)),
                ("employee_id", models.CharField(blank=True, default="", max_length=50)),
                ("intime", models.TimeField(blank=True, null=True)),
                ("outtime", models.TimeField(blank=True, null=True)),
                ("camera_id", models.CharField(blank=True, default="", max_length=50)),
                ("date", models.DateField()),
            ],
            options={
                "db_table": "camera_data",
                "ordering": ["-date", "-id"],
                "indexes": [
                    models.Index(fields=["date"], name="idx_camera_data_date"),
                    models.Index(fields=["floor", "line"], name="idx_camera_data_floor_line"),
                    models.Index(fields=["workstation_id"], name="idx_camera_data_workstation"),
                    models.Index(fields=["employee_id"], name="idx_camera_data_employee"),
                    models.Index(fields=["camera_id"], name="idx_camera_data_camera"),
                ],
            },
        ),
    ]
