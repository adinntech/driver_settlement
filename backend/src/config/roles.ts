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
  RSA: {
    label: "RSA",
    defaultUsername: "RSA",
    description: "Manage approved Roadshow and Signage project payments, vehicle expenses, and driver payment records.",
  },
  // RSO is a separate role from RSOM: it approves final driver salary settlements and owns the payment reports.
  RSO: {
    label: "RSO",
    defaultUsername: "", // never hardcoded: the login form is prefilled from RSO_USERNAME (see getRoles)
    description: "Approve or reject final driver salary settlements and download payment, vehicle and driver reports.",
  },
} as const;

export type RoleKey = keyof typeof ROLES;
export const ROLE_KEYS = Object.keys(ROLES) as RoleKey[];
export const isRole = (v: unknown): v is RoleKey =>
  typeof v === "string" && (ROLE_KEYS as string[]).includes(v);
