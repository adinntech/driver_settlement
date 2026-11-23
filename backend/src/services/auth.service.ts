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

/** Creates seed users from env credentials if they do not exist yet. Never overwrites. */
export async function seedUsers(): Promise<void> {
  for (const s of config.seedUsers) {
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
