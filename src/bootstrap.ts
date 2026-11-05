export const ROUTE_MARKER = "[vstack:route]";

export const ROUTE_INSTRUCTION = `${ROUTE_MARKER} vstack is installed. State already in context; do not call vstack_route with no arguments to re-read. Before loading skills or starting work, open or resume a delivery with vstack_route and record the playbook, tier, outcome and done-when. Do not load more than two skills before routing. No prose between tool calls.`;

export interface SystemText {
  type: "text";
  text: string;
}

/** Append the route instruction once per model context. Returns true when added. */
export function ensureRouteInstruction(system: SystemText[]): boolean {
  if (system.some((part) => part.text.includes(ROUTE_MARKER))) return false;
  system.push({ type: "text", text: ROUTE_INSTRUCTION });
  return true;
}
