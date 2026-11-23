// Central role registry. To onboard a new login, add one entry here.
export const ROLES = {
  RSOP: {
    label: "RSOP",
    defaultUsername: "RSOP",
    description: "Create and track Roadshow / Signage requests and manage their approval process.",
  },
  RBP: {
    label: "RBP",
    defaultUsername: "RBP",
    description:
      "Review assigned tracking requests and prepare, manage, and revise project budgets.",
  },
  RSOM: {
    label: "RSOM",
    defaultUsername: "RSOM",
    description: "Review and approve or reject budgets created by RBP.",
  },
} as const;

export type RoleKey = keyof typeof ROLES;
export const ROLE_KEYS = Object.keys(ROLES) as RoleKey[];
export const isRole = (v: unknown): v is RoleKey =>
  typeof v === "string" && (ROLE_KEYS as string[]).includes(v);
