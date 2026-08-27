"""Serializers for line layout master/detail CRUD."""

from __future__ import annotations

from django.db import transaction
from rest_framework import serializers

from floors.models import (
    FinishingProcess,
    Floor,
    Line,
    LineLayoutTemplateDetail,
    LineLayoutTemplateDetailWorkstation,
    LineLayoutTemplateMaster,
)
from floors.line_layout_workstation import assignment_counts_for_layout


class FinishingProcessLineSerializer(serializers.ModelSerializer):
    """Active finishing_process rows for layout form (product_type filter)."""

    class Meta:
        model = FinishingProcess
        fields = (
            "id",
            "process_name",
            "sam",
            "machin_type",
            "display_order",
            "product_type",
            "station_count",
        )


class LineLayoutDetailSerializer(serializers.ModelSerializer):
    finishing_process_id = serializers.IntegerField(source="finishing_process.id", read_only=True)
    assigned_people_count = serializers.SerializerMethodField()

    class Meta:
        model = LineLayoutTemplateDetail
        fields = (
            "id",
            "finishing_process_id",
            "process_name",
            "sam",
            "machin_type",
            "display_order",
            "no_of_workstation",
            "assigned_people_count",
        )

    def get_assigned_people_count(self, obj: LineLayoutTemplateDetail) -> int:
        counts = self.context.get("assignment_counts") or {}
        return int(counts.get(obj.finishing_process_id, 0))


class LineLayoutDetailWriteSerializer(serializers.Serializer):
    finishing_process_id = serializers.IntegerField()
    process_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    sam = serializers.CharField(max_length=120, required=False, allow_blank=True)
    machin_type = serializers.CharField(max_length=50, required=False, allow_blank=True)
    display_order = serializers.IntegerField(required=False, default=0)
    no_of_workstation = serializers.IntegerField(required=False, default=1, min_value=0)


class LineLayoutMasterSerializer(serializers.ModelSerializer):
    layout_id = serializers.IntegerField(source="id", read_only=True)
    floor_name = serializers.SerializerMethodField()
    line_name = serializers.SerializerMethodField()
    total_workstation = serializers.SerializerMethodField()
    details = LineLayoutDetailSerializer(many=True, read_only=True)

    class Meta:
        model = LineLayoutTemplateMaster
        fields = (
            "layout_id",
            "id",
            "unit",
            "style",
            "product",
            "product_type",
            "layout_date",
            "floor",
            "floor_name",
            "line",
            "line_name",
            "total_workstation",
            "details",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "layout_id", "created_at", "updated_at")

    def get_floor_name(self, obj: LineLayoutTemplateMaster) -> str:
        return obj.floor.name if obj.floor_id else "—"

    def get_line_name(self, obj: LineLayoutTemplateMaster) -> str:
        return obj.line.name if obj.line_id else "—"

    def get_total_workstation(self, obj: LineLayoutTemplateMaster) -> int:
        if hasattr(obj, "_total_workstation"):
            return int(obj._total_workstation or 0)
        return sum(int(d.no_of_workstation or 0) for d in obj.details.all())

    def to_representation(self, instance):
        self.context["assignment_counts"] = assignment_counts_for_layout(instance.id)
        return super().to_representation(instance)


class LineLayoutMasterWriteSerializer(serializers.ModelSerializer):
    details = LineLayoutDetailWriteSerializer(many=True)

    class Meta:
        model = LineLayoutTemplateMaster
        fields = (
            "unit",
            "style",
            "product",
            "product_type",
            "layout_date",
            "floor",
            "line",
            "details",
        )

    def validate_details(self, value):
        if not value:
            raise serializers.ValidationError("At least one process line is required.")
        return value

    def validate(self, attrs):
        product_type = (attrs.get("product_type") or "").strip()
        if not product_type and attrs.get("product"):
            attrs["product_type"] = str(attrs["product"]).strip().lower()[:30]
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        details_data = validated_data.pop("details")
        master = LineLayoutTemplateMaster.objects.create(**validated_data)
        self._save_details(master, details_data)
        return master

    @transaction.atomic
    def update(self, instance, validated_data):
        details_data = validated_data.pop("details", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if details_data is not None:
            old_process_ids = set(
                instance.details.values_list("finishing_process_id", flat=True)
            )
            new_process_ids = {item["finishing_process_id"] for item in details_data}
            removed_process_ids = old_process_ids - new_process_ids
            if removed_process_ids:
                LineLayoutTemplateDetailWorkstation.objects.filter(
                    layout_id=instance.id,
                    process_id__in=removed_process_ids,
                ).delete()
            instance.details.all().delete()
            self._save_details(instance, details_data)
        return instance

    def _save_details(self, master: LineLayoutTemplateMaster, details_data: list) -> None:
        rows = []
        for item in details_data:
            proc_id = item["finishing_process_id"]
            proc = FinishingProcess.objects.filter(pk=proc_id, is_active=True).first()
            if not proc:
                raise serializers.ValidationError(
                    {"details": f"Invalid or inactive process id {proc_id}."}
                )
            ws_count = item.get("no_of_workstation")
            if ws_count is None:
                ws_count = proc.station_count or 1
            rows.append(
                LineLayoutTemplateDetail(
                    master=master,
                    finishing_process=proc,
                    process_name=item.get("process_name") or proc.process_name,
                    sam=item.get("sam") if item.get("sam") is not None else proc.sam,
                    machin_type=item.get("machin_type")
                    if item.get("machin_type") is not None
                    else proc.machin_type,
                    display_order=item.get("display_order") or proc.display_order,
                    no_of_workstation=max(0, int(ws_count)),
                )
            )
        LineLayoutTemplateDetail.objects.bulk_create(rows)
