import { describe, it, expect } from "vitest";
import { AssignmentPrioritySchema } from "../src/cpsat/rules/assignment-priority.js";

const createAssignmentPriorityRule = (config: unknown) => AssignmentPrioritySchema.parse(config);

describe("member-assignment-priority schema validation", () => {
  it("accepts valid prefer config", () => {
    expect(() =>
      createAssignmentPriorityRule({
        memberIds: ["alice"],
        preference: "prefer",
      }),
    ).not.toThrow();
  });

  it("accepts valid avoid config", () => {
    expect(() =>
      createAssignmentPriorityRule({
        memberIds: ["alice"],
        preference: "avoid",
      }),
    ).not.toThrow();
  });

  it("rejects invalid preference values", () => {
    expect(() =>
      createAssignmentPriorityRule({
        memberIds: ["alice"],
        preference: "high",
      }),
    ).toThrow(/preference/i);

    expect(() =>
      createAssignmentPriorityRule({
        memberIds: ["alice"],
        preference: "low",
      }),
    ).toThrow(/preference/i);

    expect(() =>
      createAssignmentPriorityRule({
        memberIds: ["alice"],
        preference: "mandatory",
      }),
    ).toThrow(/preference/i);
  });

  it("accepts role-based scoping", () => {
    expect(() =>
      createAssignmentPriorityRule({
        roleIds: ["senior"],
        preference: "prefer",
      }),
    ).not.toThrow();
  });

  it("accepts skill-based scoping", () => {
    expect(() =>
      createAssignmentPriorityRule({
        skillIds: ["keyholder"],
        preference: "prefer",
      }),
    ).not.toThrow();
  });

  it("accepts time-based scoping", () => {
    expect(() =>
      createAssignmentPriorityRule({
        memberIds: ["alice"],
        preference: "prefer",
        dayOfWeek: ["monday", "tuesday"],
      }),
    ).not.toThrow();
  });

  it("accepts priority option", () => {
    expect(() =>
      createAssignmentPriorityRule({
        memberIds: ["alice"],
        preference: "avoid",
        priority: "HIGH",
      }),
    ).not.toThrow();
  });
});
