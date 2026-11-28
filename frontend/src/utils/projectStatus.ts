import type { Project } from "@/types/domain";

export function overallStatus(p: Pick<Project, "vehicles">): "PENDING" | "CREATED" | "PARTIAL" {
  const done = p.vehicles.filter((v) => v.budgetStatus === "CREATED").length;
  return done === 0 ? "PENDING" : done === p.vehicles.length ? "CREATED" : "PARTIAL";
}

export const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "PENDING_APPROVAL", label: "Pending Approval" },
  { value: "REJECTED", label: "Rejected" },
  { value: "APPROVED", label: "Approved" },
  { value: "PARTIAL", label: "Partially Budgeted" },
  { value: "CREATED", label: "Budget Created" },
] as const;

/** Approval filters match a project with any such vehicle budget; the other two match the project's budgeting status. */
export function matchesStatus(p: Pick<Project, "vehicles">, filter: string): boolean {
  if (!filter) return true;
  if (filter === "PARTIAL" || filter === "CREATED") return overallStatus(p) === filter;
  const approval = filter === "PENDING_APPROVAL" ? "PENDING" : filter;
  return p.vehicles.some((v) => v.approvalStatus === approval);
}
