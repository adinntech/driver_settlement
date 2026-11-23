import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/AppError.js";
import { config } from "../config/index.js";
import { sendResponse } from "../utils/sendResponse.js";

export const notFound = (req: Request, _res: Response, next: NextFunction) => {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler = (err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  if (statusCode >= 500) console.error(err);
  const message =
    statusCode >= 500 && config.env === "production" ? "Internal server error" : err.message;
  res.status(statusCode).json(sendResponse(false, message, null));
};
