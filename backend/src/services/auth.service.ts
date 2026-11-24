/* eslint-disable @typescript-eslint/no-explicit-any */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { config } from "../config/index.js";
import { isRole, type RoleKey } from "../config/roles.js";
import { AppError } from "../utils/AppError.js";

export interface TokenPayload {
  id: string;
  username: string;
  role: RoleKey;
}

export function signToken(p: TokenPayload): string {
  if (!config.jwtSecret) throw new AppError("Server auth is not configured", 500);
  return jwt.sign(p, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  } as jwt.SignOptions);
}

export function verifyToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, config.jwtSecret) as TokenPayload;
  } catch {
    throw new AppError("Invalid or expired token", 401);
  }
}

export async function login(role: unknown, username: unknown, password: unknown) {
  if (!isRole(role) || typeof username !== "string" || typeof password !== "string")
    throw new AppError("Role, username and password are required", 400);
  const user = await User.findOne({ username, role }).select("+passwordHash");
  // Same message for unknown user / wrong password / wrong role.
  if (!user || !(await bcrypt.compare(password, user.passwordHash)))
    throw new AppError("Invalid credentials", 401);
  const payload: TokenPayload = { id: user._id.toString(), username: user.username, role };
  return { token: signToken(payload), user: { username: user.username, role } };
}

/**
 * Roles whose login is fully controlled by .env: on every start the account is created, or its username / password are updated
 * to the current values (RSO_USERNAME / RSO_PASSWORD). Other roles keep the create-once behaviour below and are never modified.
 */
export const ENV_MANAGED_ROLES: RoleKey[] = ["RSO"];

/**
 * Makes the database login of an env-managed role match .env. The password is stored only as a bcrypt hash and is re-hashed
 * only when it actually changed. Never logs a password. Refuses (without changing anything) when the new username belongs to an
 * account of another role.
 */
export async function syncEnvUser(role: RoleKey, username: string | undefined, password: string | undefined): Promise<"created" | "updated" | "unchanged" | "skipped"> {
  const name = username?.trim();
  if (!name || !password) {
    console.warn(`${role}_USERNAME / ${role}_PASSWORD are not set in .env: the ${role} login is not configured`);
    return "skipped";
  }
  const clash: any = await User.findOne({ username: name, role: { $ne: role } }).select("role").lean();
  if (clash) {
    console.error(`${role}_USERNAME "${name}" is already used by a ${clash.role} login; the ${role} login was not changed`);
    return "skipped";
  }
  // the env-managed account: the one with the configured username, else the oldest account of the role
  const user: any = (await User.findOne({ role, username: name }).select("+passwordHash")) ?? (await User.findOne({ role }).sort({ createdAt: 1 }).select("+passwordHash"));
  if (!user) {
    await User.create({ username: name, role, passwordHash: await bcrypt.hash(password, 10) });
    console.log(`Created ${role} login "${name}" from .env`);
    return "created";
  }
  const nameChanged = user.username !== name;
  const passwordChanged = !(await bcrypt.compare(password, user.passwordHash));
  if (!nameChanged && !passwordChanged) return "unchanged";
  if (nameChanged) user.username = name;
  if (passwordChanged) user.passwordHash = await bcrypt.hash(password, 10);
  await user.save();
  console.log(`Updated ${role} login from .env (${[nameChanged && "username", passwordChanged && "password"].filter(Boolean).join(" and ")} changed)`);
  return "updated";
}

/** Creates seed users from env credentials if they do not exist yet (never overwrites); env-managed roles are synced. */
export async function seedUsers(): Promise<void> {
  for (const s of config.seedUsers) {
    if (ENV_MANAGED_ROLES.includes(s.role as RoleKey)) {
      await syncEnvUser(s.role as RoleKey, s.username, s.password);
      continue;
    }
    if (!s.username || !s.password) continue;
    if (await User.exists({ username: s.username })) continue;
    await User.create({
      username: s.username,
      role: s.role,
      passwordHash: await bcrypt.hash(s.password, 10),
    });
    console.log(`Seeded user ${s.username} (${s.role})`);
  }
}
