from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("employees", "0005_create_employees_stationassignment_table"),
    ]

    operations = [
        migrations.DeleteModel(
            name="StationAssignment",
        ),
    ]
