import { verifyToken } from "../services/auth.service.js";
import { AppError } from "../utils/AppError.js";
export const authenticate = (req, _res, next) => {
    const header = req.headers.authorization ?? "";
    if (!header.startsWith("Bearer "))
        return next(new AppError("Authentication required", 401));
    try {
        req.user = verifyToken(header.slice(7));
        next();
    }
    catch (e) {
        next(e);
    }
};
/** Reusable role guard. Usage: router.post("/", authenticate, requireRole("RSOP"), handler) */
export const requireRole = (...roles) => (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role))
        return next(new AppError("You are not permitted to perform this action", 403));
    next();
};
