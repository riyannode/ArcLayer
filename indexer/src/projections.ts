import type { IndexedEscrowEvent } from "@arcwork/sdk";

export function buildJobProjection(events: IndexedEscrowEvent[]) {
  return events.reduce<Record<string, IndexedEscrowEvent[]>>((acc, event) => {
    const key = String(event.projectId ?? "unassigned");
    acc[key] ??= [];
    acc[key].push(event);
    return acc;
  }, {});
}

export function buildAgentProjection(events: IndexedEscrowEvent[]) {
  return events.reduce<Record<string, IndexedEscrowEvent[]>>((acc, event) => {
    const key = event.freelancer || "unknown";
    acc[key] ??= [];
    acc[key].push(event);
    return acc;
  }, {});
}
