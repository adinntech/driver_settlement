import crypto from "node:crypto";
import { config } from "../config/index.js";
function key() {
    const secret = config.dataKey || config.jwtSecret;
    if (!secret)
        throw new Error("DATA_ENCRYPTION_KEY (or JWT_SECRET) must be set to store payment data");
    return crypto.createHash("sha256").update(`settlement-data:${secret}`).digest();
}
export function seal(plain) {
    if (!plain)
        return undefined;
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
    const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
}
export function unseal(s) {
    if (!s?.iv || !s.tag || !s.data)
        return null;
    try {
        const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(s.iv, "base64"));
        d.setAuthTag(Buffer.from(s.tag, "base64"));
        return Buffer.concat([d.update(Buffer.from(s.data, "base64")), d.final()]).toString("utf8");
    }
    catch {
        return null; // wrong key / tampered value: never crash a report over it
    }
}
export const maskTail = (v, keep = 4) => (v ? `${"X".repeat(Math.max(0, v.length - keep))}${v.slice(-keep)}` : null);
