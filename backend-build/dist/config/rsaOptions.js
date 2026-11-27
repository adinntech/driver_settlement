export const EXPENSE_OPTIONS = [
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
/** Payment / reference choices offered beside a Fuel Cost entry (placeholder list, configurable). */
export const DIESEL_PAYMENT_MODES = ["ePayment", "Cash", "Fuel Card"];
export const PAYMENT_FOR = ["ROADSHOW", "SIGNAGE"];
export const PAYMENT_FOR_LABEL = { ROADSHOW: "Roadshow", SIGNAGE: "Signage" };
export const rsaOptions = () => ({
    expenseOptions: EXPENSE_OPTIONS.map((o) => ({ ...o, descriptionRequired: DESCRIPTION_REQUIRED.includes(o.key) })), dieselPaymentModes: DIESEL_PAYMENT_MODES,
    paymentFor: PAYMENT_FOR.map((k) => ({ key: k, label: PAYMENT_FOR_LABEL[k] })),
});
