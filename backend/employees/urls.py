from django.urls import path

from employees.views import (
    HrEmployeeListView,
    LayoutOptionDetailView,
    LayoutOptionListView,
    LineOptionDetailView,
    LineOptionListView,
    StationOptionDetailView,
    StationOptionListView,
    StationOptionLookupView,
)

urlpatterns = [
    path("hr-employees/", HrEmployeeListView.as_view()),
    path("layouts/", LayoutOptionListView.as_view()),
    path("layouts/<int:pk>/", LayoutOptionDetailView.as_view()),
    path("lines/", LineOptionListView.as_view()),
    path("lines/<int:pk>/", LineOptionDetailView.as_view()),
    path("stations/", StationOptionListView.as_view()),
    path("stations/lookup/", StationOptionLookupView.as_view()),
    path("stations/<int:pk>/", StationOptionDetailView.as_view()),
]
