"use client";

import { sanitizeDecimal, sanitizeInt } from "@/utils/budgetForm";
import { sanitizePhoneInput } from "@/utils/phone";

type Base = { value: string; onChange: (v: string) => void; placeholder?: string; "aria-label"?: string; readOnly?: boolean; disabled?: boolean };

/** Decimal amount: digits and one dot only; no letters, minus or exponent. */
export const DecimalInput = ({ value, onChange, ...p }: Base) => (
  <input {...p} className="num-input" inputMode="decimal" autoComplete="off" value={value} onChange={(e) => onChange(sanitizeDecimal(e.target.value))} />
);

export const IntInput = ({ value, onChange, ...p }: Base) => (
  <input {...p} className="num-input" inputMode="numeric" autoComplete="off" value={value} onChange={(e) => onChange(sanitizeInt(e.target.value))} />
);

/** Fixed +91 prefix, 10 national digits. Handles paste of "+91 98765 43210" without duplicating the code. */
export function PhoneInput({ value, onChange, placeholder = "9876543210", disabled }: Base & { disabled?: boolean }) {
  return (
    <div className="phone">
      <span className="phone-code">+91</span>
      <input
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        maxLength={16}
        placeholder={placeholder}
        aria-label="Mobile number (+91)"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(sanitizePhoneInput(e.target.value))}
        onPaste={(e) => {
          e.preventDefault();
          onChange(sanitizePhoneInput(e.clipboardData.getData("text")));
        }}
      />
    </div>
  );
}
