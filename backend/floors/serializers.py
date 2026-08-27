from rest_framework import serializers

from floors.constants import OPERATION_CHOICES
from floors.finishing_layout import normalize_layout_stations
from floors.finishing_process_themes import theme_for_display_order
from floors.layout_template_service import serialize_layout_template
from floors.models import FinishingProcess, Floor, Line, LineLayoutTemplate, ProductionEntry, WorkStation


class FinishingProcessSerializer(serializers.ModelSerializer):
    """Floor-plan process block — camelCase for React (DB + computed theme)."""

    order = serializers.IntegerField(source="display_order", read_only=True)
    id = serializers.SerializerMethodField()
    stationCount = serializers.IntegerField(source="station_count", read_only=True)
    productType = serializers.CharField(source="product_type", read_only=True)
    sam = serializers.CharField(read_only=True)
    legendLabel = serializers.SerializerMethodField()
    caption = serializers.SerializerMethodField()
    panel = serializers.SerializerMethodField()
    titleBar = serializers.SerializerMethodField()
    tile = serializers.SerializerMethodField()
    tileMuted = serializers.SerializerMethodField()

    class Meta:
        model = FinishingProcess
        fields = (
            "order",
            "id",
            "name",
            "process_name",
            "stationCount",
            "code",
            "productType",
            "sam",
            "caption",
            "legendLabel",
            "panel",
            "titleBar",
            "tile",
            "tileMuted",
            "is_active",
        )

    name = serializers.CharField(source="process_name", read_only=True)

    def get_id(self, obj: FinishingProcess) -> str:
        return obj.slug

    def get_legendLabel(self, obj: FinishingProcess) -> str:
        return obj.process_name

    def get_caption(self, obj: FinishingProcess) -> str:
        if obj.product_type:
            return f"{obj.process_name} · {obj.product_type}"
        return obj.process_name

    def _theme(self, obj: FinishingProcess) -> dict:
        return theme_for_display_order(obj.display_order)

    def get_panel(self, obj: FinishingProcess) -> str:
        return self._theme(obj)["panel"]

    def get_titleBar(self, obj: FinishingProcess) -> str:
        return self._theme(obj)["title_bar"]

    def get_tile(self, obj: FinishingProcess) -> str:
        return self._theme(obj)["tile"]

    def get_tileMuted(self, obj: FinishingProcess) -> str:
        return self._theme(obj)["tile_muted"]


class FloorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Floor
        fields = ("id", "name", "total_lines", "created_at")


class LineSerializer(serializers.ModelSerializer):
    class Meta:
        model = Line
        fields = ("id", "floor", "line_number", "name", "daily_target", "is_active")


class WorkStationSerializer(serializers.ModelSerializer):
    operation_label = serializers.CharField(source="get_operation_type_display", read_only=True)

    class Meta:
        model = WorkStation
        fields = (
            "id",
            "line",
            "station_number",
            "operation_type",
            "operation_label",
            "position_x",
            "position_y",
            "machine_type",
            "standard_time",
            "symbol_icon",
            "required_skill_level",
        )


class WorkStationBulkItemSerializer(serializers.Serializer):
    station_number = serializers.IntegerField()
    operation_type = serializers.ChoiceField(choices=OPERATION_CHOICES)
    position_x = serializers.FloatField()
    position_y = serializers.FloatField()
    machine_type = serializers.CharField(max_length=100)
    standard_time = serializers.FloatField()
    symbol_icon = serializers.CharField(max_length=50, allow_blank=True, required=False)
    required_skill_level = serializers.IntegerField(min_value=1, max_value=5, required=False, default=1)


