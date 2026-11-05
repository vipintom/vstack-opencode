export const ROUTE_MARKER = "[vstack:route]";

export const ROUTE_INSTRUCTION = `${ROUTE_MARKER} vstack is installed. Before loading skills or starting work, call vstack_route with no arguments. If no delivery is open, route the request with vstack_route and record the playbook, tier, outcome and done-when. Do not load more than two skills before routing.`;

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
