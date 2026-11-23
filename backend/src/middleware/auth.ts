import type { NextFunction, Request, Response } from "express";
import { verifyToken, type TokenPayload } from "../services/auth.service.js";
import type { RoleKey } from "../config/roles.js";
import { AppError } from "../utils/AppError.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: TokenPayload;
  }
}

export const authenticate = (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return next(new AppError("Authentication required", 401));
  try {
    req.user = verifyToken(header.slice(7));
    next();
  } catch (e) {
    next(e);
  }
};

/** Reusable role guard. Usage: router.post("/", authenticate, requireRole("RSOP"), handler) */
export const requireRole =
  (...roles: RoleKey[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role))
      return next(new AppError("You are not permitted to perform this action", 403));
    next();
  };
