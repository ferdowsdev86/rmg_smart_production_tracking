from rest_framework import serializers

from floors.models import MachinLibrary


class MachinLibrarySerializer(serializers.ModelSerializer):
    ownership_label = serializers.CharField(read_only=True)
    unit_label = serializers.CharField(read_only=True)
    status_label = serializers.CharField(read_only=True)
    line_no = serializers.SerializerMethodField()

    class Meta:
        model = MachinLibrary
        fields = (
            "id",
            "machin_no",
            "machin_name",
            "brand",
            "model_no",
            "floor",
            "line",
            "line_no",
            "unit",
            "unit_label",
            "owner",
            "ownership_label",
            "supplier_name",
            "install_date",
            "movement_date",
            "is_active",
            "status_label",
            "created_at",
        )
        read_only_fields = (
            "id",
            "created_at",
            "ownership_label",
            "unit_label",
            "status_label",
            "line_no",
        )

    def get_line_no(self, obj) -> int:
        if obj.line:
            return int(obj.line)
        line_map = self.context.get("line_map") or {}
        return int(line_map.get(obj.machin_no, 0) or 0)

    def validate_is_active(self, value):
        if value not in (MachinLibrary.STATUS_ACTIVE, MachinLibrary.STATUS_INACTIVE):
            raise serializers.ValidationError("is_active must be 1 (Active) or 2 (Inactive).")
        return value
