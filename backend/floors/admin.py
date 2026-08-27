from django.contrib import admin
from django.contrib.admin import TabularInline

from .models import (
    DailyNptStatus,
    FinishingProcess,
    Floor,
    Line,
    LineLayoutTemplate,
    LineLayoutTemplateDetail,
    LineLayoutTemplateMaster,
    Machine,
    NptLibrary,
    ProductionEntry,
    WorkStation,
)


@admin.register(Machine)
class MachineAdmin(admin.ModelAdmin):
    list_display = ("machine_code", "machine_type", "brand", "model_no", "floor", "is_active")
    list_filter = ("machine_type", "is_active", "floor")
    search_fields = ("machine_code", "brand", "model_no")


@admin.register(FinishingProcess)
class FinishingProcessAdmin(admin.ModelAdmin):
    list_display = (
        "display_order",
        "process_name",
        "code",
        "station_count",
        "product_type",
        "sam",
        "machin_type",
        "is_active",
    )
    list_filter = ("is_active",)
    ordering = ("display_order",)
    search_fields = ("name", "slug", "code")


@admin.register(Floor)
class FloorAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "total_lines", "created_at")


@admin.register(Line)
class LineAdmin(admin.ModelAdmin):
    list_display = ("id", "floor", "line_number", "name", "daily_target", "is_active")
    list_filter = ("floor", "is_active")


@admin.register(WorkStation)
class WorkStationAdmin(admin.ModelAdmin):
    list_display = ("id", "line", "station_number", "operation_type", "machine_type", "standard_time")
    list_filter = ("line", "operation_type")


@admin.register(ProductionEntry)
class ProductionEntryAdmin(admin.ModelAdmin):
    list_display = ("id", "line", "station", "date", "hour", "quantity", "target")
    list_filter = ("date", "line")


class LineLayoutTemplateDetailInline(TabularInline):
    model = LineLayoutTemplateDetail
    extra = 0
    readonly_fields = (
        "finishing_process",
        "process_name",
        "sam",
        "machin_type",
        "display_order",
        "no_of_workstation",
    )


@admin.register(LineLayoutTemplateMaster)
class LineLayoutTemplateMasterAdmin(admin.ModelAdmin):
    list_display = ("id", "product_type", "layout_date", "floor", "line", "unit", "style", "product")
    list_filter = ("product_type", "layout_date", "floor")
    inlines = [LineLayoutTemplateDetailInline]


@admin.register(LineLayoutTemplate)
class LineLayoutTemplateAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "employee_id",
        "process_name",
        "layout_type",
        "floor",
        "line_id",
        "status",
        "stations_id",
        "created_at",
    )
    list_filter = ("layout_type", "floor")


@admin.register(NptLibrary)
class NptLibraryAdmin(admin.ModelAdmin):
    list_display = ("id", "category", "npt_reason")
    list_filter = ("category",)
    search_fields = ("category", "npt_reason")
    ordering = ("category", "npt_reason")


@admin.register(DailyNptStatus)
class DailyNptStatusAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "date",
        "unit",
        "floor",
        "line",
        "category",
        "npt_reason",
        "remarks",
        "created_at",
    )
    list_filter = ("date", "category", "floor", "line")
    search_fields = ("npt_reason", "remarks", "unit")
    date_hierarchy = "date"
    ordering = ("-date", "-id")
