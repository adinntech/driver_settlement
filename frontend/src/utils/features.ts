/**
 * Feature flags (see .env.example). Must match the backend's ROADSHOW, which is what actually enforces it.
 * Read at build / dev-server start; anything other than "on" means off.
 */
export const roadshowOn = (): boolean => process.env.NEXT_PUBLIC_ROADSHOW?.trim().toLowerCase() === "on";
