import { describe, it, expect } from "vitest";
import { createAssignmentPriorityRule } from "../src/cpsat/rules/assignment-priority.js";

describe("member-assignment-priority schema validation", () => {
  it("accepts valid high preference config", () => {
    expect(() =>
      createAssignmentPriorityRule({
        memberIds: ["alice"],
        preference: "high",
      }),
    ).not.toThrow();
  });

  it("accepts valid low preference config", () => {
    expect(() =>
      createAssignmentPriorityRule({
        memberIds: ["alice"],
        preference: "low",
      }),
    ).not.toThrow();
  });

  it("rejects invalid preference values", () => {
    expect(() =>
      createAssignmentPriorityRule({
        memberIds: ["alice"],
        // @ts-expect-error - testing invalid value
        preference: "mandatory",
      }),
    ).toThrow(/preference/i);

    expect(() =>
      createAssignmentPriorityRule({
        memberIds: ["alice"],
        // @ts-expect-error - testing invalid value
        preference: "MANDATORY",
      }),
    ).toThrow(/preference/i);

    expect(() =>
      createAssignmentPriorityRule({
        memberIds: ["alice"],
        // @ts-expect-error - testing invalid value
        preference: "medium",
      }),
    ).toThrow(/preference/i);
  });

  it("accepts role-based scoping", () => {
    expect(() =>
      createAssignmentPriorityRule({
        roleIds: ["senior"],
        preference: "high",
      }),
    ).not.toThrow();
  });

  it("accepts skill-based scoping", () => {
    expect(() =>
      createAssignmentPriorityRule({
        skillIds: ["keyholder"],
        preference: "high",
      }),
    ).not.toThrow();
  });

  it("accepts time-based scoping", () => {
    expect(() =>
      createAssignmentPriorityRule({
        memberIds: ["alice"],
        preference: "high",
        dayOfWeek: ["monday", "tuesday"],
      }),
    ).not.toThrow();
  });
});
