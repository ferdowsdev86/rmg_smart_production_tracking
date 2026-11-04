"""Seed the Sewing Line Layout Planner with sample data.

Idempotent: clears ONLY the planner's own lp_* tables and reseeds. Existing
finishing line-layout data is never touched.

    python manage.py seed_line_planner
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from line_planner.models import (
    Layout,
    Machine,
    MachineType,
    OBOperation,
    PlannerLine,
    Station,
    Style,
)

# code, name, badge colour
MACHINE_TYPES = [
    ("SNLS", "Single Needle Lock Stitch", "#2563eb"),
    ("DNLS", "Double Needle Lock Stitch", "#7c3aed"),
    ("OL-3T", "Overlock 3-Thread", "#059669"),
    ("OL-4T", "Overlock 4-Thread", "#0d9488"),
    ("OL-5T", "Overlock 5-Thread", "#0891b2"),
    ("FL", "Flat Lock", "#d97706"),
    ("BH", "Button Hole", "#dc2626"),
    ("BS", "Button Stitch", "#db2777"),
    ("KANSAI", "Kansai Special", "#9333ea"),
    ("BT", "Bartack", "#ca8a04"),
    ("IRON", "Iron / Press", "#64748b"),
    ("HAND", "Hand / Manual table", "#94a3b8"),
]

LINES = [
    ("Line 1", "Sewing Floor", 40, PlannerLine.SHAPE_STRAIGHT),
    ("Line 2", "Sewing Floor", 40, PlannerLine.SHAPE_U),
    ("Line 3", "Sewing Floor", 36, PlannerLine.SHAPE_ZIGZAG),
]

# How many of each type to stock per line (sums to ~40)
LINE_MACHINE_MIX = [
    ("SNLS", 16),
    ("DNLS", 3),
    ("OL-4T", 7),
    ("OL-5T", 3),
    ("FL", 4),
    ("BH", 1),
    ("BS", 1),
    ("KANSAI", 1),
    ("BT", 2),
    ("IRON", 1),
    ("HAND", 1),
]

# (seq, operation, machine code, smv, section, grade)
POLO_OB = [
    (1, "Collar run stitch", "SNLS", 0.45, "Collar", "B"),
    (2, "Collar top stitch", "SNLS", 0.50, "Collar", "B"),
    (3, "Collar band join", "SNLS", 0.55, "Collar", "A"),
    (4, "Collar band close", "SNLS", 0.48, "Collar", "B"),
    (5, "Placket make", "SNLS", 0.70, "Front", "A"),
    (6, "Placket attach", "SNLS", 0.80, "Front", "A"),
    (7, "Placket top stitch", "SNLS", 0.55, "Front", "B"),
    (8, "Pocket hem", "SNLS", 0.35, "Front", "C"),
    (9, "Pocket attach", "SNLS", 0.60, "Front", "B"),
    (10, "Shoulder join", "OL-4T", 0.45, "Assembly", "B"),
    (11, "Shoulder top stitch", "FL", 0.40, "Assembly", "B"),
    (12, "Collar attach", "SNLS", 0.85, "Assembly", "A"),
    (13, "Collar close", "SNLS", 0.60, "Assembly", "A"),
    (14, "Sleeve hem", "FL", 0.45, "Sleeve", "C"),
    (15, "Sleeve attach", "OL-4T", 0.75, "Sleeve", "A"),
    (16, "Side seam", "OL-5T", 0.80, "Assembly", "B"),
    (17, "Armhole top stitch", "FL", 0.50, "Sleeve", "B"),
    (18, "Bottom hem", "FL", 0.55, "Assembly", "B"),
    (19, "Button hole", "BH", 0.30, "Finishing", "C"),
    (20, "Button attach", "BS", 0.30, "Finishing", "C"),
    (21, "Bartack", "BT", 0.20, "Finishing", "C"),
    (22, "Thread trim & check", "HAND", 0.40, "Finishing", "C"),
    (23, "Final press", "IRON", 0.60, "Finishing", "B"),
]

TSHIRT_OB = [
    (1, "Shoulder join", "OL-4T", 0.40, "Assembly", "B"),
    (2, "Neck rib make", "OL-4T", 0.35, "Collar", "C"),
    (3, "Neck rib attach", "OL-4T", 0.60, "Collar", "A"),
    (4, "Neck top stitch", "FL", 0.45, "Collar", "B"),
    (5, "Back neck tape", "SNLS", 0.40, "Back", "B"),
    (6, "Label attach", "SNLS", 0.25, "Back", "C"),
    (7, "Sleeve hem", "FL", 0.40, "Sleeve", "C"),
    (8, "Sleeve attach", "OL-4T", 0.70, "Sleeve", "A"),
    (9, "Side seam", "OL-5T", 0.75, "Assembly", "B"),
    (10, "Armhole top stitch", "FL", 0.45, "Sleeve", "B"),
    (11, "Bottom hem", "FL", 0.50, "Assembly", "B"),
    (12, "Thread trim & check", "HAND", 0.35, "Finishing", "C"),
    (13, "Final press", "IRON", 0.55, "Finishing", "B"),
]

CHINO_OB = [
    (1, "Pocket bag make", "SNLS", 0.55, "Front", "B"),
    (2, "Front pocket attach", "SNLS", 0.80, "Front", "A"),
    (3, "Pocket top stitch", "DNLS", 0.60, "Front", "B"),
    (4, "Fly make", "SNLS", 0.70, "Front", "A"),
    (5, "Fly attach", "SNLS", 0.85, "Front", "A"),
    (6, "Zipper attach", "SNLS", 0.75, "Front", "A"),
    (7, "Back pocket make", "SNLS", 0.50, "Back", "B"),
    (8, "Back pocket attach", "SNLS", 0.80, "Back", "A"),
    (9, "Back rise join", "OL-5T", 0.55, "Back", "B"),
    (10, "Back rise top stitch", "DNLS", 0.60, "Back", "B"),
    (11, "Side seam", "OL-5T", 0.90, "Assembly", "B"),
    (12, "Side top stitch", "DNLS", 0.70, "Assembly", "B"),
    (13, "Inseam join", "OL-5T", 0.85, "Assembly", "B"),
    (14, "Waistband make", "KANSAI", 0.80, "Assembly", "A"),
    (15, "Waistband attach", "KANSAI", 1.10, "Assembly", "A"),
    (16, "Belt loop make", "KANSAI", 0.40, "Assembly", "C"),
    (17, "Belt loop attach", "BT", 0.60, "Assembly", "B"),
    (18, "Bottom hem", "DNLS", 0.55, "Finishing", "B"),
    (19, "Button hole", "BH", 0.35, "Finishing", "C"),
    (20, "Button attach", "BS", 0.30, "Finishing", "C"),
    (21, "Bartack", "BT", 0.40, "Finishing", "C"),
    (22, "Thread trim & check", "HAND", 0.45, "Finishing", "C"),
    (23, "Final press", "IRON", 0.90, "Finishing", "B"),
]

STYLES = [
    {"buyer": "H&M", "style_no": "PL-2201", "style_name": "Polo Shirt", "ob": POLO_OB,
     "description": "Classic pique polo with placket and rib collar."},
    {"buyer": "Zara", "style_no": "TS-1180", "style_name": "Basic T-Shirt", "ob": TSHIRT_OB,
     "description": "Single-jersey crew-neck tee."},
    {"buyer": "Uniqlo", "style_no": "CH-5540", "style_name": "Chino Trouser", "ob": CHINO_OB,
     "description": "Flat-front cotton chino with waistband and belt loops."},
]


class Command(BaseCommand):
    help = "Seed the Sewing Line Layout Planner with sample styles, lines and machines."

    @transaction.atomic
    def handle(self, *args, **options):
        # clear ONLY planner tables (safe, repeatable)
        Station.objects.all().delete()
        Layout.objects.all().delete()
        OBOperation.objects.all().delete()
        Style.objects.all().delete()
        Machine.objects.all().delete()
        PlannerLine.objects.all().delete()
        MachineType.objects.all().delete()

        types = {
            code: MachineType.objects.create(code=code, name=name, color=color)
            for code, name, color in MACHINE_TYPES
        }
        self.stdout.write(f"machine types: {len(types)}")

        lines = []
        for line_no, floor, max_st, shape in LINES:
            lines.append(
                PlannerLine.objects.create(
                    line_no=line_no, floor=floor, max_stations=max_st, shape=shape
                )
            )
        self.stdout.write(f"lines: {len(lines)}")

        machine_count = 0
        for li, line in enumerate(lines, start=1):
            for code, qty in LINE_MACHINE_MIX:
                for n in range(1, qty + 1):
                    # mostly running/idle, every ~13th machine in maintenance
                    machine_count += 1
                    status = (
                        Machine.STATUS_MAINTENANCE
                        if machine_count % 13 == 0
                        else (Machine.STATUS_RUNNING if n % 2 else Machine.STATUS_IDLE)
                    )
                    Machine.objects.create(
                        machine_no=f"L{li}-{code}-{n:02d}",
                        machine_type=types[code],
                        brand="JUKI" if code in ("SNLS", "DNLS") else "Brother",
                        model_no=f"{code}-{1000 + n}",
                        serial_no=f"SN{li}{code}{n:03d}",
                        current_line=line.line_no,
                        status=status,
                    )
        self.stdout.write(f"machines: {machine_count}")

        op_count = 0
        for sdef in STYLES:
            style = Style.objects.create(
                buyer=sdef["buyer"],
                style_no=sdef["style_no"],
                style_name=sdef["style_name"],
                description=sdef["description"],
            )
            for seq, op, mc, smv, section, grade in sdef["ob"]:
                OBOperation.objects.create(
                    style=style,
                    seq=seq,
                    operation_name=op,
                    machine_type=types[mc],
                    smv=smv,
                    section=section,
                    skill_grade=grade,
                )
                op_count += 1
        self.stdout.write(f"styles: {len(STYLES)}  ob operations: {op_count}")

        self.stdout.write(self.style.SUCCESS("Line planner seed complete."))
