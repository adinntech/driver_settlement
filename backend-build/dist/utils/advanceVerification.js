const toPaise = (n) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null);
/**
 * Outstanding advance = total advance - total repaid / settled (never the historical advance total alone).
 * `settlements` is null when the system has no settlement source for the driver: then any advance on record cannot be verified and
 * approval stays blocked, while a driver with no advance at all is clear. Amounts are summed in paise to avoid float drift.
 * Pure: it reads nothing and changes nothing.
 */
export function verifyAdvances(advances, settlements) {
    let totalP = 0;
    for (const a of advances) {
        const p = toPaise(a?.finalAdvanceAmount);
        if (p === null)
            return unavailable(0, "An advance record has an invalid amount");
        totalP += p;
    }
    const total = totalP / 100;
    if (advances.length === 0)
        return { status: "NO_ADVANCE", totalAdvance: 0, totalSettled: 0, outstanding: 0, canApprove: true, message: "No Outstanding Advance (no advance on record)" };
    if (settlements === null)
        return unavailable(total, "Verification Data Unavailable: repayment / settlement records are not available for this driver");
    let settledP = 0;
    for (const s of settlements) {
        const p = toPaise(s?.amount);
        if (p === null)
            return unavailable(total, "Verification Data Unavailable: a settlement record has an invalid amount");
        settledP += p;
    }
    const outP = Math.max(0, totalP - settledP);
    const out = outP / 100;
    if (outP > 0)
        return { status: "OUTSTANDING", totalAdvance: total, totalSettled: settledP / 100, outstanding: out, canApprove: false, message: `Outstanding advance of ₹${out.toFixed(2)} exists` };
    return { status: "NO_OUTSTANDING", totalAdvance: total, totalSettled: settledP / 100, outstanding: 0, canApprove: true, message: "No Outstanding Advance" };
}
const unavailable = (total, message) => ({ status: "UNAVAILABLE", totalAdvance: total, totalSettled: null, outstanding: null, canApprove: false, message });
