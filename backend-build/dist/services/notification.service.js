import { Notification } from "../models/Approval.js";
import { User } from "../models/User.js";
import { AppError } from "../utils/AppError.js";
const isDup = (e) => e?.code === 11000;
/** Creates one notification; a repeat with the same dedupeKey is silently ignored. */
export async function notifyUser(recipientId, p) {
    try {
        await Notification.create({ recipient: recipientId, ...p });
    }
    catch (e) {
        if (!isDup(e))
            throw e;
    }
}
export async function notifyUsername(username, p) {
    const u = await User.findOne({ username }).select("_id").lean();
    if (u)
        await notifyUser(u._id, p);
}
export async function notifyRole(role, p) {
    const users = await User.find({ role }).select("_id").lean();
    for (const u of users)
        await notifyUser(u._id, p);
}
export async function listNotifications(userId, unreadOnly) {
    const filter = { recipient: userId, ...(unreadOnly ? { read: false } : {}) };
    const [items, unread] = await Promise.all([
        Notification.find(filter).sort({ createdAt: -1 }).limit(50).lean(),
        Notification.countDocuments({ recipient: userId, read: false }),
    ]);
    return { items, unread };
}
export async function markRead(userId, id) {
    if (!/^[a-f0-9]{24}$/i.test(id))
        throw new AppError("Invalid notification id", 400);
    // Scoped to the recipient, so nobody can mark another user's notification.
    const n = await Notification.findOneAndUpdate({ _id: id, recipient: userId }, { read: true, readAt: new Date() }, { new: true }).lean();
    if (!n)
        throw new AppError("Notification not found", 404);
    return n;
}
export async function markAllRead(userId) {
    const r = await Notification.updateMany({ recipient: userId, read: false }, { read: true, readAt: new Date() });
    return { updated: r.modifiedCount };
}
