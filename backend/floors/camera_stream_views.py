"""Dashboard live CCTV snapshot / MJPEG stream from RTSP."""

from django.http import HttpResponse, JsonResponse, StreamingHttpResponse
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from floors.camera_data_views import CameraIngestPermission
from floors.camera_live import (
    annotate_faces_jpeg,
    build_rtsp_for_time,
    capture_detect_jpeg,
    capture_live_jpeg,
    iter_mjpeg_stream,
    mask_rtsp_url,
    normalize_live_rtsp_url,
)

from floors.camera_zones import resolve_rtsp_from_params
from floors.face_match import recognize_and_annotate
from floors.face_track import ensure_tracking, get_tracked_jpeg

_DETECT_TRUE = {"1", "true", "yes", "face", "faces", "on"}


def _rtsp_from_request(request):
    """Resolve the effective RTSP url (and zone) for this request.

    Uses the live stream by default; if starttime & endtime are supplied the
    resolved zone camera is switched to recorded playback for that window.
    """
    station = request.query_params.get("station") or request.GET.get("station") or ""
    station_no = request.query_params.get("station_no") or request.GET.get("station_no") or ""
    zone = request.query_params.get("zone") or request.GET.get("zone") or ""
    starttime = request.query_params.get("starttime") or request.GET.get("starttime") or ""
    endtime = request.query_params.get("endtime") or request.GET.get("endtime") or ""

    base_url, zone_num = resolve_rtsp_from_params(station=station, station_no=station_no, zone=zone)
    effective = build_rtsp_for_time(base_url, starttime, endtime)
    return effective, zone_num


class QueryParamJWTAuthentication(JWTAuthentication):
    """Allow <img src> streams to pass ?access=<jwt>."""

    def authenticate(self, request):
        token = (request.query_params.get("access") or request.GET.get("access") or "").strip()
        if token and not request.META.get("HTTP_AUTHORIZATION"):
            request.META["HTTP_AUTHORIZATION"] = f"Bearer {token}"
        return super().authenticate(request)


class CameraLiveConfigView(APIView):
    """GET /api/camera/live/config/ — whether RTSP is configured (no password in response)."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        configured, zone = _rtsp_from_request(request)
        live_url = normalize_live_rtsp_url(configured) if configured else ""
        return JsonResponse(
            {
                "configured": bool(live_url),
                "zone": zone,
                "stream_url": mask_rtsp_url(live_url) if live_url else "",
                "snapshot_endpoint": "/api/camera/live/snapshot/",
                "mjpeg_endpoint": "/api/camera/live/mjpeg/",
                "note": "Snapshot polling is used in the browser; MJPEG may not work with Daphne.",
            }
        )


class CameraLiveSnapshotView(APIView):
    """GET /api/camera/live/snapshot/ — latest JPEG frame from configured RTSP."""

    authentication_classes = [QueryParamJWTAuthentication, JWTAuthentication]
    permission_classes = [CameraIngestPermission]

    def get(self, request):
        rtsp, _zone = _rtsp_from_request(request)
        detect = (request.query_params.get("detect") or "").strip().lower() in _DETECT_TRUE
        emp = (request.query_params.get("emp") or "").strip()
        label = (request.query_params.get("label") or "").strip()

        rtsp_url = rtsp
        jpeg = err = None

        if detect and emp:
            # Preferred path: a continuous detect→confirm→track loop keeps the red
            # box locked on the exact person, even when they turn away.
            track_key = ensure_tracking(rtsp, emp, label or None)
            jpeg, err = get_tracked_jpeg(track_key)
            if not jpeg:
                # While the tracker warms up, fall back to a high-res single-frame
                # recognition so the user sees the feed immediately.
                jpeg, err, rtsp_url = capture_detect_jpeg(rtsp)
                if not jpeg:
                    jpeg, err, rtsp_url = capture_live_jpeg(rtsp)
                if jpeg:
                    annotated = recognize_and_annotate(jpeg, emp, label or None)
                    jpeg = annotated if annotated is not None else annotate_faces_jpeg(jpeg, label or None)
        else:
            jpeg, err, rtsp_url = capture_live_jpeg(rtsp)

        if jpeg:
            response = HttpResponse(jpeg, content_type="image/jpeg")
            response["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response["X-Camera-Rtsp"] = mask_rtsp_url(rtsp_url)
            return response

        return JsonResponse(
            {
                "detail": err or "Camera snapshot unavailable",
                "stream_url": mask_rtsp_url(rtsp_url) if rtsp_url else "",
                "hint": "Set CAMERA_RTSP_LIVE_URL in .env and install opencv-python-headless on the API server.",
            },
            status=503,
            headers={"Retry-After": "0.5"},
        )


class CameraLiveMjpegView(APIView):
    """GET /api/camera/live/mjpeg/ — multipart MJPEG push stream (lowest browser latency)."""

    authentication_classes = [QueryParamJWTAuthentication, JWTAuthentication]
    permission_classes = [CameraIngestPermission]

    def get(self, request):
        rtsp, _zone = _rtsp_from_request(request)
        if not rtsp:
            return JsonResponse(
                {"detail": "CAMERA_RTSP_LIVE_URL or CAMERA_RTSP_URL is not set"},
                status=503,
            )

        response = StreamingHttpResponse(
            iter_mjpeg_stream(rtsp),
            content_type="multipart/x-mixed-replace; boundary=frame",
        )
        response["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response["Connection"] = "keep-alive"
        response["X-Accel-Buffering"] = "no"
        return response
