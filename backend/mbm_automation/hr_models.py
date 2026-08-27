"""Unmanaged mirrors of cuttingedgedb HR tables."""

from django.db import models


class HrAsBasicInfo(models.Model):
    as_id = models.AutoField(primary_key=True)
    associate_id = models.CharField(max_length=10, blank=True, null=True)
    temp_id = models.CharField(max_length=6, blank=True, null=True)
    as_designation_id = models.IntegerField(blank=True, null=True)
    as_name = models.CharField(max_length=64, blank=True, null=True)
    as_pic = models.CharField(max_length=255, blank=True, null=True)
    as_rfid_code = models.CharField(max_length=20, blank=True, null=True)
    worker_id = models.IntegerField(blank=True, null=True)
    deleted_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = "hr_as_basic_info"


class HrDesignation(models.Model):
    hr_designation_id = models.AutoField(primary_key=True)
    hr_designation_name = models.CharField(max_length=128, blank=True, null=True)
    hr_designation_name_bn = models.CharField(max_length=255, blank=True, null=True)
    designation_short_name = models.CharField(max_length=100, blank=True, null=True)
    hr_designation_status = models.SmallIntegerField(default=1)
    deleted_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = "hr_designation"


class HrFloor(models.Model):
    hr_floor_id = models.AutoField(primary_key=True)
    hr_floor_unit_id = models.IntegerField(blank=True, null=True)
    hr_floor_name = models.CharField(max_length=128, blank=True, null=True)
    hr_floor_status = models.SmallIntegerField(default=1)
    serial = models.IntegerField(blank=True, null=True)
    hr_floor_active = models.SmallIntegerField(blank=True, null=True)
    deleted_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = "hr_floor"


class HrLine(models.Model):
    hr_line_id = models.AutoField(primary_key=True)
    hr_line_unit_id = models.IntegerField(blank=True, null=True)
    hr_line_floor_id = models.IntegerField(blank=True, null=True)
    hr_line_name = models.CharField(max_length=64, blank=True, null=True)
    serial = models.IntegerField(blank=True, null=True)
    hr_line_status = models.SmallIntegerField(default=1)
    deleted_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = "hr_line"


class PtSewingDailyLineTarget(models.Model):
    id = models.AutoField(primary_key=True)
    hr_unit_id = models.IntegerField(blank=True, null=True)
    hr_floor_id = models.IntegerField(blank=True, null=True, db_index=True)
    hr_line_id = models.IntegerField(blank=True, null=True, db_index=True)
    production_date = models.DateField(blank=True, null=True, db_index=True)
    target_qty = models.IntegerField(default=0)
    plan_target = models.IntegerField(default=0)

    class Meta:
        managed = False
        db_table = "pt_sewing_daily_line_targets"


class DailyLineStyleTarget(models.Model):
    id = models.AutoField(primary_key=True)
    pt_sewing_id = models.IntegerField(blank=True, null=True, db_index=True)
    style_id = models.IntegerField(blank=True, null=True)
    production_date = models.DateField(blank=True, null=True, db_index=True)
    target_qty = models.IntegerField(default=0)
    stl_no = models.CharField(max_length=255, blank=True, default="")
    deleted_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = "daily_line_style_targets"
