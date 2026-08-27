from django.db import models


class Employee(models.Model):
    """Local employee record for camera attendance FKs (HR master lives in cuttingedgedb)."""

    emp_id = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=100)
    face_encoding = models.JSONField(blank=True, null=True)
    profile_image = models.ImageField(blank=True, upload_to="employees/")
    department = models.CharField(max_length=100)
    designation = models.CharField(max_length=100)
    skill_set = models.JSONField(blank=True, default=list)

    class Meta:
        ordering = ["emp_id"]

    def __str__(self) -> str:
        return f"{self.name} ({self.emp_id})"
