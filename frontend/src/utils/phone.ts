/** Reduce any typed/pasted text to at most 10 national digits (drops +91 / 91 / leading 0). */
export function sanitizePhoneInput(raw: string): string {
  const trimmed = raw.trim();
  let d = trimmed.replace(/[^0-9]/g, "");
  if (trimmed.startsWith("+") && d.startsWith("91")) d = d.slice(2);
  else if (d.length > 10 && d.startsWith("91")) d = d.slice(2);
  else if (d.length > 10 && d.startsWith("0")) d = d.slice(1);
  return d.slice(0, 10);
}

export const isValidPhone = (digits: string): boolean => /^[6-9][0-9]{9}$/.test(digits);

/** "9876543210" -> "+91 9876543210"; empty stays empty. */
export const toFullPhone = (digits: string): string => (digits ? `+91 ${digits}` : "");

/** Saved value ("+91 7548810034" or legacy "75488 10034") -> editable 10 digits. */
export const fromStoredPhone = (stored: string | undefined | null): string => sanitizePhoneInput(stored ?? "");
