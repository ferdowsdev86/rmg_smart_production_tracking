from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from rest_framework_simplejwt.views import TokenRefreshView

from core.auth import EmailOrUsernameTokenObtainPairView


def health(_request):
    return JsonResponse({"status": "ok", "service": "smart-finishing-floor-api"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health),
    path("api/auth/token/", EmailOrUsernameTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("api/auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("api/floors/", include("floors.urls")),
    path("api/employees/", include("employees.urls")),
    path("api/camera/", include("attendance.urls")),
    path("api/reports/", include("reports.urls")),
    path("api/automation/", include("mbm_automation.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
