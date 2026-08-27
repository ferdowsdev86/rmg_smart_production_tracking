from rest_framework import serializers

from attendance.models import StationCameraState


class CameraAlertSerializer(serializers.Serializer):
    employee_emp_id = serializers.CharField(max_length=20)
    detected_station_id = serializers.IntegerField()
    assigned_station_id = serializers.IntegerField()
    confidence = serializers.FloatField(min_value=0.0)
    camera_id = serializers.CharField(max_length=50)


class StationCameraStateSerializer(serializers.ModelSerializer):
    station_label = serializers.SerializerMethodField()
    employee_name = serializers.SerializerMethodField()
    emp_id = serializers.SerializerMethodField()

    class Meta:
        model = StationCameraState
        fields = (
            "station_id",
            "station_label",
            "last_employee",
            "employee_name",
            "emp_id",
            "is_mismatch",
            "confidence",
            "camera_id",
            "updated_at",
        )

    def get_station_label(self, obj):
        return f"{obj.station.line.name} S{obj.station.station_number}"

    def get_employee_name(self, obj):
        return obj.last_employee.name if obj.last_employee else None

    def get_emp_id(self, obj):
        return obj.last_employee.emp_id if obj.last_employee else None
