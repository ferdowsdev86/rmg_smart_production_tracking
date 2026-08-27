import { FinishingDepartmentFloorPlan } from "./FinishingDepartmentFloorPlan";

/** Floor plan view for /lines (finishing department template). */
export function FinishingLinePlanBoard({ data, processes }) {
  return <FinishingDepartmentFloorPlan data={data} processes={processes} />;
}
