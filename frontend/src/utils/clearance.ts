import { formatInr } from "./format";

export type ClearanceStatus = "YET_TO_APPROVE" | "APPROVED" | "REJECTED";
export type FinancialStatus = "NO_ADVANCE" | "NO_OUTSTANDING" | "OUTSTANDING" | "UNAVAILABLE";

export const STATUS_LABEL: Record<ClearanceStatus, string> = { YET_TO_APPROVE: "Yet to Approve", APPROVED: "Approved", REJECTED: "Rejected" };
export const REJECTION_REASONS = [
  "Outstanding Driver Advance", "Driver Financial Verification Failed", "Invalid Driver Details", "Invalid Vehicle Details", "Missing Documents", "Other",
] as const;
export const ACTION_LABEL: Record<string, string> = {
  ALLOCATED: "Vehicle & Driver Allocated", SUBMITTED: "Submitted for RSA Clearance", RESUBMITTED: "Resubmitted", APPROVED: "Approved", REJECTED: "Rejected",
  DRIVER_CHANGED: "Driver Changed", VEHICLE_CHANGED: "Vehicle Changed", ALLOCATION_UPDATED: "Allocation Updated",
};

export interface ClearanceRow {
  _id: string; trackupNumber: string; pifNumber: string; billNumber: string | null; projectType: "ROADSHOW" | "SIGNAGE" | null; clientName: string | null;
  vehicleNo: string; driverNumber: string; driverName: string; outstandingAdvance: number | null; financialStatus: FinancialStatus | null; status: ClearanceStatus;
  version: number; submittedAt: string; submittedBy: string; reviewedAt: string | null; reviewedBy: string | null; rejectionReason: string | null;
  projectName?: string | null; deliveryStatus?: DeliveryStatus | null; deliveredAt?: string | null; deliveredBy?: string | null; approvedAt?: string | null; approvedBy?: string | null;
}
export type DeliveryStatus = "YET_TO_DELIVER" | "DELIVERED";
export interface DeliveryPhoto { key: string; name: string; size: number; mimeType: string; url: string }
export interface DeliveryRecord { _id: string; approvalVersion: number; description: string; speedometerPhoto: DeliveryPhoto | null; evidencePhoto: DeliveryPhoto | null; deliveredBy: string; deliveredAt: string; approvedBy: string | null; approvedAt: string | null }
export interface DeliverySummary { total: number; approved: number; yetToApprove: number; rejected: number; yetToDeliver: number; delivered: number }
export interface DeliveryHistoryRow { _id: string; version: number; action: string; username: string; role: string; at: string; details: Record<string, unknown> | null }
export interface ClearanceSummary { total: number; yetToApprove: number; approved: number; rejected: number }
export interface ClearanceFinancial {
  status: FinancialStatus; totalAdvance: number; totalSettled: number | null; outstanding: number | null; canApprove: boolean; message: string; settlementDataAvailable: boolean;
  advances: { _id: string; submittedAt: string; workingDays: number; finalAdvanceAmount: number; submittedBy: string }[]; settlements: { amount: number }[];
}
export interface ClearanceHistoryRow { _id: string; version: number; action: string; username: string; role: string; at: string; details: Record<string, unknown> | null }
export interface ClearanceDetail extends ClearanceRow {
  project: {
    trackupNumber: string; pifNumber: string; billNumber: string | null; projectType: string | null; projectName: string | null; clientName: string | null; projectFrom: string | null; projectTo: string | null;
    location: string | null; approvedBudgetAmount: number | null; budgetNumber: string | null; rsomStatus: string | null; rsomApprovedBy: string | null; rsomApprovedAt: string | null;
  };
  vehicle: {
    _id: string; vehicleNo: string; make: string | null; model: string | null; type: string | null; status: string | null; availabilityStatus: string | null; allottedAt: string | null;
    expectedReleaseAt: string | null; nextAvailableAt: string | null; documents: { section: string; nextRenewalDate: string | null; attachment: { name: string; url: string } | null }[];
  };
  driver: {
    _id: string; driverNumber: string; driverName: string; driverType: string | null; mobileNumber: string | null; licenceNumber: string | null; licenceType: string | null; licenceExpiryDate: string | null;
    availabilityStatus: string | null; assignedAt: string | null; assignedBy: string | null; remarks: string | null;
    bank: { accountName: string | null; bankName: string | null; accountNumberMasked: string | null; ifscCode: string | null };
  };
  financial: ClearanceFinancial;
  rejection: { reason: string | null; remarks: string | null; rejectedBy: string | null; rejectedAt: string | null } | null;
  current: { allotmentId: string; vehicleNo: string; driverNumber: string | null; driverName: string | null; hasDriver: boolean } | null;
  allocationActive: boolean; changedSinceSubmission: boolean; canApprove: boolean; approveBlockedReason: string | null; canResubmit: boolean; history: ClearanceHistoryRow[];
  // present on the RBP (Vehicle Deliver) detail only
  canDeliver?: boolean; delivery?: DeliveryRecord | null; deliveryHistory?: DeliveryHistoryRow[];
}

export interface ClearanceFilters { q: string; status: string; projectType: string; from: string; to: string }
export const emptyClearanceFilters = (): ClearanceFilters => ({ q: "", status: "", projectType: "", from: "", to: "" });
export const clearanceFiltersActive = (f: ClearanceFilters) => !!(f.q.trim() || f.status || f.projectType || f.from || f.to);

/** Query string for the clearance list APIs: every filter is applied on the server, together. */
export function clearanceQuery(f: ClearanceFilters, page: number, limit: number): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.status) p.set("status", f.status);
  if (f.projectType) p.set("projectType", f.projectType);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  p.set("page", String(page));
  p.set("limit", String(limit));
  return p.toString();
}

/** Outstanding advance for display: an unverifiable amount is "Not Available", never ₹0. */
export const outstandingText = (amount: number | null | undefined, status: FinancialStatus | null | undefined): string =>
  status === "UNAVAILABLE" || amount === null || amount === undefined ? "Not Available" : formatInr(amount);

export const financialLabel = (s: FinancialStatus | null | undefined): string =>
  s === "NO_ADVANCE" || s === "NO_OUTSTANDING" ? "No Outstanding Advance" : s === "OUTSTANDING" ? "Outstanding Advance" : s === "UNAVAILABLE" ? "Verification Data Unavailable" : "—";

export const MAX_REMARKS = 500;
/** Client-side mirror of the server's rejection rules (the server still enforces them). */
export function validateRejection(reason: string, remarks: string): string[] {
  const errors: string[] = [];
  if (!reason) errors.push("Rejection reason is required");
  else if (!(REJECTION_REASONS as readonly string[]).includes(reason)) errors.push("Choose one of the listed rejection reasons");
  if (remarks.trim().length > MAX_REMARKS) errors.push(`Remarks are too long (max ${MAX_REMARKS})`);
  if (reason === "Other" && remarks.trim().length < 5) errors.push("A detailed explanation is required when the reason is Other");
  return errors;
}
