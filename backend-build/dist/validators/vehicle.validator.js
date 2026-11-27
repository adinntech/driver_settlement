import { VEHICLE_TYPES, DOC_SECTIONS } from "../models/Vehicle.js";
import { normalizeVehicleNo } from "../utils/vehicleNo.js";
import { ALLOWED_MIME, KEY_PATTERN } from "../services/storage.service.js";
const blank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const TEXT_OK = /^[\p{L}\p{N} .,/&()'+\-:#]+$/u; // letters, digits, common punctuation; no control/markup characters
/** Today in India (the business timezone) as YYYY-MM-DD. */
export const todayYmd = (now = new Date()) => new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
export const isRealDate = (v) => {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v))
        return false;
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; // rejects 2026-02-31
};
export function validateVehicle(input, draft, now = new Date()) {
    const b = (input && typeof input === "object" ? input : {});
    const errors = [];
    const today = todayYmd(now);
    const text = (k, label, max = 80) => {
        if (blank(b[k]))
            return null;
        const t = String(b[k]).trim().replace(/\s+/g, " ");
        if (t.length > max)
            errors.push(`${label} is too long (max ${max})`);
        else if (!TEXT_OK.test(t))
            errors.push(`${label} contains invalid characters`);
        return t;
    };
    const num = (k, label) => {
        if (blank(b[k]))
            return null;
        const n = Number(b[k]);
        if (!Number.isFinite(n) || n < 0 || n > 99_999_999) {
            errors.push(`${label} must be a number between 0 and 99999999`);
            return null;
        }
        return Math.round(n * 100) / 100;
    };
    const date = (k, label) => {
        if (blank(b[k]))
            return null;
        if (!isRealDate(b[k])) {
            errors.push(`${label} must be a valid date (YYYY-MM-DD)`);
            return null;
        }
        return b[k];
    };
    let vehicleNo = null;
    if (!blank(b.vehicleNo)) {
        vehicleNo = normalizeVehicleNo(b.vehicleNo);
        if (!vehicleNo)
            errors.push("Vehicle number is not a valid registration number (e.g. TN58BM6554)");
    }
    let type = null;
    if (!blank(b.type)) {
        if (!VEHICLE_TYPES.includes(String(b.type)))
            errors.push(`Type must be one of: ${VEHICLE_TYPES.join(", ")}`);
        else
            type = String(b.type);
    }
    let yearOfManufacture = null;
    if (!blank(b.yearOfManufacture)) {
        const y = Number(b.yearOfManufacture);
        const maxYear = Number(today.slice(0, 4));
        if (!Number.isInteger(y) || y < 1950 || y > maxYear)
            errors.push(`Year of manufacture must be a year between 1950 and ${maxYear}`);
        else
            yearOfManufacture = y;
    }
    const purchaseDate = date("purchaseDate", "Purchase date");
    if (purchaseDate && purchaseDate > today)
        errors.push("Purchase date cannot be in the future");
    if (purchaseDate && yearOfManufacture && Number(purchaseDate.slice(0, 4)) < yearOfManufacture)
        errors.push("Purchase date cannot be before the year of manufacture");
    const maint = (k, label) => {
        const d = date(k, label);
        if (d && purchaseDate && d < purchaseDate)
            errors.push(`${label} cannot be before the purchase date`);
        return d;
    };
    const docs = {};
    const labels = {
        fc: "FC", insurance: "Insurance", rtoPermission: "RTO permission", policePermission: "Police permission", permit: "Permit",
    };
    for (const s of DOC_SECTIONS) {
        const raw = b[s] === undefined ? [] : b[s];
        const list = [];
        if (!Array.isArray(raw))
            errors.push(`${labels[s]} must be a list`);
        else {
            if (raw.length > 20)
                errors.push(`${labels[s]}: too many entries (max 20)`);
            raw.forEach((r, i) => {
                const e = (r && typeof r === "object" ? r : {});
                const att = e.attachment;
                if (blank(e.nextRenewalDate) && (att === null || att === undefined))
                    return; // empty row is never saved
                const tag = `${labels[s]} entry ${i + 1}`;
                if (!isRealDate(e.nextRenewalDate))
                    return void errors.push(`${tag}: next renewal date is required (YYYY-MM-DD)`);
                let attachment = null;
                if (att !== null && att !== undefined) {
                    const x = (typeof att === "object" ? att : {});
                    const name = typeof x.name === "string" ? x.name.trim() : "";
                    const ok = (x.storage === "local" || x.storage === "space") && typeof x.key === "string" && KEY_PATTERN.test(x.key) &&
                        name.length > 0 && name.length <= 120 && typeof x.mimeType === "string" && ALLOWED_MIME.includes(x.mimeType) &&
                        typeof x.size === "number" && x.size > 0 && x.size <= 10 * 1024 * 1024;
                    if (!ok)
                        return void errors.push(`${tag}: attachment is invalid, upload the file again`);
                    attachment = { storage: x.storage, key: x.key, name, size: x.size, mimeType: x.mimeType };
                }
                list.push({ nextRenewalDate: e.nextRenewalDate, attachment });
            });
        }
        docs[s] = list;
    }
    const data = {
        vehicleNo,
        make: text("make", "Make"),
        model: text("model", "Model"),
        type,
        yearOfManufacture,
        purchaseDate,
        currentRunning: num("currentRunning", "Current running"),
        totalRunning: num("totalRunning", "Total running"),
        stepneyStatus: text("stepneyStatus", "Stepney status"),
        batteryStatus: text("batteryStatus", "Battery status"),
        oilTopUpOn: maint("oilTopUpOn", "Oil top up date"),
        greasePackingOn: maint("greasePackingOn", "Grease packing date"),
        generalCheckUpOn: maint("generalCheckUpOn", "General check up date"),
        ...docs,
        condition: text("condition", "Condition", 120),
        specification: text("specification", "Specification", 200),
    };
    if (!draft) {
        const need = [
            ["vehicleNo", "Vehicle number"], ["make", "Make"], ["model", "Model"], ["type", "Type"],
            ["yearOfManufacture", "Year of manufacture"], ["purchaseDate", "Purchase date"],
            ["currentRunning", "Current running"], ["totalRunning", "Total running"],
        ];
        for (const [k, label] of need)
            if (data[k] === null && !errors.some((e) => e.startsWith(label)))
                errors.push(`${label} is required`);
    }
    return { errors, data };
}
/** Latest expiry among entries (YYYY-MM-DD strings sort correctly); null if none. */
export const latestExpiry = (list) => list.reduce((m, e) => (e.nextRenewalDate && (!m || e.nextRenewalDate > m) ? e.nextRenewalDate : m), null);
export const EXPIRING_DAYS = 30;
export const MAINTENANCE_DUE_DAYS = 90;
export const addDays = (ymd, days) => {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};
export function docStatus(expiry, now = new Date()) {
    if (!expiry)
        return "NONE";
    const today = todayYmd(now);
    if (expiry < today)
        return "EXPIRED";
    return expiry <= addDays(today, EXPIRING_DAYS) ? "EXPIRING_SOON" : "VALID";
}
const norm = (v) => (v === undefined || v === null || (Array.isArray(v) && v.length === 0) ? null : v);
export const diffVehicle = (prev, next, keys) => keys.filter((k) => JSON.stringify(norm(prev[k])) !== JSON.stringify(norm(next[k]))).map((k) => ({ field: k, from: norm(prev[k]), to: norm(next[k]) }));
