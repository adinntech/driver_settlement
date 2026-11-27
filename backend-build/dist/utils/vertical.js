/** "Vertical" = the project's type (TrackingProject.projectType, the source of truth, copied onto the records raised for it). */
export const VERTICALS = ["ROADSHOW", "SIGNAGE"];
export const asVertical = (v) => VERTICALS.includes(v) ? v : undefined;
export const verticalLabel = (v) => (v === "ROADSHOW" ? "Roadshow" : v === "SIGNAGE" ? "Signage" : "");
