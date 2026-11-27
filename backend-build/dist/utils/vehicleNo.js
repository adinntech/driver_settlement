const STANDARD = /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{1,4}$/; // TN58BM6554
const BH_SERIES = /^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/; // 22BH1234AA
/** "tn 58-bm 6554" -> "TN58BM6554"; null when it is not a valid registration number. */
export function normalizeVehicleNo(raw) {
    if (typeof raw !== "string")
        return null;
    const s = raw.trim();
    if (!/^[A-Za-z0-9 -]+$/.test(s))
        return null; // letters, digits, space and hyphen only
    const v = s.replace(/[ -]/g, "").toUpperCase();
    return STANDARD.test(v) || BH_SERIES.test(v) ? v : null;
}
