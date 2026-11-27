import { AVAILABILITY_STATUSES, ISSUE_CATEGORIES, ISSUE_STATUSES, PROJECT_TYPES } from "../models/Vehicle.js";
const blank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
// eslint-disable-next-line no-control-regex -- intentionally rejects control characters in free text
const SAFE_TEXT = /^[^<>\u0000-\u001f\u007f]+$/u; // free text: no markup or control characters
const REF_TEXT = /^[A-Za-z0-9 \-_/.]+$/;
/** Today (YYYY-MM-DD) and time (HH:mm) in India. */
export const istParts = (now = new Date()) => {
    const iso = new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString();
    return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
};
export const istNowAt = (now = new Date()) => {
    const p = istParts(now);
    return `${p.date}T${p.time}`;
};
export const realDate = (v) => {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v))
        return false;
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
export const realTime = (v) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
/** "YYYY-MM-DDTHH:mm" (IST) when both parts exist, else null. Strings of this shape sort chronologically. */
export const joinAt = (d, t) => (d && t ? `${d}T${t}` : null);
/** Human label for diffs / history: "2026-11-25 20:00". */
export const joinLabel = (d, t) => (d ? (t ? `${d} ${t}` : d) : null);
/**
 * Validates the Vehicle Availability & Status section.
 * `undefined` / `null` input means "not sent": the stored availability stays untouched (data undefined).
 * Drafts only check the format of what was entered; a final save checks the rules of the chosen status.
 * Only the chosen status's fields are kept; switching status never leaks stale fields into the saved record.
 */
