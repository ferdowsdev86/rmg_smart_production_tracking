"""Sewing Line Layout Planner — local, managed models.

Seeded with sample data now (step 1); the real OB / machine data is imported
from the ERP (``mbm_ie`` + ``cuttingedgedb``) into these same tables in a later
step. All tables are prefixed ``lp_`` so they never collide with the existing
finishing line-layout tables.
"""

from django.db import models


class MachineType(models.Model):
    """Sewing machine type master (SNLS, OL-4T, FL, IRON, HAND, …)."""

    code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=100)
    # badge colour for the floor view (one colour per type)
    color = models.CharField(max_length=20, blank=True, default="#64748b")

    class Meta:
        db_table = "lp_machine_type"
        ordering = ["code"]

    def __str__(self) -> str:
        return f"{self.code} · {self.name}"


class Machine(models.Model):
    """Machine library — one row per physical machine."""

    STATUS_RUNNING = "Running"
    STATUS_IDLE = "Idle"
    STATUS_MAINTENANCE = "Maintenance"
    STATUS_CHOICES = [
        (STATUS_RUNNING, "Running"),
        (STATUS_IDLE, "Idle"),
        (STATUS_MAINTENANCE, "Maintenance"),
    ]

    machine_no = models.CharField(max_length=40, unique=True, help_text="e.g. L1-SNLS-01")
    machine_type = models.ForeignKey(
        MachineType, on_delete=models.PROTECT, related_name="machines"
    )
    brand = models.CharField(max_length=60, blank=True, default="")
    model_no = models.CharField(max_length=60, blank=True, default="")
    serial_no = models.CharField(max_length=80, blank=True, default="")
    current_line = models.CharField(max_length=40, blank=True, default="")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_IDLE)

    class Meta:
        db_table = "lp_machine"
        ordering = ["machine_no"]

    def __str__(self) -> str:
        return self.machine_no


class PlannerLine(models.Model):
    """A sewing line that layouts are planned onto."""

    SHAPE_STRAIGHT = "straight"
    SHAPE_U = "u"
    SHAPE_ZIGZAG = "zigzag"
    SHAPE_CHOICES = [
        (SHAPE_STRAIGHT, "Straight 2-row"),
        (SHAPE_U, "U-shape"),
        (SHAPE_ZIGZAG, "Zig-zag"),
    ]

    line_no = models.CharField(max_length=40)
    floor = models.CharField(max_length=60, blank=True, default="")
    max_stations = models.PositiveIntegerField(default=40)
    shape = models.CharField(max_length=20, choices=SHAPE_CHOICES, default=SHAPE_STRAIGHT)

    class Meta:
        db_table = "lp_line"
        ordering = ["line_no"]

    def __str__(self) -> str:
        return self.line_no


class Style(models.Model):
    """A style with its operation breakdown (OB)."""

    buyer = models.CharField(max_length=80, blank=True, default="")
    style_no = models.CharField(max_length=80)
    style_name = models.CharField(max_length=120, blank=True, default="")
    description = models.TextField(blank=True, default="")
    # ERP linkage, filled when imported from mbm_ie (step 3)
    erp_style_id = models.IntegerField(null=True, blank=True)
    erp_obm_id = models.IntegerField(null=True, blank=True)

    class Meta:
        db_table = "lp_style"
        ordering = ["buyer", "style_no"]

    def __str__(self) -> str:
        return f"{self.style_no} · {self.style_name}"


class OBOperation(models.Model):
    """One operation in a style's OB."""

    SECTION_CHOICES = [
        ("Front", "Front"),
        ("Back", "Back"),
        ("Collar", "Collar"),
        ("Sleeve", "Sleeve"),
        ("Assembly", "Assembly"),
        ("Finishing", "Finishing"),
    ]
    GRADE_CHOICES = [("A", "A"), ("B", "B"), ("C", "C")]

    style = models.ForeignKey(Style, on_delete=models.CASCADE, related_name="operations")
    seq = models.PositiveIntegerField(default=0)
    operation_name = models.CharField(max_length=160)
    machine_type = models.ForeignKey(
        MachineType, on_delete=models.PROTECT, related_name="operations"
    )
    smv = models.FloatField(default=0, help_text="Standard minute value")
    section = models.CharField(max_length=20, choices=SECTION_CHOICES, blank=True, default="")
    skill_grade = models.CharField(max_length=1, choices=GRADE_CHOICES, blank=True, default="")
    attachment = models.CharField(max_length=120, blank=True, default="", help_text="folder / guide / foot")

    class Meta:
        db_table = "lp_ob_operation"
        ordering = ["style", "seq"]

    def __str__(self) -> str:
        return f"{self.seq}. {self.operation_name}"


class Layout(models.Model):
    """A saved, balanced line layout (versioned per style + line)."""

    style = models.ForeignKey(Style, on_delete=models.CASCADE, related_name="layouts")
    line = models.ForeignKey(PlannerLine, on_delete=models.PROTECT, related_name="layouts")
    inputs = models.JSONField(default=dict, blank=True, help_text="manpower, target, efficiency, hours")
    version = models.PositiveIntegerField(default=1)
    # computed summary
    total_smv = models.FloatField(default=0)
    target_per_hour = models.FloatField(default=0)
    takt_time = models.FloatField(default=0)
    balance_pct = models.FloatField(default=0)
    station_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "lp_layout"
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"{self.style.style_no} @ {self.line.line_no} v{self.version}"


class Station(models.Model):
    """One station in a layout: combined operation(s) + an assigned machine."""

    layout = models.ForeignKey(Layout, on_delete=models.CASCADE, related_name="stations")
    station_no = models.PositiveIntegerField(default=0)
    operations = models.ManyToManyField(OBOperation, related_name="stations", blank=True)
    machine_type = models.ForeignKey(
        MachineType, on_delete=models.PROTECT, related_name="stations", null=True, blank=True
    )
    machine = models.ForeignKey(
        Machine, on_delete=models.SET_NULL, related_name="stations", null=True, blank=True
    )
    operator_count = models.PositiveIntegerField(default=1)
    smv_load = models.FloatField(default=0)
    row = models.CharField(max_length=4, blank=True, default="A", help_text="A / B")
    side = models.CharField(max_length=10, blank=True, default="")
    position = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "lp_station"
        ordering = ["layout", "position"]

    def __str__(self) -> str:
        return f"Station {self.station_no} ({self.layout_id})"
