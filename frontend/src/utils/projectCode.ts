import type { Project, Vehicle } from "@/types/domain";

/** Project Code: exactly 8 digits (same rule as the server). */
export const PROJECT_CODE = /^\d{8}$/;

export function projectCodeError(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  if (!t) return "Project Code is required";
  if (!PROJECT_CODE.test(t)) return "Project Code must be exactly 8 digits (0-9 only)";
  return null;
}

export interface ProjectGroup {
  /** Roadshow and Signage never share a group, even with the same code; requests without a code are their own group. */
  key: string;
  projectType: Project["projectType"];
  projectCode: string | null;
  clientName: string;
  startDate: string | null;
  endDate: string | null;
  vehicleCount: number;
  budgetsCreated: number;
  lastCreatedAt: string;
  requests: Project[];
  /** Every vehicle of the project with its own request (Trackup / PIF / Display stay per vehicle). */
  rows: { p: Project; v: Vehicle; position: number }[];
}

const campaignOf = (p: Project) => {
  const d = p.details ?? {};
  const roadshow = p.projectType === "ROADSHOW";
  return { from: String((roadshow ? d.startDate : d.fromDate) ?? "") || null, to: String((roadshow ? d.endDate : d.toDate) ?? "") || null };
};

/**
 * Groups tracking requests by Project Code within each project type. Input order (newest request first) decides the group
 * order; inside a group the vehicles are listed oldest request first, then by vehicle number.
 */
export function groupByProjectCode(projects: Project[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const p of projects) {
    const code = p.projectCode && PROJECT_CODE.test(p.projectCode) ? p.projectCode : null;
    const key = code ? `${p.projectType}:${code}` : `request:${p._id}`;
    const { from, to } = campaignOf(p);
    let g = groups.get(key);
    if (!g) {
      g = { key, projectType: p.projectType, projectCode: code, clientName: p.clientName, startDate: from, endDate: to, vehicleCount: 0, budgetsCreated: 0, lastCreatedAt: p.createdAt, requests: [], rows: [] };
      groups.set(key, g);
    }
    g.requests.push(p);
    if (from && (!g.startDate || from < g.startDate)) g.startDate = from;
    if (to && (!g.endDate || to > g.endDate)) g.endDate = to;
    if (p.createdAt > g.lastCreatedAt) g.lastCreatedAt = p.createdAt;
  }
  for (const g of groups.values()) {
    const ordered = [...g.requests].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    g.rows = ordered.flatMap((p) => [...p.vehicles].sort((a, b) => a.vehicleIndex - b.vehicleIndex).map((v) => ({ p, v, position: 0 })));
    g.rows.forEach((r, i) => (r.position = i + 1));
    g.vehicleCount = g.rows.length;
    g.budgetsCreated = g.rows.filter((r) => r.v.budgetStatus === "CREATED").length;
  }
  return [...groups.values()];
}
