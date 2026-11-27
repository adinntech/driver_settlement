import { AppError } from "../utils/AppError.js";
import { config } from "../config/index.js";
import { sendResponse } from "../utils/sendResponse.js";
export const notFound = (req, _res, next) => {
    next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
};
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler = (err, _req, res, _next) => {
    const statusCode = err instanceof AppError ? err.statusCode : 500;
    if (statusCode >= 500)
        console.error(err);
    const message = statusCode >= 500 && config.env === "production" ? "Internal server error" : err.message;
    res.status(statusCode).json(sendResponse(false, message, null));
};
