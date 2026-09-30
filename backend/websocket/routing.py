from django.urls import path

from . import consumers

websocket_urlpatterns = [
    path("ws/floor/", consumers.FloorConsumer.as_asgi()),
    path("ws/line/<int:line_id>/", consumers.LineConsumer.as_asgi()),
    path("ws/camera/", consumers.CameraConsumer.as_asgi()),
    path("ws/sewing-board/", consumers.SewingBoardConsumer.as_asgi()),
]
