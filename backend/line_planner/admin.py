from django.contrib import admin

from line_planner.models import (
    Layout,
    Machine,
    MachineType,
    OBOperation,
    PlannerLine,
    Station,
    Style,
)


@admin.register(MachineType)
class MachineTypeAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "color")
    search_fields = ("code", "name")


@admin.register(Machine)
class MachineAdmin(admin.ModelAdmin):
    list_display = ("machine_no", "machine_type", "brand", "current_line", "status")
    list_filter = ("status", "machine_type", "current_line")
    search_fields = ("machine_no", "brand", "serial_no")


@admin.register(PlannerLine)
class PlannerLineAdmin(admin.ModelAdmin):
    list_display = ("line_no", "floor", "max_stations", "shape")


class OBOperationInline(admin.TabularInline):
    model = OBOperation
    extra = 0


@admin.register(Style)
class StyleAdmin(admin.ModelAdmin):
    list_display = ("style_no", "style_name", "buyer")
    search_fields = ("style_no", "style_name", "buyer")
    inlines = [OBOperationInline]


@admin.register(Layout)
class LayoutAdmin(admin.ModelAdmin):
    list_display = ("id", "style", "line", "version", "station_count", "balance_pct", "created_at")
    list_filter = ("line",)


admin.site.register(Station)
