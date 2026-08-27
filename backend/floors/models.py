from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from core.env import config
from .constants import OPERATION_CHOICES

# Legacy ERP MySQL column names differ from local SQLite schema.
_PROCESS_NAME_DB_COLUMN = (
    "layout_name" if config("USE_SQLITE", default=False, cast=bool) else "process_name"
)
_USE_SQLITE = config("USE_SQLITE", default=False, cast=bool)
_OPERATION_TYPE_DB_COLUMN = "operation_type" if _USE_SQLITE else "operation_type_id"
_MACHINE_TYPE_DB_COLUMN = "machine_type" if _USE_SQLITE else "machine_type_id"


class Floor(models.Model):
    name = models.CharField(max_length=100)
    total_lines = models.IntegerField(default=8)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class Line(models.Model):
    floor = models.ForeignKey(Floor, on_delete=models.CASCADE, related_name="lines")
    line_number = models.IntegerField()
    name = models.CharField(max_length=50)
    daily_target = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["floor", "line_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["floor", "line_number"],
                name="uniq_floor_line_number",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.floor.name} — {self.name}"


class WorkStation(models.Model):
    line = models.ForeignKey(Line, on_delete=models.CASCADE, related_name="stations")
    station_number = models.IntegerField()
    operation_type = models.CharField(
        max_length=50,
        choices=OPERATION_CHOICES,
        db_column=_OPERATION_TYPE_DB_COLUMN,
    )
    machine_type = models.CharField(max_length=100, db_column=_MACHINE_TYPE_DB_COLUMN)
    standard_time = models.FloatField(help_text="SAM in minutes")
    required_skill_level = models.PositiveSmallIntegerField(
        default=1,
        validators=[MinValueValidator(1), MaxValueValidator(5)],
        help_text="Required operator skill level (1–5)",
    )

    if _USE_SQLITE:
        position_x = models.FloatField(default=0)
        position_y = models.FloatField(default=0)
        symbol_icon = models.CharField(max_length=50, blank=True, default="")

    class Meta:
        ordering = ["line", "station_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["line", "station_number"],
                name="uniq_line_station_number",
            ),
        ]

    def __str__(self) -> str:
        op = self.operation_type
        try:
            op = self.get_operation_type_display()
        except Exception:
            pass
        return f"{self.line.name} — S{self.station_number} ({op})"


