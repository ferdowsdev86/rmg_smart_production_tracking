from django.urls import path

from reports.views import (
    DailyLineReportView,
    EfficiencyReportView,
    ExportDailyExcelView,
    ExportDailyPdfView,
    HourlyReportView,
    MismatchReportView,
    QualityReportView,
)

urlpatterns = [
    path("daily/", DailyLineReportView.as_view()),
    path("quality/", QualityReportView.as_view()),
    path("hourly/", HourlyReportView.as_view()),
    path("efficiency/", EfficiencyReportView.as_view()),
    path("mismatch/", MismatchReportView.as_view()),
    path("export/daily.xlsx", ExportDailyExcelView.as_view()),
    path("export/daily.pdf", ExportDailyPdfView.as_view()),
]
