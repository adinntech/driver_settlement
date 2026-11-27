import { Notification, type NotificationType } from "../models/Approval.js";
import { User } from "../models/User.js";
import type { RoleKey } from "../config/roles.js";
import { AppError } from "../utils/AppError.js";

interface Payload {
  type: NotificationType;
  title: string;
  message: string;
  link: string;
  meta?: Record<string, unknown>;
  dedupeKey: string;
}

const isDup = (e: unknown) => (e as { code?: number })?.code === 11000;

/** Creates one notification; a repeat with the same dedupeKey is silently ignored. */
export async function notifyUser(recipientId: unknown, p: Payload): Promise<void> {
  try {
    await Notification.create({ recipient: recipientId, ...p });
  } catch (e) {
    if (!isDup(e)) throw e;
  }
}

export async function notifyUsername(username: string, p: Payload): Promise<void> {
  const u = await User.findOne({ username }).select("_id").lean();
  if (u) await notifyUser(u._id, p);
}

export async function notifyRole(role: RoleKey, p: Payload): Promise<void> {
  const users = await User.find({ role }).select("_id").lean();
  for (const u of users) await notifyUser(u._id, p);
}

export async function listNotifications(userId: string, unreadOnly: boolean) {
  const filter = { recipient: userId, ...(unreadOnly ? { read: false } : {}) };
  const [items, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).limit(50).lean(),
    Notification.countDocuments({ recipient: userId, read: false }),
  ]);
  return { items, unread };
}

export async function markRead(userId: string, id: string) {
  if (!/^[a-f0-9]{24}$/i.test(id)) throw new AppError("Invalid notification id", 400);
  // Scoped to the recipient, so nobody can mark another user's notification.
  const n = await Notification.findOneAndUpdate(
    { _id: id, recipient: userId },
    { read: true, readAt: new Date() },
    { new: true },
  ).lean();
  if (!n) throw new AppError("Notification not found", 404);
  return n;
}

export async function markAllRead(userId: string) {
  const r = await Notification.updateMany({ recipient: userId, read: false }, { read: true, readAt: new Date() });
  return { updated: r.modifiedCount };
}
