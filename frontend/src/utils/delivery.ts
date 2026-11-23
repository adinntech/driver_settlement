import type { ClearanceRow, DeliveryStatus } from "./clearance";

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // the same limit the server enforces
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"] as const;
export const DESCRIPTION_MIN = 5;
export const DESCRIPTION_MAX = 1000;
export const EVIDENCE_HELPER = "Capture a photo showing the assigned driver standing in front of or seated inside the allocated vehicle. Ensure both the driver and vehicle are clearly visible.";

/** RBP status filter (Vehicle Deliver). "Approved by RSA" includes delivered ones; "Yet to Deliver" is approved and not delivered. */
export const RBP_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All" }, { value: "YET_TO_DELIVER", label: "Yet to Deliver" }, { value: "YET_TO_APPROVE", label: "Yet to Approve" },
  { value: "REJECTED", label: "Rejected by RSA" }, { value: "APPROVED", label: "Approved by RSA" }, { value: "DELIVERED", label: "Delivered" },
];
export const DELIVERY_LABEL: Record<DeliveryStatus, string> = { YET_TO_DELIVER: "Yet to Deliver", DELIVERED: "Delivered" };
export const RSA_LABEL = { YET_TO_APPROVE: "Pending", APPROVED: "Approved", REJECTED: "Rejected" } as const;

/** Deliver is offered only for an RSA-approved allocation that has not been delivered (the server re-checks everything). */
export const canShowDeliver = (r: Pick<ClearanceRow, "status" | "deliveryStatus">): boolean => r.status === "APPROVED" && r.deliveryStatus !== "DELIVERED";

/** Client-side photo check (type, size); the server validates the real file content again. */
export function validatePhoto(file: { name: string; type: string; size: number } | null | undefined, label: string): string | null {
  if (!file) return `${label} is required`;
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type) || !(PHOTO_EXTENSIONS as readonly string[]).includes(ext)) return `${label} must be a JPG, PNG or WEBP photo`;
  if (file.size === 0) return `${label} is empty`;
  if (file.size > MAX_PHOTO_BYTES) return `${label} is too large (maximum 10 MB)`;
  return null;
}

export function validateDeliveryForm(description: string, speedometer: { name: string; type: string; size: number } | null, evidence: { name: string; type: string; size: number } | null): string[] {
  const errors: string[] = [];
  const d = description.trim();
  if (!d) errors.push("Delivery description is required");
  else if (d.length < DESCRIPTION_MIN) errors.push(`Delivery description must be at least ${DESCRIPTION_MIN} characters`);
  else if (d.length > DESCRIPTION_MAX) errors.push(`Delivery description is too long (max ${DESCRIPTION_MAX})`);
  const s = validatePhoto(speedometer, "Speedometer photo");
  if (s) errors.push(s);
  const e = validatePhoto(evidence, "Driver & vehicle handover photo");
  if (e) errors.push(e);
  return errors;
}

export const fileSizeText = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
