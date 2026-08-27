export function parseFloorDashboardMessage(msg) {
  if (!msg || typeof msg !== "object") return null;
  if (msg.type === "floor_snapshot") return msg.data;
  if (msg.type === "floor.stats") return msg.data;
  return null;
}
