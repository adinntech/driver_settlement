/**
 * Builds the standard API response body.
 * Usage: res.status(200).json(sendResponse(true, "Fetched", data));
 * `data` is always present; undefined becomes null.
 */
export const sendResponse = (success, message, data = null) => ({
    success,
    message,
    data: data ?? null,
});
export default sendResponse;
