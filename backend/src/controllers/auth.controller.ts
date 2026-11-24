import type { NextFunction, Request, Response } from "express";
import { ROLES } from "../config/roles.js";
import { config } from "../config/index.js";
import { login } from "../services/auth.service.js";
import { sendResponse } from "../utils/sendResponse.js";

export const getRoles = (_req: Request, res: Response) => {
  // env-managed logins prefill the username from .env (never the password)
  const rsoName = config.seedUsers.find((s) => s.role === "RSO")?.username?.trim() ?? "";
  res.status(200).json(sendResponse(true, "Roles fetched successfully", { ...ROLES, RSO: { ...ROLES.RSO, defaultUsername: rsoName } }));
};

export const postLogin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { role, username, password } = req.body ?? {};
    const data = await login(role, username, password);
    res.status(200).json(sendResponse(true, "Login successful", data));
  } catch (e) {
    next(e);
  }
};

export const getMe = (req: Request, res: Response) => {
  res.status(200).json(sendResponse(true, "Current user fetched", req.user ?? null));
};
