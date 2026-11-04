"""Create (or update) a user allowed to edit the Man Hour COUNT FROM column.

    python manage.py create_manhour_editor <username> <password> [--email a@b.c]

Ensures the ``manhour_editor`` group exists, creates the user if needed (or
updates the password of an existing one), and adds them to the group. Only
members of that group (plus superusers) may edit COUNT FROM.

To grant access to an EXISTING user without changing their password, omit the
password:

    python manage.py create_manhour_editor <username>
"""

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand, CommandError

from mbm_automation.manhour_override import GROUP_NAME


class Command(BaseCommand):
    help = "Create/grant a Man Hour COUNT FROM editor account."

    def add_arguments(self, parser):
        parser.add_argument("username")
        parser.add_argument("password", nargs="?", default=None)
        parser.add_argument("--email", default="")

    def handle(self, *args, **options):
        User = get_user_model()
        username = options["username"].strip()
        password = options["password"]
        email = options["email"].strip()
        if not username:
            raise CommandError("username is required")

        group, _ = Group.objects.get_or_create(name=GROUP_NAME)

        user = User.objects.filter(username=username).first()
        created = False
        if user is None:
            if not password:
                raise CommandError(
                    f"User '{username}' does not exist — provide a password to create it."
                )
            user = User(username=username, email=email, is_active=True, is_staff=False)
            created = True

        if password:
            user.set_password(password)
        if email:
            user.email = email
        user.is_active = True
        user.save()
        user.groups.add(group)

        action = "Created" if created else "Updated"
        pw = "set" if password else "unchanged"
        self.stdout.write(
            self.style.SUCCESS(
                f"{action} user '{username}' (password {pw}); added to '{GROUP_NAME}'. "
                f"They can now edit COUNT FROM."
            )
        )
