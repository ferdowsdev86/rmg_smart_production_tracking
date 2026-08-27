from django.urls import include, path
from rest_framework.routers import DefaultRouter

from floors.line_layout_views import (
    FinishingProcessByProductTypeView,
    LineLayoutFormOptionsView,
    LineLayoutMasterViewSet,
    LineLayoutProcessAssignmentEmployeesView,
    LineLayoutProcessAssignmentView,
)
from floors.machin_library_views import MachinLibraryViewSet
from floors.machin_maintenance_views import DailyMachinMaintananceViewSet
from floors.machinery_dashboard_views import MachineryDashboardView
from floors.machin_manpower_views import (
    MachinManpowerLayoutBulkSaveView,
    MachinManpowerLayoutFormContextView,
    MachinManpowerLayoutViewSet,
)
from floors.views import (
    FinishingDashboardView,
    FinishingProcessListView,
    FloorDashboardView,
    FloorLinesMapView,
    FloorListView,
    HourlyProductionView,
    LineLayoutTemplateViewSet,
    LineViewSet,
    OperationChoicesView,
    WorkStationViewSet,
)

router = DefaultRouter()
router.register(r"lines", LineViewSet, basename="line")
router.register(r"stations", WorkStationViewSet, basename="workstation")
router.register(r"layout-templates", LineLayoutTemplateViewSet, basename="layout-template")
router.register(r"line-layouts", LineLayoutMasterViewSet, basename="line-layout")
router.register(r"machin-manpower-layout", MachinManpowerLayoutViewSet, basename="machin-manpower-layout")
router.register(r"machin-library", MachinLibraryViewSet, basename="machin-library")
router.register(
    r"daily-machin-maintanance",
    DailyMachinMaintananceViewSet,
    basename="daily-machin-maintanance",
)

urlpatterns = [
    path("floors/", FloorListView.as_view()),
    path("finishing-dashboard/", FinishingDashboardView.as_view()),
    path("finishing-processes/", FinishingProcessListView.as_view()),
    path("finishing-processes/by-product/", FinishingProcessByProductTypeView.as_view()),
    path("line-layout-options/", LineLayoutFormOptionsView.as_view()),
    path(
        "machin-manpower-layout/form-context/<int:layout_id>/",
        MachinManpowerLayoutFormContextView.as_view(),
    ),
    path("machin-manpower-layout/bulk-save/", MachinManpowerLayoutBulkSaveView.as_view()),
    path(
        "line-layouts/process-assignment-employees/",
        LineLayoutProcessAssignmentEmployeesView.as_view(),
    ),
    path(
        "line-layouts/<int:layout_id>/process-assignments/",
        LineLayoutProcessAssignmentView.as_view(),
    ),
    path("machinery-dashboard/", MachineryDashboardView.as_view()),
    path("operations/", OperationChoicesView.as_view()),
    path("dashboard/", FloorDashboardView.as_view()),
    path("map/", FloorLinesMapView.as_view()),
    path("", include(router.urls)),
]
