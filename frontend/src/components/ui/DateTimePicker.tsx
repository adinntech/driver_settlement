import DateInput from "./DateInput";

/**
 * One field for a date and a time (IST, 12 hour AM/PM display), built on the shared calendar. The values stay the same two
 * strings the API takes: date "YYYY-MM-DD" and time "HH:mm". No timezone conversion happens here.
 */
export default function DateTimePicker({ date, time, onChange, label, min, max, disabled }: {
  date: string;
  time: string;
  onChange: (date: string, time: string) => void;
  label: string;
  min?: string;
  max?: string;
  disabled?: boolean;
}) {
  return <DateInput value={date} time={time} onDateTime={onChange} min={min} max={max} disabled={disabled} aria-label={`${label} date and time`} />;
}
