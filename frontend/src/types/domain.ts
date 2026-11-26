import type { KmAllowance } from "@/utils/kmAllowance";

export type RoleKey = "RSOP" | "RBP" | "RSOM" | "RSA" | "RSO";
export type ProjectType = "ROADSHOW" | "SIGNAGE";

export interface RoleInfo {
  label: string;
  defaultUsername: string;
  description: string;
}
export type RolesMap = Record<RoleKey, RoleInfo>;

export interface AuthUser {
  username: string;
  role: RoleKey;
}

export interface Vehicle {
  _id: string;
  project: string;
  vehicleIndex: number;
  trackupNumber: string;
  pifNumber: string;
  displayNumber: string;
  budgetStatus: "PENDING" | "CREATED";
  approvalStatus?: "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | null;
  createdAt: string;
}

export type Details = Record<string, string | number | string[] | undefined>;

export interface Project {
  _id: string;
  projectType: ProjectType;
  clientName: string;
  /** 8-digit Project Code (absent on requests created before it existed). */
  projectCode?: string;
  vehicleCount: number;
  details: Details;
  createdByName: string;
  createdAt: string;
  vehicles: Vehicle[];
}

export interface Stats {
  total: number;
  roadshow: number;
  signage: number;
  pendingBudget: number;
  budgetCreated: number;
  recent: { _id: string; trackupNumber: string; createdAt: string }[];
}

/** Saved budget payload. v2 (schemaVersion 2) is the redesigned form; older records have the legacy shape. */
export type BudgetData = Record<string, unknown>;

export interface Budget {
  _id: string;
  budgetNumber: string;
  data: BudgetData;
  total: number;
  currentVersion: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  approvalStatus?: "DRAFT" | "PENDING" | "APPROVED" | "REJECTED";
  submittedVersion?: number;
  submittedBy?: string;
  submittedAt?: string;
  resubmissionComment?: string;
  approvedVersion?: number;
  rejectedVersion?: number;
  reviewedBy?: string;
  reviewedAt?: string;
  rejection?: Rejection;
}

export interface Rejection {
  version: number;
  reason: string | null;
  fields: { field: string; comment: string }[];
  rejectedBy: string;
  rejectedAt: string;
}

