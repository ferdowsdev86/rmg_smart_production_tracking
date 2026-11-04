from rest_framework import serializers

from line_planner.models import (
    Layout,
    Machine,
    MachineType,
    OBOperation,
    PlannerLine,
    Station,
    Style,
)


class MachineTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = MachineType
        fields = ("id", "code", "name", "color")


class MachineSerializer(serializers.ModelSerializer):
    machine_type_code = serializers.CharField(source="machine_type.code", read_only=True)
    machine_type_name = serializers.CharField(source="machine_type.name", read_only=True)
    assigned_to = serializers.SerializerMethodField()

    class Meta:
        model = Machine
        fields = (
            "id", "machine_no", "machine_type", "machine_type_code", "machine_type_name",
            "brand", "model_no", "serial_no", "current_line", "status", "assigned_to",
        )

    def get_assigned_to(self, obj) -> str:
        st = obj.stations.select_related("layout", "layout__style", "layout__line").first()
        if not st:
            return ""
        return f"{st.layout.style.style_no} @ {st.layout.line.line_no} · St {st.station_no}"


class PlannerLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlannerLine
        fields = ("id", "line_no", "floor", "max_stations", "shape")


class OBOperationSerializer(serializers.ModelSerializer):
    machine_type_code = serializers.CharField(source="machine_type.code", read_only=True)

    class Meta:
        model = OBOperation
        fields = (
            "id", "seq", "operation_name", "machine_type", "machine_type_code",
            "smv", "section", "skill_grade", "attachment",
        )


class StyleSerializer(serializers.ModelSerializer):
    operations = OBOperationSerializer(many=True, read_only=True)
    total_smv = serializers.SerializerMethodField()
    operation_count = serializers.SerializerMethodField()

    class Meta:
        model = Style
        fields = (
            "id", "buyer", "style_no", "style_name", "description",
            "operations", "total_smv", "operation_count",
        )

    def get_total_smv(self, obj) -> float:
        return round(sum(o.smv for o in obj.operations.all()), 4)

    def get_operation_count(self, obj) -> int:
        return obj.operations.count()


class StyleListSerializer(serializers.ModelSerializer):
    """Lightweight style row for the picker (no operations)."""

    total_smv = serializers.SerializerMethodField()
    operation_count = serializers.SerializerMethodField()

    class Meta:
        model = Style
        fields = ("id", "buyer", "style_no", "style_name", "total_smv", "operation_count")

    def get_total_smv(self, obj) -> float:
        return round(sum(o.smv for o in obj.operations.all()), 4)

    def get_operation_count(self, obj) -> int:
        return obj.operations.count()


class StationSerializer(serializers.ModelSerializer):
    operations = OBOperationSerializer(many=True, read_only=True)
    machine_type_code = serializers.CharField(source="machine_type.code", read_only=True, default="")
    machine_no = serializers.CharField(source="machine.machine_no", read_only=True, default="")

    class Meta:
        model = Station
        fields = (
            "id", "station_no", "operations", "machine_type", "machine_type_code",
            "machine", "machine_no", "operator_count", "smv_load", "row", "side", "position",
        )


class LayoutSerializer(serializers.ModelSerializer):
    stations = StationSerializer(many=True, read_only=True)
    style_no = serializers.CharField(source="style.style_no", read_only=True)
    line_no = serializers.CharField(source="line.line_no", read_only=True)

    class Meta:
        model = Layout
        fields = (
            "id", "style", "style_no", "line", "line_no", "inputs", "version",
            "total_smv", "target_per_hour", "takt_time", "balance_pct",
            "station_count", "created_at", "stations",
        )


class LayoutListSerializer(serializers.ModelSerializer):
    style_no = serializers.CharField(source="style.style_no", read_only=True)
    style_name = serializers.CharField(source="style.style_name", read_only=True)
    line_no = serializers.CharField(source="line.line_no", read_only=True)

    class Meta:
        model = Layout
        fields = (
            "id", "style", "style_no", "style_name", "line", "line_no", "version",
            "total_smv", "target_per_hour", "balance_pct", "station_count", "created_at",
        )
