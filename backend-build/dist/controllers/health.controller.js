import { getHealthStatus } from "../services/health.service.js";
import { sendResponse } from "../utils/sendResponse.js";
export const healthCheck = (_req, res) => {
    const { success, message } = getHealthStatus();
    res.status(200).json(sendResponse(success, message, null));
};
