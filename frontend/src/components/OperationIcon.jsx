import {
  Activity,
  BadgeCheck,
  CircleDot,
  Layers,
  LayoutGrid,
  Ruler,
  Scissors,
  Shirt,
  Sparkles,
  Tag,
  ThermometerSun,
} from "lucide-react";

const MAP = {
  collar_attach: Shirt,
  sleeve_attach: Scissors,
  side_seam: Layers,
  bottom_hem: Ruler,
  button_hole: CircleDot,
  button_attach: CircleDot,
  label_attach: Tag,
  back_tack: Sparkles,
  trimming: Scissors,
  ironing: ThermometerSun,
  inspection: BadgeCheck,
  folding: Layers,
};

export function OperationIcon({ operationType, className = "h-5 w-5" }) {
  const Icon = MAP[operationType] || LayoutGrid;
  return <Icon className={className} aria-hidden />;
}
