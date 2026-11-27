import { DRIVER_STATUSES, DRIVER_TYPES } from "../models/Driver.js";
import { normalizeIndianPhone } from "../utils/phone.js";
import { realDate } from "./availability.validator.js";
import { parseAttachments } from "./allotment.validator.js";
const blank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
// eslint-disable-next-line no-control-regex -- intentionally rejects control characters in free text
const SAFE_TEXT = /^[^<>\u0000-\u001f\u007f]+$/u;
const NAME = /^\p{L}[\p{L} .'-]*$/u;
/** Licence number without spaces, hyphens and slashes, upper case. */
export const licenceKeyOf = (raw) => raw.toUpperCase().replace(/[\s\-/]/g, "");
/** Validates a driver form. The Driver Number is never read from the input: it is generated (and kept) by the server. */
export function validateDriver(input) {
    const b = (input && typeof input === "object" ? input : {});
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
    let driverName = null;
    if (blank(b.driverName))
        errors.push("Driver name is required");
    else {
        driverName = text("driverName", "Driver name", 80);
        if (driverName && (driverName.length < 2 || !NAME.test(driverName)))
            errors.push("Driver name may contain letters, spaces, dots, apostrophes and hyphens only");
    }
    let driverType = null;
    if (blank(b.driverType))
        errors.push("Driver type is required");
    else if (!DRIVER_TYPES.includes(b.driverType))
        errors.push("Driver type must be Company Driver or Acting Driver");
    else
        driverType = b.driverType;
    let mobileNumber = null;
    if (blank(b.mobileNumber))
        errors.push("Mobile number is required");
    else {
        mobileNumber = normalizeIndianPhone(b.mobileNumber);
        if (!mobileNumber)
            errors.push("Mobile number must be a valid 10-digit Indian mobile number (+91)");
    }
    const address = text("address", "Address", 200);
    const accountName = text("accountName", "Account name", 80);
    const bankName = text("bankName", "Bank name", 80);
    const licenceType = text("licenceType", "Licence type", 40);
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
    let licenceNumber = null;
    let licenceKey = null;
    if (!blank(b.licenceNumber)) {
        const raw = String(b.licenceNumber).trim();
        const key = licenceKeyOf(raw);
        if (!/^[A-Z0-9]{8,20}$/.test(key) || !/[0-9]/.test(key) || !/[A-Z]/.test(key))
            errors.push("Licence number is not valid (e.g. TN0720110012345)");
        else {
            licenceNumber = raw.toUpperCase().replace(/\s+/g, " ");
            licenceKey = key;
        }
    }
    let licenceExpiryDate = null;
    if (!blank(b.licenceExpiryDate)) {
        if (!realDate(b.licenceExpiryDate))
            errors.push("Licence expiry date must be a valid date (YYYY-MM-DD)");
        else
            licenceExpiryDate = b.licenceExpiryDate;
    }
    let salary = 0;
    if (!blank(b.salary)) {
        const n = Number(b.salary);
        if (!Number.isFinite(n) || n < 0 || n > 9_999_999.99)
            errors.push("Salary must be a number between 0 and 9999999.99");
        else
            salary = Math.round(n * 100) / 100;
    }
    let attachment = null;
    if (b.attachment !== undefined && b.attachment !== null) {
        const list = parseAttachments([b.attachment], errors);
        attachment = list[0] ?? null;
    }
    let status;
    if (!blank(b.status)) {
        if (!DRIVER_STATUSES.includes(String(b.status)))
            errors.push("Status must be Active or Inactive");
        else
            status = b.status;
    }
    if (errors.length || !driverName || !driverType || !mobileNumber)
        return { errors, data: null };
    return {
        errors,
        data: {
            driverName, driverType, address, mobileNumber, mobileDigits: mobileNumber.replace(/\D/g, "").slice(2), accountName, accountNumber, ifscCode,
            bankName, licenceNumber, licenceKey, licenceType, licenceExpiryDate, attachment, salary, ...(status ? { status } : {}),
        },
    };
}
