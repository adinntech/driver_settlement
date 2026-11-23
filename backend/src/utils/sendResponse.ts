export interface ApiResponseBody<T = unknown> {
  success: boolean;
  message: string;
  data: T | null;
}

/**
 * Builds the standard API response body.
 * Usage: res.status(200).json(sendResponse(true, "Fetched", data));
 * `data` is always present; undefined becomes null.
 */
export const sendResponse = <T = unknown>(
  success: boolean,
  message: string,
  data: T | null = null,
): ApiResponseBody<T> => ({
  success,
  message,
  data: data ?? null,
});

export default sendResponse;
