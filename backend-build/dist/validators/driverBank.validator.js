const blank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
// eslint-disable-next-line no-control-regex -- intentionally rejects control characters in free text
const SAFE_TEXT = /^[^<>\u0000-\u001f\u007f]+$/u;
/** The bank fields Driver Management already stores (no new bank fields are invented). */
export const BANK_FIELDS = ["accountName", "bankName", "accountNumber", "ifscCode"];
/** "XXXXXX9012": only the last four digits are ever shown in history, events and logs. */
export const maskAccount = (n) => {
    if (!n)
        return null;
    return n.length <= 4 ? "X".repeat(n.length) : `${"X".repeat(n.length - 4)}${n.slice(-4)}`;
};
/** Same rules as the Driver Management form. Every bank field is optional (a driver may be assigned without bank details). */
export function validateBank(input) {
    const b = (input && typeof input === "object" && !Array.isArray(input) ? input : {});
    const errors = [];
    const text = (k, label, max) => {
        if (blank(b[k]))
            return null;
        if (typeof b[k] !== "string") {
            errors.push(`${label} is invalid`);
            return null;
        }
        const t = b[k].trim().replace(/\s+/g, " ");
        if (t.length > max)
            errors.push(`${label} is too long (max ${max})`);
        else if (!SAFE_TEXT.test(t))
            errors.push(`${label} contains invalid characters`);
        return t;
    };
    const accountName = text("accountName", "Account name", 80);
    const bankName = text("bankName", "Bank name", 80);
    let accountNumber = null;
    if (!blank(b.accountNumber)) {
        const t = String(b.accountNumber).trim();
        if (!/^[0-9]{6,20}$/.test(t))
            errors.push("Account number must be 6 to 20 digits");
        else
            accountNumber = t;
    }
    let ifscCode = null;
    if (!blank(b.ifscCode)) {
        const t = String(b.ifscCode).trim().toUpperCase();
        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(t))
            errors.push("IFSC code is not valid (e.g. SBIN0001234)");
        else
            ifscCode = t;
    }
    return errors.length ? { errors, data: null } : { errors, data: { accountName, bankName, accountNumber, ifscCode } };
}
export const MAX_TRAVEL_DEDUCTION = 9_999_999.99;
/**
 * Travel Amount Deduction of Change Driver: a plain non-negative amount with up to two decimals.
 * Empty = 0. Letters, signs, separators, exponents and negatives are rejected (it is never coerced from arbitrary text).
 */
export function parseTravelDeduction(raw) {
    if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === ""))
        return { error: null, value: 0 };
    if (typeof raw === "number") {
        if (!Number.isFinite(raw))
            return { error: "Travel amount deduction must be a number", value: 0 };
        if (raw < 0)
            return { error: "Travel amount deduction cannot be negative", value: 0 };
        if (Math.round(raw * 100) / 100 !== raw)
            return { error: "Travel amount deduction can have at most 2 decimal places", value: 0 };
        if (raw > MAX_TRAVEL_DEDUCTION)
            return { error: `Travel amount deduction cannot exceed ${MAX_TRAVEL_DEDUCTION}`, value: 0 };
        return { error: null, value: raw };
    }
    if (typeof raw !== "string")
        return { error: "Travel amount deduction must be a number", value: 0 };
    const t = raw.trim();
    if (/^-/.test(t))
        return { error: "Travel amount deduction cannot be negative", value: 0 };
    if (!/^\d+(\.\d+)?$/.test(t))
        return { error: "Travel amount deduction must contain digits only (e.g. 500 or 500.50)", value: 0 };
    if (/\.\d{3,}/.test(t))
        return { error: "Travel amount deduction can have at most 2 decimal places", value: 0 };
    const n = Number(t);
    if (n > MAX_TRAVEL_DEDUCTION)
        return { error: `Travel amount deduction cannot exceed ${MAX_TRAVEL_DEDUCTION}`, value: 0 };
    return { error: null, value: n };
}
