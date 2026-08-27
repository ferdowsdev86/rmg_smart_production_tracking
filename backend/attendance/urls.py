
from django.urls import path

from attendance.views import CameraAlertView, CameraStatusDetailView, CameraStatusView
from floors.camera_data_views import CameraDataBulkIngestView, CameraDataIngestView
from floors.camera_stream_views import CameraLiveConfigView, CameraLiveMjpegView, CameraLiveSnapshotView

urlpatterns = [
    path("alert/", CameraAlertView.as_view()),
    path("data/", CameraDataIngestView.as_view()),
    path("data/bulk", CameraDataBulkIngestView.as_view()),
    path("data/bulk/", CameraDataBulkIngestView.as_view()),
    path("live/config/", CameraLiveConfigView.as_view()),
    path("live/mjpeg/", CameraLiveMjpegView.as_view()),
    path("live/snapshot/", CameraLiveSnapshotView.as_view()),
    path("status/", CameraStatusView.as_view()),
    path("status/<int:station_id>/", CameraStatusDetailView.as_view()),
]
