from django.db import migrations, models


def copy_employee_emp_id(apps, schema_editor):
    StationAssignment = apps.get_model("employees", "StationAssignment")
    Employee = apps.get_model("employees", "Employee")
    for sa in StationAssignment.objects.all():
        emp_pk = sa.employee_id
        try:
            emp = Employee.objects.get(pk=emp_pk)
            sa.employee_associate_id = (emp.emp_id or str(emp_pk)).strip()
        except Employee.DoesNotExist:
            sa.employee_associate_id = str(emp_pk)
        sa.save(update_fields=["employee_associate_id"])


class Migration(migrations.Migration):

    dependencies = [
        ("employees", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="stationassignment",
            name="employee_associate_id",
            field=models.CharField(blank=True, default="", max_length=50),
        ),
        migrations.RunPython(copy_employee_emp_id, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name="stationassignment",
            name="employee",
        ),
        migrations.RenameField(
            model_name="stationassignment",
            old_name="employee_associate_id",
            new_name="employee_id",
        ),
        migrations.AlterField(
            model_name="stationassignment",
            name="employee_id",
            field=models.CharField(max_length=50),
        ),
    ]
