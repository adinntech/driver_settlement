// Final Settlement highlight: every row except Food and Fuel, the same on screen and on the server.
import test from "node:test";
import assert from "node:assert/strict";
import { FINAL_EXPENSE_CATEGORIES, isHighlightedExpense } from "../src/utils/settlement.js";
import { isHighlightedExpense as screen } from "../../frontend/src/utils/settlement.js";

const both = (row: Parameters<typeof isHighlightedExpense>[0], expected: boolean) => {
  assert.equal(isHighlightedExpense(row), expected, JSON.stringify(row));
  assert.equal(screen(row), expected, JSON.stringify(row));
};

test("Food and Fuel / Diesel / Petrol are never highlighted", () => {
  for (const row of [
    { key: "food", label: "Food (Per Day)" }, { category: "FOOD_ALLOWANCE", label: "Food Allowance" }, { category: "FUEL", label: "Fuel" },
    { category: "DIESEL" }, { category: "PETROL" }, { category: "NEW_1", label: "Diesel Top Up" }, { category: "NEW_2", label: "Petrol" },
    { category: "OTHERS", label: "Others", description: "IOCL card" },
  ]) both(row, false);
});

test("every other row is highlighted, including categories added later", () => {
  for (const c of FINAL_EXPENSE_CATEGORIES.filter((x) => x.key !== "FUEL" && x.key !== "FOOD_ALLOWANCE")) both({ category: c.key, label: c.label }, true);
  for (const key of ["salary", "sundaySalary", "travel", "overtime", "halt"]) both({ key, label: key }, true);
  both({ category: "PARKING", label: "Parking" }, true);
  both({ category: "SERVICE", label: "Service", description: "diesel pump repair" }, true);
});
