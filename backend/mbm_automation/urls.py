from django.urls import include, path
from rest_framework.routers import DefaultRouter

from mbm_automation.daily_npt_views import (
    DailyNptStatusDetailView,
    DailyNptStatusView,
    NptLibraryView,
)
from mbm_automation.daily_sewing_target_views import DailySewingTargetView
from mbm_automation.day_sew_target_views import DaySewTargetView
from mbm_automation.iotdatastore_views import IotDataStoreView
from mbm_automation.line_dashboard_views import (
    FloorOverviewDetailView,
    FloorOverviewView,
    LineDayDashboardView,
    TargetOutputReportView,
)
from mbm_automation.production_summary import MachineProductionSummaryView
from mbm_automation.quality_views import (
    QualityBundleView,
    QualityCheckView,
    QualityDefectTypesView,
)
from mbm_automation.views import (
    FabricDefectViewSet,
    SewingLineDashboardView,
    SewingLineListView,
    SewingLogViewSet,
    SewingRfidDeviceView,
)

router = DefaultRouter()
router.register(r"fabric-defects", FabricDefectViewSet, basename="fabric-defect")
router.register(r"sewing-logs", SewingLogViewSet, basename="sewing-log")

urlpatterns = [
    path("sewing-lines/", SewingLineListView.as_view()),
    path(
        "sewing-lines/<int:floor>/<int:line_no>/dashboard/",
        SewingLineDashboardView.as_view(),
    ),
    path(
        "sewing-rfid-device/",
        SewingRfidDeviceView.as_view(),
    ),
    path(
        "iotdatastore/",
        IotDataStoreView.as_view(),
    ),
    path(
        "iotdatastore",
        IotDataStoreView.as_view(),
    ),
    path(
        "day_sew_target/",
        DaySewTargetView.as_view(),
    ),
    path(
        "day_sew_target",
        DaySewTargetView.as_view(),
    ),
    path(
        "daily_sewing_target/",
        DailySewingTargetView.as_view(),
    ),
    path(
        "daily_sewing_target",
        DailySewingTargetView.as_view(),
    ),
    path(
        "daily_npt/",
        DailyNptStatusView.as_view(),
    ),
    path(
        "daily_npt/<int:pk>/",
        DailyNptStatusDetailView.as_view(),
    ),
    path(
        "npt_library/",
        NptLibraryView.as_view(),
    ),
    path(
        "line_day_dashboard/",
        LineDayDashboardView.as_view(),
    ),
    path(
        "floor_overview/",
        FloorOverviewView.as_view(),
    ),
    path(
        "floor_overview_detail/",
        FloorOverviewDetailView.as_view(),
    ),
    path(
        "target_output_report/",
        TargetOutputReportView.as_view(),
    ),
    path(
        "production_summary/",
        MachineProductionSummaryView.as_view(),
    ),
    path(
        "production_summary",
        MachineProductionSummaryView.as_view(),
    ),
    path(
        "quality/bundle/",
        QualityBundleView.as_view(),
    ),
    path(
        "quality/check/",
        QualityCheckView.as_view(),
    ),
    path(
        "quality/defect_types/",
        QualityDefectTypesView.as_view(),
    ),
    path("", include(router.urls)),
]
