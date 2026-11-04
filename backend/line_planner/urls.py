from django.urls import include, path
from rest_framework.routers import DefaultRouter

from line_planner.erp_views import (
    erp_assign_view,
    erp_available_machines_view,
    erp_generate_view,
    erp_lines_view,
    erp_machines_view,
    erp_ob_view,
    erp_operators_view,
    erp_styles_view,
)
from line_planner.views import (
    LayoutViewSet,
    MachineTypeViewSet,
    MachineViewSet,
    PlannerLineViewSet,
    StyleViewSet,
    assign_view,
    available_machines_view,
    generate_view,
    save_view,
)

router = DefaultRouter()
router.register(r"machine-types", MachineTypeViewSet, basename="lp-machine-type")
router.register(r"lines", PlannerLineViewSet, basename="lp-line")
router.register(r"styles", StyleViewSet, basename="lp-style")
router.register(r"machines", MachineViewSet, basename="lp-machine")
router.register(r"layouts", LayoutViewSet, basename="lp-layout")

urlpatterns = [
    # live ERP-backed endpoints (mbm_ie OB + line_layout machines)
    path("erp/styles/", erp_styles_view),
    path("erp/lines/", erp_lines_view),
    path("erp/machines/", erp_machines_view),
    path("erp/ob/<int:obm_id>/", erp_ob_view),
    path("erp/generate/", erp_generate_view),
    path("erp/assign/", erp_assign_view),
    path("erp/operators/", erp_operators_view),
    path("erp/available-machines/", erp_available_machines_view),
    # local seeded endpoints (kept from step 1)
    path("generate/", generate_view),
    path("assign/", assign_view),
    path("available-machines/", available_machines_view),
    path("save/", save_view),
    path("", include(router.urls)),
]
