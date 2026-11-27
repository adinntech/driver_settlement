/** "Vertical" = the project's type, as saved by the server (backend/src/utils/vertical.ts). */
export const VERTICAL_OPTIONS = [{ value: "", label: "All Verticals" }, { value: "ROADSHOW", label: "Roadshow" }, { value: "SIGNAGE", label: "Signage" }] as const;
export const verticalLabel = (v: string | null | undefined) => (v === "ROADSHOW" ? "Roadshow" : v === "SIGNAGE" ? "Signage" : "—");
