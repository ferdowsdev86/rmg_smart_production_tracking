from rest_framework import serializers

from mbm_automation.models import FabricDefect, SewingLog


class FabricDefectSerializer(serializers.ModelSerializer):
    class Meta:
        model = FabricDefect
        fields = (
            "id",
            "fabric_roll_id",
            "defect_code",
            "defect_name",
            "defect_qty",
            "remarks",
            "created_at",
            "updated_at",
        )


class SewingLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = SewingLog
        fields = (
            "id",
            "machin_id",
            "machin_user",
            "logged_at",
            "flag1",
            "flag2",
            "flag3",
            "flag4",
            "created_at",
            "updated_at",
        )