class LineLayoutTemplate(models.Model):
    """
    floors_linelayouttemplate (legacy ERP columns + stations JSON).
    `user_id` = employee id; `process_name` = process label; `layout_type` = sewing|finishing.
    """

    class LayoutType(models.TextChoices):
        SEWING = "sewing", "Sewing line"
        FINISHING = "finishing", "Finishing line"

    employee_id = models.CharField(max_length=120, db_column="user_id", blank=True, default="")
    process_name = models.CharField(
        max_length=120,
        blank=True,
        default="",
        db_column=_PROCESS_NAME_DB_COLUMN,
    )
    stations_id = models.IntegerField(default=0, help_text="Legacy counter / preset id")
    floor = models.ForeignKey(
        Floor,
        on_delete=models.CASCADE,
        related_name="layout_templates",
        null=True,
        blank=True,
        db_column="floor_id",
    )
    line_id = models.IntegerField(default=0, help_text="Line number on floor")
    status = models.IntegerField(default=1, help_text="1=active, 0=inactive")
    layout_type = models.CharField(
        max_length=20,
        choices=LayoutType.choices,
        default=LayoutType.SEWING,
        db_index=True,
    )
    stations = models.JSONField(
        default=list,
        blank=True,
        null=True,
        help_text="Sewing slots or finishing process blocks (JSON).",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "floors_linelayouttemplate"
        ordering = ["-updated_at", "-created_at"]

    def __str__(self) -> str:
        return self.process_name or self.get_layout_type_display() or self.employee_id or f"Layout #{self.pk}"

    @property
    def layout_name(self) -> str:
        """Display label for list UI — sourced from layout_type."""
        return self.get_layout_type_display() or self.layout_type or ""


class FinishingProcess(models.Model):
    """
    finishing_process (legacy ERP table).
    Columns: process_name, SAM, machin_type, product_type, display_order, is_active, …
    """

    process_name = models.CharField(max_length=200, db_column="process_name")
    station_count = models.PositiveSmallIntegerField(default=1)
    code = models.CharField(max_length=8, help_text="Station code prefix, e.g. LC")
    product_type = models.CharField(max_length=30, blank=True, default="")
    display_order = models.PositiveSmallIntegerField(
        help_text="Process sequence on the finishing line (1–15)."
    )
    sam = models.CharField(
        max_length=120,
        blank=True,
        default="",
        db_column="SAM",
        help_text="Standard allowed minutes (SAM).",
    )
    machin_type = models.CharField(max_length=50, blank=True, default="")
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "finishing_process"
        ordering = ["display_order"]
        verbose_name = "finishing process"
        verbose_name_plural = "finishing processes"

    def __str__(self) -> str:
        return f"{self.display_order}. {self.process_name}"

    @property
    def name(self) -> str:
        """Backward-compatible alias for dashboards / serializers."""
        return self.process_name

    @property
    def slug(self) -> str:
        return f"process-{self.pk}"


class LineLayoutTemplateMaster(models.Model):
    """linelayouttemplate_master — unit, style, product, floor, line, date."""

    unit = models.CharField(max_length=100, blank=True, default="")
    style = models.CharField(max_length=100, blank=True, default="")
    product = models.CharField(max_length=100, blank=True, default="")
    product_type = models.CharField(max_length=30, db_index=True, blank=True, default="")
    layout_date = models.DateField()
    floor = models.ForeignKey(
        Floor,
        on_delete=models.CASCADE,
        related_name="line_layout_masters",
        db_column="floor_id",
    )
    line = models.ForeignKey(
        Line,
        on_delete=models.CASCADE,
        related_name="line_layout_masters",
        db_column="line_id",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "linelayouttemplate_master"
        ordering = ["-layout_date", "-id"]

    def __str__(self) -> str:
        return f"Layout #{self.pk} · {self.product_type} · {self.layout_date}"


class LineLayoutTemplateDetail(models.Model):
    """linelayouttemplate_detail — process lines per layout."""

    master = models.ForeignKey(
        LineLayoutTemplateMaster,
        on_delete=models.CASCADE,
        related_name="details",
        db_column="layout_id",
    )
    finishing_process = models.ForeignKey(
        FinishingProcess,
        on_delete=models.PROTECT,
        related_name="layout_details",
        db_column="process_id",
    )
    process_name = models.CharField(max_length=200)
    sam = models.CharField(max_length=120, blank=True, default="", db_column="SAM")
    machin_type = models.CharField(max_length=50, blank=True, default="")
    display_order = models.PositiveSmallIntegerField(default=0)
    no_of_workstation = models.PositiveIntegerField(default=1, blank=True, null=True)

    class Meta:
        db_table = "linelayouttemplate_detail"
        ordering = ["display_order", "id"]

    def __str__(self) -> str:
        return f"{self.master_id} · {self.process_name}"


class LineLayoutTemplateDetailWorkstation(models.Model):
    """linelayouttemplate_detail_workstation — employee per layout process workstation slot."""

    id = models.BigIntegerField(primary_key=True)
    layout_id = models.BigIntegerField()
    process_id = models.BigIntegerField()
    workstation_id = models.IntegerField(blank=True, null=True)
    employee_id = models.CharField(max_length=50)
    date = models.DateField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = "linelayouttemplate_detail_workstation"
        ordering = ["layout_id", "process_id", "workstation_id"]

    def __str__(self) -> str:
        return f"Layout {self.layout_id} P{self.process_id} WS{self.workstation_id} → {self.employee_id}"


class MachinManpowerLayout(models.Model):
    """machin_manpower_layout — machine + employee assignment per layout detail."""

    id = models.AutoField(primary_key=True)
    line_type = models.IntegerField()
    line_no = models.IntegerField()
    floor = models.IntegerField()
    machin_no = models.IntegerField()
    employee_id = models.CharField(max_length=100)
    date = models.DateTimeField()
    layout_id = models.IntegerField()
    layouttemplete_id = models.IntegerField(
        help_text="linelayouttemplate_detail.id (legacy column name)."
    )

    class Meta:
        managed = False
        db_table = "machin_manpower_layout"
        ordering = ["layout_id", "layouttemplete_id", "machin_no"]

    def __str__(self) -> str:
        return f"Layout {self.layout_id} · machine {self.machin_no} → {self.employee_id}"


class CameraData(models.Model):
    """Camera in/out records — smartfinishinfloor.camera_data."""

    unit = models.CharField(max_length=50, blank=True, default="")
    floor = models.CharField(max_length=100, blank=True, default="")
    line = models.CharField(max_length=100, blank=True, default="")
    workstation_id = models.CharField(max_length=50, blank=True, default="")
    employee_id = models.CharField(max_length=50, blank=True, default="")
    intime = models.TimeField(blank=True, null=True)
    outtime = models.TimeField(blank=True, null=True)
    camera_id = models.CharField(max_length=50, blank=True, default="")
    date = models.DateField()

    class Meta:
        db_table = "camera_data"
        ordering = ["-date", "-id"]
        indexes = [
            models.Index(fields=["date"], name="idx_camera_data_date"),
            models.Index(fields=["floor", "line"], name="idx_camera_data_floor_line"),
            models.Index(fields=["workstation_id"], name="idx_camera_data_workstation"),
            models.Index(fields=["employee_id"], name="idx_camera_data_employee"),
            models.Index(fields=["camera_id"], name="idx_camera_data_camera"),
        ]

    def __str__(self) -> str:
        return f"{self.date} · {self.employee_id} @ WS{self.workstation_id}"


class DayLineTarget(models.Model):
    """day_line_target — per-day production target by floor/line/style.

    Externally maintained (schema/data managed outside Django), so unmanaged.
    """

    id = models.AutoField(primary_key=True)
    floor = models.IntegerField()
    line = models.IntegerField()
    date = models.DateField()
    style = models.CharField(max_length=100, blank=True, default="")
    target_qty = models.IntegerField(default=0)
    layout_id = models.IntegerField(default=0)
    target_hour = models.IntegerField(default=0)
    start_time = models.TimeField(null=True, blank=True)
    break_st = models.TimeField(null=True, blank=True)
    break_end = models.TimeField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = "day_line_target"
        ordering = ["-date", "floor", "line"]

    def __str__(self) -> str:
        return f"{self.date} · F{self.floor} L{self.line} · {self.style} = {self.target_qty}"


class MachinLibrary(models.Model):
    """machin_library — machine master list (managed locally).

    ``owner`` / ``unit`` are integer columns added to the table externally.
    Convention used here: owner 1 = Owned, 2 = Rental.
    """

    OWNER_OWNED = 1
    OWNER_RENTAL = 2
    OWNER_LABELS = {OWNER_OWNED: "Owned", OWNER_RENTAL: "Rental"}

    UNIT_LABELS = {1: "MBM", 2: "CEIL", 3: "AQL"}

    # is_active: 1 = Active, 2 = Inactive
    STATUS_ACTIVE = 1
    STATUS_INACTIVE = 2
    STATUS_LABELS = {STATUS_ACTIVE: "Active", STATUS_INACTIVE: "Inactive"}

    machin_no = models.IntegerField()
    machin_name = models.CharField(max_length=100, blank=True, default="")
    brand = models.CharField(max_length=100, blank=True, default="")
    model_no = models.CharField(max_length=100, blank=True, default="")
    floor = models.IntegerField(default=0)
    line = models.IntegerField(default=0)
    unit = models.IntegerField(db_column="unit", blank=True, null=True)
    owner = models.IntegerField(db_column="owner", blank=True, null=True)
    supplier_name = models.CharField(max_length=100, blank=True, default="")
    install_date = models.DateField(blank=True, null=True)
    movement_date = models.DateTimeField(blank=True, null=True)
    is_active = models.PositiveSmallIntegerField(default=STATUS_ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "machin_library"
        ordering = ["machin_no"]
        verbose_name = "machine library entry"
        verbose_name_plural = "machine library entries"

    def __str__(self) -> str:
        return f"{self.machin_no} · {self.machin_name}"

    @property
    def ownership_label(self) -> str:
        return self.OWNER_LABELS.get(self.owner, "Unknown")

    @property
    def unit_label(self) -> str:
        return self.UNIT_LABELS.get(self.unit, "Unassigned")

    @property
    def status_label(self) -> str:
        return self.STATUS_LABELS.get(self.is_active, "Unknown")

    @property
    def is_active_flag(self) -> bool:
        return self.is_active == self.STATUS_ACTIVE


class DailyMachinMaintanance(models.Model):
    """daily_machin_maintanance — per-day machine maintenance log."""

    id = models.BigAutoField(primary_key=True)
    maintenance_date = models.DateField()
    machine_id = models.BigIntegerField(db_index=True)
    operator_id = models.BigIntegerField(blank=True, null=True)
    mechanic_id = models.BigIntegerField(blank=True, null=True)
    shift = models.CharField(max_length=20, blank=True, default="")
    machine_status = models.CharField(max_length=20, blank=True, default="")
    remarks = models.TextField(blank=True, default="")
    created_by = models.BigIntegerField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "daily_machin_maintanance"
        ordering = ["-maintenance_date", "-id"]
        verbose_name = "daily machine maintenance"
        verbose_name_plural = "daily machine maintenance"

    def __str__(self) -> str:
        return f"{self.maintenance_date} · machine {self.machine_id} · {self.machine_status}"


class ProductionEntry(models.Model):
    line = models.ForeignKey(Line, on_delete=models.CASCADE, related_name="production_entries")
    station = models.ForeignKey(WorkStation, on_delete=models.CASCADE, related_name="production_entries")
    date = models.DateField()
    hour = models.IntegerField()
    quantity = models.IntegerField(default=0)
    target = models.IntegerField(default=0)

    class Meta:
        ordering = ["-date", "-hour"]

    def __str__(self) -> str:
        return f"{self.line} {self.date} h{self.hour}"


class Machine(models.Model):
    """RMG machine master list — one row per physical machine on the floor."""

    MACHINE_TYPE_CHOICES = [
        ("SNLS", "Single Needle Lock Stitch"),
        ("DNLS", "Double Needle Lock Stitch"),
        ("OL", "Over Lock"),
        ("FL", "Flat Lock"),
        ("BH", "Button Hole"),
        ("BS", "Button Stitch"),
        ("BT", "Bartack"),
        ("KANSAI", "Kansai Special"),
        ("FOA", "Feed of the Arm"),
        ("OTHER", "Other"),
    ]

    machine_code = models.CharField(max_length=30, unique=True, help_text="Asset/tag number")
    machine_type = models.CharField(max_length=20, choices=MACHINE_TYPE_CHOICES, default="SNLS")
    brand = models.CharField(max_length=50, blank=True, default="")
    model_no = models.CharField(max_length=50, blank=True, default="")
    floor = models.ForeignKey(
        Floor,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="machines",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["machine_code"]

    def __str__(self) -> str:
        return f"{self.machine_code} · {self.get_machine_type_display()}"


class NptLibrary(models.Model):
    """npt_library — non-productive time (NPT) reason master list.

    ``catogery_id`` (spelling matches the DB column): 1 = Machine & Utility
    Related, 2 = Material Related, 3 = Production Related.
    """

    CATEGORY_MACHINE = 1
    CATEGORY_MATERIAL = 2
    CATEGORY_PRODUCTION = 3

    category = models.CharField(max_length=100, blank=True, default="")
    npt_reason = models.CharField(max_length=255, blank=True, default="")
    catogery_id = models.IntegerField(db_column="catogery_id", default=0)

    class Meta:
        db_table = "npt_library"
        ordering = ["category", "npt_reason"]
        verbose_name = "NPT library entry"
        verbose_name_plural = "NPT library entries"

    def __str__(self) -> str:
        return f"{self.category} · {self.npt_reason}"


class DailyNptStatus(models.Model):
    """daily_npt_status — per-day NPT log per unit/floor/line."""

    unit = models.CharField(max_length=100, blank=True, default="")
    machin_id = models.IntegerField(default=0, db_index=True)
    floor = models.IntegerField(default=0)
    line = models.IntegerField(default=0)
    date = models.DateField()
    category = models.CharField(max_length=100, blank=True, default="")
    npt_reason = models.CharField(max_length=255, blank=True, default="")
    npt_hour = models.FloatField(default=0, help_text="Total NPT in hours")
    start_log_id = models.BigIntegerField(default=0, db_index=True)
    stop_log_id = models.BigIntegerField(default=0)
    remarks = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "daily_npt_status"
        ordering = ["-date", "-id"]
        verbose_name = "daily NPT status"
        verbose_name_plural = "daily NPT status"

    def __str__(self) -> str:
        return f"{self.date} · U{self.unit} F{self.floor} L{self.line} · {self.npt_reason}"
