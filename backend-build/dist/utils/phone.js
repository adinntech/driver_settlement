/**
 * Indian mobile validation. Accepts "9876543210", "+91 9876543210", "91 98765 43210",
 * "09876543210" and returns the canonical "+91 9876543210"; returns null if invalid.
 * Letters or other special characters make it invalid.
 */
export function normalizeIndianPhone(raw) {
    if (typeof raw !== "string")
        return null;
    const s = raw.trim();
    if (!/^\+?[0-9 -]+$/.test(s))
        return null;
    let d = s.replace(/[^0-9]/g, "");
    if (s.startsWith("+")) {
        if (!d.startsWith("91"))
            return null;
        d = d.slice(2);
    }
    else if (d.length === 12 && d.startsWith("91"))
        d = d.slice(2);
    else if (d.length === 11 && d.startsWith("0"))
        d = d.slice(1);
    return /^[6-9][0-9]{9}$/.test(d) ? `+91 ${d}` : null;
}
