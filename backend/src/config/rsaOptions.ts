/**
 * Configurable option lists of the RSA payment screen. Add, rename or reorder categories here (or move this list to a database
 * collection later) without touching the form or the API. Stored payments keep the key AND the label that was shown, so renaming
 * an option never rewrites an old payment.
 */
export interface ExpenseOption { key: string; label: string }

export const EXPENSE_OPTIONS: ExpenseOption[] = [
  { key: "OTHERS", label: "Others" },
  { key: "FUEL", label: "Fuel" },
  { key: "FLEET_BALANCE", label: "Fleet Balance" },
  { key: "TOLL", label: "Toll" },
  { key: "FOOD_ALLOWANCE", label: "Food Allowance" },
  { key: "TRAVEL", label: "Travel" },
  { key: "PERMIT", label: "Permit" },
  { key: "SERVICE", label: "Service" },
];
/** Categories whose Description is mandatory (the category alone says nothing). */
export const DESCRIPTION_REQUIRED = ["OTHERS"];

/** Payment / reference choices offered beside a Diesel Cost entry (placeholder list, configurable). */
export const DIESEL_PAYMENT_MODES: string[] = ["ePayment", "Cash", "Fuel Card"];

export const PAYMENT_FOR = ["ROADSHOW", "SIGNAGE"] as const;
export const PAYMENT_FOR_LABEL: Record<(typeof PAYMENT_FOR)[number], string> = { ROADSHOW: "Roadshow", SIGNAGE: "Signage" };

export const rsaOptions = () => ({
  expenseOptions: EXPENSE_OPTIONS.map((o) => ({ ...o, descriptionRequired: DESCRIPTION_REQUIRED.includes(o.key) })), dieselPaymentModes: DIESEL_PAYMENT_MODES,
  paymentFor: PAYMENT_FOR.map((k) => ({ key: k, label: PAYMENT_FOR_LABEL[k] })),
});
