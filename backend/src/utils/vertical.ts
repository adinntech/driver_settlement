/** "Vertical" = the project's type (TrackingProject.projectType, the source of truth, copied onto the records raised for it). */
export const VERTICALS = ["ROADSHOW", "SIGNAGE"] as const;
export type Vertical = (typeof VERTICALS)[number];
export const asVertical = (v: unknown): Vertical | undefined => (VERTICALS as readonly unknown[]).includes(v) ? (v as Vertical) : undefined;
export const verticalLabel = (v: unknown) => (v === "ROADSHOW" ? "Roadshow" : v === "SIGNAGE" ? "Signage" : "");