class LineLayoutTemplateWriteSerializer(serializers.ModelSerializer):
    """Create/update floors_linelayouttemplate."""

    name = serializers.CharField(required=False, allow_blank=True, write_only=True)

    class Meta:
        model = LineLayoutTemplate
        fields = (
            "employee_id",
            "process_name",
            "name",
            "layout_type",
            "floor",
            "line_id",
            "status",
            "stations",
            "stations_id",
        )
        read_only_fields = ("stations_id",)

    def validate(self, attrs):
        if attrs.get("name") and not attrs.get("process_name"):
            attrs["process_name"] = attrs.pop("name")
        if attrs.get("layout_name") and not attrs.get("process_name"):
            attrs["process_name"] = attrs.pop("layout_name")
        layout_type = (attrs.get("layout_type") or "").strip().lower()
        if layout_type in ("sewing", "finishing"):
            attrs["layout_type"] = layout_type
        elif layout_type:
            attrs["layout_type"] = "finishing" if "finish" in layout_type else "sewing"
        if "stations" in attrs:
            attrs["stations"] = normalize_layout_stations(attrs.get("stations"))
            if not attrs["stations"]:
                raise serializers.ValidationError(
                    {"stations": "At least one process in the list must have stations greater than 0."}
                )
        return attrs

    def create(self, validated_data):
        validated_data.pop("name", None)
        layout_type = validated_data.get("layout_type", LineLayoutTemplate.LayoutType.FINISHING)
        stations = validated_data.get("stations") or []
        validated_data["stations"] = stations
        validated_data["stations_id"] = self._stations_id_value(layout_type, stations)
        validated_data.setdefault("status", 1)
        validated_data.setdefault("layout_type", layout_type)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data.pop("name", None)
        layout_type = validated_data.get("layout_type", instance.layout_type)
        if isinstance(layout_type, str):
            layout_type = layout_type.strip().lower()
            if layout_type not in ("sewing", "finishing"):
                layout_type = instance.layout_type
            validated_data["layout_type"] = layout_type
        if "stations" in validated_data:
            stations = validated_data["stations"]
            validated_data["stations_id"] = self._stations_id_value(layout_type, stations)
        return super().update(instance, validated_data)

    @staticmethod
    def _stations_id_value(layout_type, stations) -> int:
        if layout_type == LineLayoutTemplate.LayoutType.FINISHING:
            return sum(int(p.get("station_count") or p.get("stationCount") or 0) for p in (stations or []))
        return len(stations or [])


class LineLayoutTemplateSerializer(LineLayoutTemplateWriteSerializer):
    """Read serializer with HR + floor/line enrichment (via view list/retrieve)."""

    floor_name = serializers.CharField(read_only=True)
    line_name = serializers.CharField(read_only=True)
    employee_name = serializers.CharField(read_only=True)
    designation = serializers.CharField(read_only=True)
    station_id = serializers.IntegerField(source="stations_id", read_only=True)
    process_count = serializers.IntegerField(read_only=True)
    station_total = serializers.IntegerField(read_only=True)

    class Meta(LineLayoutTemplateWriteSerializer.Meta):
        fields = LineLayoutTemplateWriteSerializer.Meta.fields + (
            "id",
            "floor_name",
            "line_name",
            "employee_name",
            "designation",
            "station_id",
            "process_count",
            "station_total",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "stations_id",
            "station_id",
            "floor_name",
            "line_name",
            "employee_name",
            "designation",
            "process_count",
            "station_total",
            "created_at",
            "updated_at",
        )

    def to_representation(self, instance):
        return serialize_layout_template(instance)


class ProductionEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductionEntry
        fields = ("id", "line", "station", "date", "hour", "quantity", "target")


class StationCardSerializer(serializers.Serializer):
    """Enriched station for Station View grid."""

    id = serializers.IntegerField()
    station_number = serializers.IntegerField()
    operation_type = serializers.CharField()
    operation_label = serializers.CharField()
    symbol_icon = serializers.CharField()
    standard_time = serializers.FloatField()
    required_skill_level = serializers.IntegerField()
    output_today = serializers.IntegerField()
    target_today = serializers.IntegerField()
    efficiency_pct = serializers.FloatField()
    status = serializers.CharField()
    employee_name = serializers.CharField(allow_null=True)
    employee_emp_id = serializers.CharField(allow_null=True)
    profile_image = serializers.CharField(allow_null=True, allow_blank=True)
