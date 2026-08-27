"""Serializers for machin_manpower_layout CRUD."""

from __future__ import annotations

from datetime import datetime

from django.utils import timezone
from rest_framework import serializers

from employees.hr_employee import find_hr_row
from floors.models import LineLayoutTemplateDetail, LineLayoutTemplateMaster, MachinManpowerLayout
from mbm_automation.models import LineLayout


class MachinManpowerLayoutSerializer(serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()
    machin_name = serializers.SerializerMethodField()
    process_name = serializers.SerializerMethodField()

    class Meta:
        model = MachinManpowerLayout
        fields = (
            "id",
            "layout_id",
            "layouttemplete_id",
            "machin_no",
            "machin_name",
            "employee_id",
            "employee_name",
            "process_name",
            "floor",
            "line_no",
            "line_type",
            "date",
        )
        read_only_fields = ("id", "date")

    def get_employee_name(self, obj: MachinManpowerLayout) -> str:
        hr = find_hr_row(obj.employee_id)
        if hr and (hr.as_name or "").strip():
            return (hr.as_name or "").strip()
        return obj.employee_id or "—"

    def get_machin_name(self, obj: MachinManpowerLayout) -> str:
        row = LineLayout.objects.using("mbm_automation").filter(machin_no=obj.machin_no).first()
        return (row.machin_name or "").strip() if row else "—"

    def get_process_name(self, obj: MachinManpowerLayout) -> str:
        detail = LineLayoutTemplateDetail.objects.filter(pk=obj.layouttemplete_id).first()
        return (detail.process_name or "").strip() if detail else "—"


class MachinManpowerLayoutWriteSerializer(serializers.Serializer):
    layout_id = serializers.IntegerField()
    layouttemplete_id = serializers.IntegerField()
    machin_no = serializers.IntegerField(min_value=1)
    employee_id = serializers.CharField(max_length=100)

    def validate(self, attrs):
        layout_id = int(attrs["layout_id"])
        detail_id = int(attrs["layouttemplete_id"])
        master = LineLayoutTemplateMaster.objects.filter(pk=layout_id).first()
        if not master:
            raise serializers.ValidationError({"layout_id": "Layout not found."})
        detail = LineLayoutTemplateDetail.objects.filter(pk=detail_id, master_id=layout_id).first()
        if not detail:
            raise serializers.ValidationError(
                {"layouttemplete_id": "Layout detail not found for this layout."}
            )
        machin_no = int(attrs["machin_no"])
        machine = LineLayout.objects.using("mbm_automation").filter(machin_no=machin_no).first()
        if not machine:
            raise serializers.ValidationError({"machin_no": f"Machine {machin_no} not in line_layout."})
        attrs["_master"] = master
        attrs["_machine"] = machine
        return attrs

    def create(self, validated_data):
        master = validated_data["_master"]
        machine = validated_data["_machine"]
        assignment_date = timezone.make_aware(
            datetime.combine(master.layout_date, datetime.min.time())
        )
        return MachinManpowerLayout.objects.create(
            layout_id=int(validated_data["layout_id"]),
            layouttemplete_id=int(validated_data["layouttemplete_id"]),
            machin_no=int(validated_data["machin_no"]),
            employee_id=str(validated_data["employee_id"]).strip(),
            floor=int(machine.floor),
            line_no=int(machine.line_no),
            line_type=int(machine.line_type),
            date=assignment_date,
        )

