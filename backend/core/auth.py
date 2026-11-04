from django.contrib.auth import get_user_model
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView

User = get_user_model()


class EmailOrUsernameTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Accept Django username or email in the `username` field."""

    def validate(self, attrs):
        login = (attrs.get(self.username_field) or "").strip()
        if login and "@" in login:
            user = User.objects.filter(email__iexact=login).first()
            if user is not None:
                attrs[self.username_field] = user.get_username()
        return super().validate(attrs)


class EmailOrUsernameTokenObtainPairView(TokenObtainPairView):
    serializer_class = EmailOrUsernameTokenObtainPairSerializer


class MeView(APIView):
    """GET /api/auth/me/ — the current user and their capabilities."""

    def get(self, request):
        from mbm_automation.manhour_override import can_edit

        u = request.user
        return Response(
            {
                "id": u.id,
                "username": u.get_username(),
                "email": u.email,
                "is_staff": u.is_staff,
                "is_superuser": u.is_superuser,
                "can_edit_count_from": can_edit(u),
            }
        )
