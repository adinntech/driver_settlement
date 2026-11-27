/**
 * Driver advance calculation. All money maths is done in integer paise so decimal salaries (e.g. 370.55) never suffer
 * floating-point drift. The same rules are mirrored in the frontend; the backend result is the only one that is saved.
 *
 *   eligible = workingDays x perDaySalary
 *   half     = eligible / 2
 *   advance  = floor(half / 500) x 500      (always rounds DOWN, never to the nearest 500)
 */
export const ROUNDING_UNIT = 500;
export const ROUNDING_METHOD = "FLOOR_TO_UNIT";
export const MAX_WORKING_DAYS = 366;
const paise = (rupees) => Math.round(rupees * 100);
const rupees = (p) => p / 100;
/** Positive whole number of working days (1..366). */
export const isValidWorkingDays = (v) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_WORKING_DAYS;
export function calculateAdvance(workingDays, perDaySalary) {
    const salaryP = paise(perDaySalary);
    const eligibleP = workingDays * salaryP;
    const halfP = eligibleP / 2; // may end in .5 paise; kept exact for the floor below
    const finalAdvance = Math.floor(eligibleP / (2 * ROUNDING_UNIT * 100)) * ROUNDING_UNIT; // floor((eligible / 2) / 500) * 500
    return {
        workingDays, perDaySalary: rupees(salaryP), eligibleAdvanceAmount: rupees(eligibleP), calculatedHalfAmount: rupees(Math.round(halfP)), finalAdvanceAmount: finalAdvance,
    };
}