export interface BudgetEvent {
  _id: string;
  version: number;
  action: "CREATED" | "UPDATED" | "SUBMITTED" | "RESUBMITTED" | "APPROVED" | "REJECTED";
  username: string;
  role: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface AppNotification {
  _id: string;
  type: string;
  title: string;
  message: string;
  link: string;
  read: boolean;
  createdAt: string;
}

export interface Stamp {
  at: string;
  by: string;
  version: number;
  superseded?: boolean;
}

export interface Activity {
  createdAt: string | null;
  createdBy: string;
  lastEdited: Stamp | null;
  lastSubmitted: Stamp | null;
  lastResubmitted: Stamp | null;
  lastApproved: Stamp | null;
  lastRejected: Stamp | null;
  currentStatus: string;
}

export interface BudgetContext {
  projectType: ProjectType;
  client: string;
  jobSheetNumber: string | null;
  paSystem: string | null;
  sundayHalt: boolean;
  location: string;
  campaignFrom: string;
  campaignTo: string;
  reportingDate: string | null;
  numberOfDays: number | string;
  /** RoadShow KM allotment incl. the one-time Extra KM pool (null for signage; absent from older servers). */
  km?: KmAllowance | null;
  trackupNumber: string;
  pifNumber: string;
  displayNumber: string;
  vehicleIndex: number;
}

export interface BudgetVersion {
  _id: string;
  version: number;
  data: BudgetData;
  total: number;
  changes: { field: string; from: unknown; to: unknown }[];
  updatedBy: string;
  createdAt: string;
}

export interface Attachment {
  storage: "local" | "space";
  key: string;
  name: string;
  size: number;
  mimeType: string;
  url?: string;
}

export interface VehicleDoc {
  nextRenewalDate: string;
  attachment: Attachment | null;
}

export interface VehicleAvailability {
  status?: "AVAILABLE" | "IN_USE" | "ISSUE" | null;
  availableFromDate?: string | null;
  availableFromTime?: string | null;
  project?: {
    trackingProject?: string | null; projectType?: string | null; projectName?: string | null; clientName?: string | null;
    trackupNumber?: string | null; pifNumber?: string | null; startDate?: string | null; endDate?: string | null;
    location?: string | null; remarks?: string | null;
  } | null;
  expectedReleaseDate?: string | null;
  expectedReleaseTime?: string | null;
  nextAvailableDate?: string | null;
  nextAvailableTime?: string | null;
  issue?: {
    category?: string | null; description?: string | null; reportedDate?: string | null; reportedTime?: string | null;
    expectedRepairDate?: string | null; expectedRepairTime?: string | null; garage?: string | null; repairRemarks?: string | null;
    issueStatus?: string | null;
  } | null;
  nextAvailableAt?: string | null;
  issueResolvedAt?: string | null;
}

export interface Vehicle {
  _id: string;
  vehicleNo?: string | null;
  make?: string | null;
  model?: string | null;
  type?: string | null;
  yearOfManufacture?: number | null;
  purchaseDate?: string | null;
  currentRunning?: number | null;
  totalRunning?: number | null;
  stepneyStatus?: string | null;
  batteryStatus?: string | null;
  oilTopUpOn?: string | null;
  greasePackingOn?: string | null;
  generalCheckUpOn?: string | null;
  fc: VehicleDoc[];
  insurance: VehicleDoc[];
  rtoPermission: VehicleDoc[];
  policePermission: VehicleDoc[];
  permit: VehicleDoc[];
  condition?: string | null;
  specification?: string | null;
  status: "DRAFT" | "ACTIVE" | "INACTIVE";
  insuranceExpiry?: string | null;
  fcExpiry?: string | null;
  insuranceStatus: "VALID" | "EXPIRING_SOON" | "EXPIRED" | "NONE";
  fcStatus: "VALID" | "EXPIRING_SOON" | "EXPIRED" | "NONE";
  availability?: VehicleAvailability | null;
  allocatable?: boolean;
  allocationNote?: string;
  releaseOverdue?: boolean;
  allocationReview?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface VehicleHistoryRow {
  _id: string;
  action: string;
  changes: { field: string; from: unknown; to: unknown }[];
  username: string;
  createdAt: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  reason?: string | null;
  project?: { projectName?: string | null; clientName?: string | null; trackupNumber?: string | null; pifNumber?: string | null } | null;
  issueReason?: string | null;
}

// ---- vehicle allotment
export interface AvailableVehicle { _id: string; vehicleNo: string; make: string | null; model: string | null; type: string | null }

/** A driver that can be assigned right now (Available Now only): what a suggestion shows. */
export interface AvailableDriver { _id: string; driverNumber: string; driverName: string; driverType: "COMPANY_DRIVER" | "ACTING_DRIVER"; mobileNumber: string }
/** The driver currently on an allotment (null = Driver Not Assigned). */
export interface AllotmentDriverRef { driverId: string; driverNumber: string | null; driverName: string | null; driverType: string | null; mobileNumber: string | null; assignedAt: string | null }
export interface AllotmentRef {
  _id: string; vehicleId: string; vehicleNo: string; allottedAt: string; expectedReleaseAt: string | null; nextAvailableAt: string | null; remarks: string | null;
  driver?: AllotmentDriverRef | null; // absent on older API responses
}
export interface AllotmentProject {
  trackingProject: string; trackingVehicle: string; budget: string | null; budgetVersion: number | null; budgetNumber?: string;
  projectType: string; projectName: string; clientName: string; trackupNumber: string; pifNumber: string; billNumber: string | null;
  startDate: string | null; endDate: string | null; location: string | null;
  totalAllowedKm?: number | null; extraKmAllotted?: number | null; // RoadShow KM allotment (read-only)
  vehicleCount: number | null; budgetAmount: number | null; approvedAt: string | null; budgetStatus: string; allotment: AllotmentRef | null;
}
export interface Allotment {
  _id: string; vehicle: string; vehicleNo: string; vehicleMake?: string; vehicleModel?: string;
  trackupNumber: string; pifNumber: string; billNumber?: string | null; clientName: string; projectType: string; projectName: string;
  projectStart?: string | null; projectEnd?: string | null;
  allottedAt: string; expectedReleaseAt?: string | null; nextAvailableAt: string | null; remarks?: string | null;
  status: "ACTIVE" | "RELEASED" | "CHANGED"; releasedAt?: string; releaseReason?: string; source?: string;
  previousAllotment?: string; changedFromVehicleNo?: string; changeReason?: string; changeRemarks?: string; changeAttachments: Attachment[]; changedAt?: string;
  driver?: string; driverNumber?: string; driverName?: string; driverType?: string; driverMobile?: string; driverAssignedAt?: string; driverAssignedBy?: string; driverReleasedAt?: string;
  createdBy: string; updatedBy: string; createdAt: string; updatedAt: string;
}
export interface AllotmentEventRow { _id: string; action: string; username: string; details: Record<string, unknown> | null; createdAt: string }
export interface AllotmentDetailData {
  allotment: Allotment;
  original: { vehicleNo: string; vehicleMake?: string; vehicleModel?: string } | null;
  current: { vehicleNo: string; vehicleMake?: string; vehicleModel?: string; status: string } | null;
  chain: Allotment[];
  vehicle: { vehicleNo?: string; make?: string; model?: string; type?: string; availabilityStatus?: string | null } | null;
  /** The allotment's driver (live status included); null / absent = Driver Not Assigned. */
  driver?: {
    driverId: string; active: boolean; driverNumber: string | null; driverName: string | null; driverType: string | null; mobileNumber: string | null;
    assignedAt: string | null; assignedBy: string | null; releasedAt: string | null; status: string | null;
  } | null;
  events: AllotmentEventRow[];
}

// ---- driver management
export interface Driver {
  _id: string; driverNumber: string; driverName: string; driverType: "COMPANY_DRIVER" | "ACTING_DRIVER";
  address?: string | null; mobileNumber: string; accountName?: string | null; accountNumber?: string | null; ifscCode?: string | null;
  bankName?: string | null; licenceNumber?: string | null; licenceType?: string | null; licenceExpiryDate?: string | null;
  attachment: Attachment | null; salary: number; status: "ACTIVE" | "INACTIVE";
  availability?: DriverAvailability | null; // absent on drivers created before availability existed
  createdBy: string; updatedBy: string; createdAt: string; updatedAt: string;
}
export type DriverAvStatus = "AVAILABLE" | "IN_USE" | "NOT_AVAILABLE";
export interface DriverAvailability {
  status: DriverAvStatus | null; availableFromDate?: string | null; availableFromTime?: string | null;
  project?: {
    trackingProject?: string | null; trackingVehicle?: string | null; budget?: string | null; budgetVersion?: number | null; projectType?: string | null;
    projectName?: string | null; clientName?: string | null; trackupNumber?: string | null; pifNumber?: string | null;
    startDate?: string | null; endDate?: string | null; remarks?: string | null;
  } | null;
  notAvailable?: { reason?: string | null; category?: string | null; fromDate?: string | null; expectedAvailableDate?: string | null; remarks?: string | null } | null;
  lastStatusUpdatedBy?: string | null; lastStatusUpdatedAt?: string | null; autoReleasedAt?: string | null;
}
export interface DriverHistoryRow {
  _id: string; action: string; changes: { field: string; from: unknown; to: unknown }[]; username: string; createdAt: string;
  previousStatus?: string | null; newStatus?: string | null; project?: Record<string, unknown> | null; reason?: string | null;
}

// ---- driver advance (RBP, View Driver Details)
export interface DriverAdvanceRow {
  _id: string; driver: string; driverNumber: string; driverName: string; workingDays: number; perDaySalary: number; eligibleAdvanceAmount: number;
  calculatedHalfAmount: number; finalAdvanceAmount: number; roundingUnit: number; roundingMethod: string; submittedBy: string; submittedAt: string; createdAt: string;
}
