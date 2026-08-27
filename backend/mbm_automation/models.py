from django.db import models


class FabricDefect(models.Model):
    """Unmanaged mirror of `mbm_automation.fabricdifact`."""

    id = models.BigAutoField(primary_key=True)
    fabric_roll_id = models.CharField(max_length=128, blank=True, default="")
    defect_code = models.CharField(max_length=64, blank=True, null=True, db_index=True)
    defect_name = models.CharField(max_length=255, blank=True, default="")
    defect_qty = models.PositiveIntegerField(default=0)
    remarks = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(blank=True, null=True)
    updated_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = "fabricdifact"


class LineLayout(models.Model):
    """Unmanaged mirror of `mbm_automation.line_layout` (GSD / line balancing)."""

    id = models.AutoField(primary_key=True)
    line_type = models.IntegerField()
    line_no = models.IntegerField()
    floor = models.IntegerField()
    machin_no = models.IntegerField()
    machin_name = models.CharField(max_length=100)

    class Meta:
        managed = False
        db_table = "line_layout"


class SewingLog(models.Model):
    """Unmanaged mirror of `mbm_automation.sewing_log`."""

    id = models.BigAutoField(primary_key=True)
    machin_id = models.BigIntegerField(blank=True, null=True, db_index=True)
    machin_user = models.CharField(max_length=128, blank=True, default="")
    logged_at = models.DateTimeField(blank=True, null=True, db_index=True)
    flag1 = models.PositiveSmallIntegerField(default=0)
    flag2 = models.PositiveSmallIntegerField(default=0)
    flag3 = models.PositiveSmallIntegerField(default=0)
    flag4 = models.PositiveSmallIntegerField(default=0)
    flag5 = models.PositiveSmallIntegerField(default=0)
    flag6 = models.PositiveSmallIntegerField(default=0)
    flag7 = models.PositiveSmallIntegerField(default=0)
    flag8 = models.PositiveSmallIntegerField(default=0)
    # Barcode string (or legacy "0"/"1"); DB column is varchar(50).
    flag9 = models.CharField(max_length=50, blank=True, default="0")
    created_at = models.DateTimeField(blank=True, null=True)
    updated_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = "sewing_log"


class DailyTarget(models.Model):
    """Unmanaged mirror of `mbm_automation.daily_target`."""

    id = models.BigAutoField(primary_key=True)
    machin_id = models.BigIntegerField(db_index=True)
    target = models.IntegerField(default=0)
    operation_type = models.CharField(max_length=50, blank=True, default="")
    department_name = models.CharField(max_length=100, blank=True, default="")
    date = models.DateField(db_index=True)

    class Meta:
        managed = False
        db_table = "daily_target"
