import { istNowAt, istParts, joinAt, realDate, realTime } from "./availability.validator.js";
import { ALLOWED_MIME, KEY_PATTERN } from "../services/storage.service.js";
const blank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
// eslint-disable-next-line no-control-regex -- intentionally rejects control characters in free text
const SAFE_TEXT = /^[^<>\u0000-\u001f\u007f]+$/u;
const toInstant = (d, t) => new Date(`${d}T${t}:00+05:30`);
const hex = (v) => typeof v === "string" && /^[a-f0-9]{24}$/i.test(v);
function text(o, k, label, max, errors, required = false) {
    if (blank(o[k])) {
        if (required)
            errors.push(`${label} is required`);
        return null;
    }
    if (typeof o[k] !== "string") {
        errors.push(`${label} is invalid`);
        return null;
    }
    const t = o[k].trim().replace(/\s+/g, " ");
    if (t.length > max)
        errors.push(`${label} is too long (max ${max})`);
    else if (!SAFE_TEXT.test(t))
        errors.push(`${label} contains invalid characters`);
    return t;
}
/** Expected release and next available (both optional pairs), checked against the allotment moment. */
function schedule(b, errors, allotted) {
    const ed = blank(b.expectedReleaseDate) ? null : String(b.expectedReleaseDate);
    const et = blank(b.expectedReleaseTime) ? null : String(b.expectedReleaseTime);
    const nd = blank(b.nextAvailableDate) ? null : String(b.nextAvailableDate);
    const nt = blank(b.nextAvailableTime) ? null : String(b.nextAvailableTime);
    let ok = true;
    const bad = (m) => { errors.push(m); ok = false; };
    if (ed !== null && !realDate(ed))
        bad("Expected release date must be a valid date (YYYY-MM-DD)");
    if (et !== null && !realTime(et))
        bad("Expected release time must be a valid time (HH:mm)");
    if ((ed === null) !== (et === null))
        bad("Expected release: both date and time are required");
    if (nd !== null && !realDate(nd))
        bad("Next available date must be a valid date (YYYY-MM-DD)");
    if (nt !== null && !realTime(nt))
        bad("Next available time must be a valid time (HH:mm)");
    if ((nd === null) !== (nt === null))
        bad("Next available: both date and time are required");
    if (!ok)
        return null;
    const next = nd !== null && nt !== null ? toInstant(nd, nt) : null;
    if (ed !== null && et !== null) {
        const rel = toInstant(ed, et);
        if (allotted && rel < allotted)
            errors.push("Expected release cannot be before the allotment date & time");
        if (next && next < rel)
            errors.push("Next available date & time cannot be before the expected release");
    }
    if (allotted && next && next < allotted)
        errors.push("Next available date & time cannot be before the allotment date & time");
    return { expectedReleaseDate: ed, expectedReleaseTime: et, nextAvailableDate: nd, nextAvailableTime: nt };
}
export function parseAttachments(raw, errors) {
    if (raw === undefined || raw === null)
        return [];
    if (!Array.isArray(raw)) {
        errors.push("Attachments must be a list");
        return [];
    }
    if (raw.length > 5)
        errors.push("Too many attachments (max 5)");
    const out = [];
    raw.slice(0, 5).forEach((r, i) => {
        const x = (r && typeof r === "object" ? r : {});
        const name = typeof x.name === "string" ? x.name.trim() : "";
        const ok = (x.storage === "local" || x.storage === "space") && typeof x.key === "string" && KEY_PATTERN.test(x.key) &&
            name.length > 0 && name.length <= 120 && typeof x.mimeType === "string" && ALLOWED_MIME.includes(x.mimeType) &&
            typeof x.size === "number" && x.size > 0 && x.size <= 10 * 1024 * 1024;
        if (!ok)
            return void errors.push(`Attachment ${i + 1} is invalid, upload the file again`);
        out.push({ storage: x.storage, key: x.key, name, size: x.size, mimeType: x.mimeType });
    });
    return out;
}
export function validateAllot(input, now = new Date()) {
    const b = (input && typeof input === "object" ? input : {});
    const errors = [];
    const ref = (k, label) => {
        if (blank(b[k]))
            return null;
        const t = String(b[k]).trim().toUpperCase();
        if (t.length > 40 || !/^[A-Z0-9 \-_/.]+$/.test(t))
            errors.push(`${label} is invalid`);
        return t;
    };
    const trackupNumber = ref("trackupNumber", "Trackup number");
    const pifNumber = ref("pifNumber", "PIF number");
    if (!trackupNumber && !pifNumber)
        errors.push("Project (Trackup Number) is required");
    if (!hex(b.vehicleId))
        errors.push("Vehicle is required");
    let driverId = null;
    if (!blank(b.driverId)) {
        if (hex(b.driverId))
            driverId = b.driverId;
        else
            errors.push("Driver is invalid; choose a driver from the suggestions");
    }
    // allotment moment: defaults to now; it cannot be in the future
    let allottedAt = now;
    const ad = blank(b.allottedDate) ? null : String(b.allottedDate);
    const at = blank(b.allottedTime) ? null : String(b.allottedTime);
    if (ad !== null || at !== null) {
        if (ad === null || at === null || !realDate(ad) || !realTime(at))
            errors.push("Allotment date & time is invalid");
        else {
            allottedAt = toInstant(ad, at);
            if (allottedAt.getTime() > now.getTime() + 60_000)
                errors.push("Allotment date & time cannot be in the future");
        }
    }
    const sch = schedule(b, errors, allottedAt);
    const remarks = text(b, "remarks", "Remarks", 300, errors);
    if (errors.length || !sch)
        return { errors, data: null };
    return { errors, data: { trackupNumber, pifNumber, vehicleId: b.vehicleId, driverId, allottedAt, schedule: sch, remarks } };
}
export function validateChange(input) {
    const b = (input && typeof input === "object" ? input : {});
    const errors = [];
    if (!hex(b.vehicleId))
        errors.push("Replacement vehicle is required");
    const reason = text(b, "reason", "Change reason", 300, errors, true);
    const remarks = text(b, "remarks", "Additional remarks", 300, errors);
    const attachments = parseAttachments(b.attachments, errors);
    if (errors.length || !reason)
        return { errors, data: null };
    return { errors, data: { vehicleId: b.vehicleId, reason, remarks, attachments } };
}
export function validateSchedule(input) {
    const b = (input && typeof input === "object" ? input : {});
    const errors = [];
    const sch = schedule(b, errors, null);
    const reason = text(b, "reason", "Reason", 300, errors);
    if (errors.length || !sch)
        return { errors, data: null };
    return { errors, data: { schedule: sch, reason } };
}
export function validateRelease(input) {
    const b = (input && typeof input === "object" ? input : {});
    const errors = [];
    const remarks = text(b, "remarks", "Remarks", 300, errors);
    return errors.length ? { errors, data: null } : { errors, data: { remarks } };
}
export { istNowAt, istParts, joinAt };
