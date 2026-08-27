from rest_framework import serializers

from floors.machin_maintenance_service import available_machine_ids
from floors.models import DailyMachinMaintanance


class DailyMachinMaintananceSerializer(serializers.ModelSerializer):
    machine_name = serializers.SerializerMethodField()

    class Meta:
        model = DailyMachinMaintanance
        fields = (
            "id",
            "maintenance_date",
            "machine_id",
            "machine_name",
            "operator_id",
            "mechanic_id",
            "shift",
            "machine_status",
            "remarks",
            "created_by",
            "created_at",
        )
        read_only_fields = ("id", "created_at", "machine_name")

    def get_machine_name(self, obj) -> str:
        names = self.context.get("machine_names")
        if names is not None and obj.machine_id in names:
            return names.get(obj.machine_id, "")
        # Single-object responses (create/update/retrieve): direct lookup.
        from floors.models import MachinLibrary

        row = MachinLibrary.objects.filter(machin_no=obj.machine_id).first()
        return row.machin_name if row else ""

    def validate_machine_id(self, value):
        # The machine must come from the available list: sewing_log rows with flag9 = 1.
        if value not in available_machine_ids():
            raise serializers.ValidationError(
                "Machine is not in the available list (sewing_log flag9 = 1)."
            )
        return value
