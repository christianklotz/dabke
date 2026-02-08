import { describe, it, expect } from "vitest";
import { createEmployeeAssignmentPriorityRule } from "../src/cpsat/rules/employee-assignment-priority.js";

describe("employee-assignment-priority schema validation", () => {
  it("accepts valid high preference config", () => {
    expect(() =>
      createEmployeeAssignmentPriorityRule({
        employeeIds: ["alice"],
        preference: "high",
      }),
    ).not.toThrow();
  });

  it("accepts valid low preference config", () => {
    expect(() =>
      createEmployeeAssignmentPriorityRule({
        employeeIds: ["alice"],
        preference: "low",
      }),
    ).not.toThrow();
  });

  it("rejects invalid preference values", () => {
    expect(() =>
      createEmployeeAssignmentPriorityRule({
        employeeIds: ["alice"],
        // @ts-expect-error - testing invalid value
        preference: "mandatory",
      }),
    ).toThrow(/preference/i);

    expect(() =>
      createEmployeeAssignmentPriorityRule({
        employeeIds: ["alice"],
        // @ts-expect-error - testing invalid value
        preference: "MANDATORY",
      }),
    ).toThrow(/preference/i);

    expect(() =>
      createEmployeeAssignmentPriorityRule({
        employeeIds: ["alice"],
        // @ts-expect-error - testing invalid value
        preference: "medium",
      }),
    ).toThrow(/preference/i);
  });

  it("accepts role-based scoping", () => {
    expect(() =>
      createEmployeeAssignmentPriorityRule({
        roleIds: ["senior"],
        preference: "high",
      }),
    ).not.toThrow();
  });

  it("accepts skill-based scoping", () => {
    expect(() =>
      createEmployeeAssignmentPriorityRule({
        skillIds: ["keyholder"],
        preference: "high",
      }),
    ).not.toThrow();
  });

  it("accepts time-based scoping", () => {
    expect(() =>
      createEmployeeAssignmentPriorityRule({
        employeeIds: ["alice"],
        preference: "high",
        dayOfWeek: ["monday", "tuesday"],
      }),
    ).not.toThrow();
  });
});