export function validateAvailability(input, draft, now = new Date(), prev) {
    if (input === undefined || input === null)
        return { errors: [], data: undefined };
    const errors = [];
    if (typeof input !== "object" || Array.isArray(input))
        return { errors: ["Vehicle availability is invalid"], data: undefined };
    const b = input;
    const nowP = istParts(now);
    const nowAt = istNowAt(now);
    const text = (o, k, label, max) => {
        if (blank(o[k]))
            return null;
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
    };
    const ref = (o, k, label) => {
        if (blank(o[k]))
            return null;
        const t = String(o[k]).trim().toUpperCase();
        if (t.length > 40 || !REF_TEXT.test(t))
            errors.push(`${label} is invalid`);
        return t;
    };
    const date = (o, k, label) => {
        if (blank(o[k]))
            return null;
        if (!realDate(o[k])) {
            errors.push(`${label} must be a valid date (YYYY-MM-DD)`);
            return null;
        }
        return o[k];
    };
    const time = (o, k, label) => {
        if (blank(o[k]))
            return null;
        if (!realTime(o[k])) {
            errors.push(`${label} must be a valid time (HH:mm)`);
            return null;
        }
        return o[k];
    };
    /** A date and a time belong together: on a final save one cannot be given without the other. */
    const pair = (d, t, label) => {
        if (!draft && (d === null) !== (t === null))
            errors.push(`${label}: both date and time are required`);
    };
    let status = null;
    if (!blank(b.status)) {
        if (!AVAILABILITY_STATUSES.includes(b.status))
            errors.push(`Vehicle status must be one of: ${AVAILABILITY_STATUSES.join(", ")}`);
        else
            status = b.status;
    }
    else if (!draft)
        errors.push("Vehicle status is required");
    const out = {
        status, availableFromDate: null, availableFromTime: null, project: null, expectedReleaseDate: null, expectedReleaseTime: null,
        nextAvailableDate: null, nextAvailableTime: null, issue: null, nextAvailableAt: null,
    };
    if (status === "AVAILABLE") {
        let d = date(b, "availableFromDate", "Available from date");
        let t = time(b, "availableFromTime", "Available from time");
        if (!draft) {
            if (d === null && t === null) {
                d = nowP.date;
                t = nowP.time;
            } // default: now
            else
                pair(d, t, "Available from");
        }
        out.availableFromDate = d;
        out.availableFromTime = t;
        out.nextAvailableAt = joinAt(d, t);
    }
    if (status === "IN_USE") {
        const p = (b.project && typeof b.project === "object" ? b.project : {});
        let projectType = null;
        if (!blank(p.projectType)) {
            if (!PROJECT_TYPES.includes(p.projectType))
                errors.push("Project type must be Roadshow or Signage");
            else
                projectType = p.projectType;
        }
        let trackingProject = null;
        if (!blank(p.trackingProject)) {
            if (typeof p.trackingProject === "string" && /^[a-f0-9]{24}$/i.test(p.trackingProject))
                trackingProject = p.trackingProject;
            else
                errors.push("Linked project is invalid");
        }
        const hexId = (k, label) => {
            if (blank(p[k]))
                return null;
            if (typeof p[k] === "string" && /^[a-f0-9]{24}$/i.test(p[k]))
                return p[k];
            errors.push(`${label} is invalid`);
            return null;
        };
        const budgetVersion = Number.isInteger(p.budgetVersion) && p.budgetVersion > 0 ? p.budgetVersion : null;
        const pr = {
            trackingProject, trackingVehicle: hexId("trackingVehicle", "Linked project vehicle"), budget: hexId("budget", "Linked budget"), budgetVersion, projectType,
            projectName: text(p, "projectName", "Project name", 120), clientName: text(p, "clientName", "Client / billing name", 120),
            trackupNumber: ref(p, "trackupNumber", "Trackup number"), pifNumber: ref(p, "pifNumber", "PIF number"),
            startDate: date(p, "startDate", "Project start date"), endDate: date(p, "endDate", "Project end date"),
            location: text(p, "location", "Location", 200), remarks: text(p, "remarks", "Additional remarks", 300),
        };
        if (pr.startDate && pr.endDate && pr.endDate < pr.startDate)
            errors.push("Project end date cannot be before the start date");
        const rd = date(b, "expectedReleaseDate", "Expected release date");
        const rt = time(b, "expectedReleaseTime", "Expected release time");
        const nd = date(b, "nextAvailableDate", "Next available date");
        const nt = time(b, "nextAvailableTime", "Next available time");
        pair(rd, rt, "Expected release");
        pair(nd, nt, "Next available"); // optional: without it the vehicle stays In Use until it is released
        if (!draft) {
            // Only approved projects can be allocated: the project must have been picked by Trackup / PIF number (linked server-side).
            if (!pr.trackingProject || !pr.trackingVehicle)
                errors.push("Select an approved project by Trackup Number or PIF Number");
        }
        const releaseAt = joinAt(rd, rt);
        const nextAt = joinAt(nd, nt);
        if (releaseAt && nextAt && nextAt < releaseAt)
            errors.push("Next available date & time cannot be before the expected release");
        if (pr.startDate && nd && nd < pr.startDate)
            errors.push("Next available date cannot be before the project start date");
        // A newly entered next-available moment must be in the future; an unchanged (possibly overdue) one stays editable.
        if (nextAt && nextAt < nowAt && !(prev?.status === "IN_USE" && prev.nextAvailableAt === nextAt))
            errors.push("Next available date & time cannot be in the past");
        out.project = pr;
        out.expectedReleaseDate = rd;
        out.expectedReleaseTime = rt;
        out.nextAvailableDate = nd;
        out.nextAvailableTime = nt;
        out.nextAvailableAt = nextAt;
    }
    if (status === "ISSUE") {
        const i = (b.issue && typeof b.issue === "object" ? b.issue : {});
        let category = null;
        if (!blank(i.category)) {
            if (!ISSUE_CATEGORIES.includes(i.category))
                errors.push(`Issue category must be one of: ${ISSUE_CATEGORIES.join(", ")}`);
            else
                category = i.category;
        }
        let issueStatus = null;
        if (!blank(i.issueStatus)) {
            if (!ISSUE_STATUSES.includes(i.issueStatus))
                errors.push("Issue status must be Open or In Repair");
            else
                issueStatus = i.issueStatus;
        }
        else if (!draft)
            issueStatus = "OPEN";
        const description = text(i, "description", "Issue description", 500);
        let rpd = date(i, "reportedDate", "Issue reported date");
        let rpt = time(i, "reportedTime", "Issue reported time");
        const xd = date(i, "expectedRepairDate", "Expected repair completion date");
        const xt = time(i, "expectedRepairTime", "Expected repair completion time");
        if (!draft) {
            if (!category)
                errors.push("Issue category is required");
            if (!description)
                errors.push("Issue description / reason is required");
            if (rpd === null && rpt === null) {
                rpd = nowP.date;
                rpt = nowP.time;
            } // default: now
            else
                pair(rpd, rpt, "Issue reported");
            if (xt !== null && xd === null)
                errors.push("Expected repair completion date is required when a time is given");
        }
        const reportedAt = joinAt(rpd, rpt);
        if (reportedAt && reportedAt > nowAt)
            errors.push("Issue reported date & time cannot be in the future");
        const repairAt = joinAt(xd, xt) ?? (xd ? `${xd}T23:59` : null);
        if (reportedAt && repairAt && repairAt < reportedAt)
            errors.push("Expected repair completion cannot be before the issue was reported");
        const prevRepair = prev?.issue ? joinAt(prev.issue.expectedRepairDate, prev.issue.expectedRepairTime) : null;
        if (joinAt(xd, xt) && joinAt(xd, xt) < nowAt && !(prev?.status === "ISSUE" && prevRepair === joinAt(xd, xt)))
            errors.push("Expected repair completion cannot be in the past");
        out.issue = {
            category, description, reportedDate: rpd, reportedTime: rpt, expectedRepairDate: xd, expectedRepairTime: xt,
            garage: text(i, "garage", "Garage / service centre", 120), repairRemarks: text(i, "repairRemarks", "Repair remarks", 300), issueStatus,
        };
        out.nextAvailableAt = joinAt(xd, xt);
    }
    return { errors, data: out };
}
/**
 * Whether a vehicle may be considered for a new project.
 * Rules: only an explicit "Available Now" counts. A passed release time never frees a vehicle by itself, and an
 * issue stays until RBP resolves it.
 */
export function allocatability(av, now = new Date()) {
    if (!av || !av.status)
        return { allocatable: false, reason: "Availability not set", releaseOverdue: false };
    const nowAt = istNowAt(now);
    if (av.status === "IN_USE") {
        const overdue = !!av.nextAvailableAt && av.nextAvailableAt < nowAt;
        return {
            allocatable: false, releaseOverdue: overdue,
            reason: overdue ? "Next available time has passed; the vehicle is released automatically" : "In use on another project",
        };
    }
    if (av.status === "ISSUE")
        return { allocatable: false, releaseOverdue: false, reason: `Vehicle issue${av.issue?.description ? `: ${av.issue.description}` : ""}; resolve it first` };
    const from = joinAt(av.availableFromDate, av.availableFromTime);
    if (from && from > nowAt)
        return { allocatable: false, releaseOverdue: false, reason: `Available from ${joinLabel(av.availableFromDate, av.availableFromTime)}` };
    return { allocatable: true, releaseOverdue: false, reason: "Available now" };
}
