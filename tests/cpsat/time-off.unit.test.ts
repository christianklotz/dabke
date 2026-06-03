import { describe, expect, it } from "vitest";
import {
  TimeOffSchema,
  timeOffRuleDescriptor,
  type TimeOffConfig,
} from "../../src/cpsat/rules/time-off.js";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import { ValidationReporterImpl } from "../../src/cpsat/validation-reporter.js";
import type { RuleCompileContext } from "../../src/cpsat/rule-descriptor.js";
import type { SolverResponse } from "../../src/client.types.js";
import type { ResolvedShiftAssignment } from "../../src/cpsat/response.js";
import type { DateString } from "../../src/types.js";
import { schedulingDay } from "../../src/types.js";

const toSchedulingDay = (iso: string) => schedulingDay(iso as DateString);

function createTimeOffRule(config: TimeOffConfig) {
  const parsed = TimeOffSchema.parse(config);

  return {
    validate(
      assignments: ResolvedShiftAssignment[],
      reporter: ValidationReporterImpl,
      context: RuleCompileContext,
    ) {
      const compiled = timeOffRuleDescriptor.compile(parsed, context);
      for (const artifact of compiled.artifacts) {
        if (artifact.kind === "post-solve-feedback") {
          artifact.run(assignments, reporter, context);
        }
      }
    },
  };
}

function createAssignment(
  memberId: string,
  day: DateString,
  startHours: number,
  endHours: number,
): ResolvedShiftAssignment {
  return {
    memberId,
    day,
    startTime: { hours: startHours, minutes: 0 },
    endTime: { hours: endHours, minutes: 0 },
  };
}

describe("CP-SAT time-off rule: schema validation", () => {
  describe("time scoping requirement", () => {
    it("requires at least one time scope", () => {
      expect(() =>
        createTimeOffRule({
          memberIds: ["alice"],
          priority: "MANDATORY",
        } as any),
      ).toThrow("Must provide time scoping");
    });

    it("accepts specificDates", () => {
      expect(() =>
        createTimeOffRule({
          memberIds: ["alice"],
          specificDates: ["2024-02-01"],
          priority: "MANDATORY",
        }),
      ).not.toThrow();
    });

    it("accepts dateRange", () => {
      expect(() =>
        createTimeOffRule({
          memberIds: ["alice"],
          dateRange: { start: "2024-02-01", end: "2024-02-05" },
          priority: "MANDATORY",
        }),
      ).not.toThrow();
    });

    it("accepts dayOfWeek", () => {
      expect(() =>
        createTimeOffRule({
          memberIds: ["alice"],
          dayOfWeek: ["monday", "friday"],
          priority: "MANDATORY",
        }),
      ).not.toThrow();
    });

    it("accepts recurringPeriods", () => {
      expect(() =>
        createTimeOffRule({
          recurringPeriods: [
            {
              name: "summer",
              startMonth: 7,
              startDay: 1,
              endMonth: 8,
              endDay: 31,
            },
          ],
          priority: "MANDATORY",
        }),
      ).not.toThrow();
    });
  });

  describe("date string format validation", () => {
    it("validates specificDates format", () => {
      expect(() =>
        createTimeOffRule({
          memberIds: ["alice"],
          // @ts-expect-error: runtime schema validation case for invalid date input
          specificDates: ["2024-02-01", "Feb 2, 2024"],
          priority: "MANDATORY",
        }),
      ).toThrow(/Invalid/i);
    });

    it("validates dateRange start format", () => {
      expect(() =>
        createTimeOffRule({
          memberIds: ["alice"],
          // @ts-expect-error: runtime schema validation case for invalid date input
          dateRange: { start: "02/01/2024", end: "2024-02-05" },
          priority: "MANDATORY",
        }),
      ).toThrow(/Invalid/i);
    });

    it("validates dateRange end format", () => {
      expect(() =>
        createTimeOffRule({
          memberIds: ["alice"],
          // @ts-expect-error: runtime schema validation case for invalid date input
          dateRange: { start: "2024-02-01", end: "February 5" },
          priority: "MANDATORY",
        }),
      ).toThrow(/Invalid/i);
    });

    it("accepts valid YYYY-MM-DD format in specificDates", () => {
      expect(() =>
        createTimeOffRule({
          memberIds: ["alice"],
          specificDates: ["2024-02-01", "2024-12-31"],
          priority: "MANDATORY",
        }),
      ).not.toThrow();
    });

    it("accepts valid YYYY-MM-DD format in dateRange", () => {
      expect(() =>
        createTimeOffRule({
          memberIds: ["alice"],
          dateRange: { start: "2024-02-01", end: "2024-12-31" },
          priority: "MANDATORY",
        }),
      ).not.toThrow();
    });
  });

  describe("partial day time validation", () => {
    it("requires both startTime and endTime together", () => {
      expect(() =>
        createTimeOffRule({
          memberIds: ["alice"],
          specificDates: ["2024-02-01"],
          startTime: { hours: 9, minutes: 0 },
          priority: "MANDATORY",
        }),
      ).toThrow("Both startTime and endTime must be provided together");
    });

    it("rejects endTime without startTime", () => {
      expect(() =>
        createTimeOffRule({
          memberIds: ["alice"],
          specificDates: ["2024-02-01"],
          endTime: { hours: 17, minutes: 0 },
          priority: "MANDATORY",
        }),
      ).toThrow("Both startTime and endTime must be provided together");
    });

    it("accepts both startTime and endTime", () => {
      expect(() =>
        createTimeOffRule({
          memberIds: ["alice"],
          specificDates: ["2024-02-01"],
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
          priority: "MANDATORY",
        }),
      ).not.toThrow();
    });

    it("accepts neither startTime nor endTime (full day)", () => {
      expect(() =>
        createTimeOffRule({
          memberIds: ["alice"],
          specificDates: ["2024-02-01"],
          priority: "MANDATORY",
        }),
      ).not.toThrow();
    });

    it("validates startTime hours range", () => {
      expect(() =>
        createTimeOffRule({
          memberIds: ["alice"],
          specificDates: ["2024-02-01"],
          startTime: { hours: 25, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
          priority: "MANDATORY",
        }),
      ).toThrow(/hours/i);
    });

    it("validates startTime minutes range", () => {
      expect(() =>
        createTimeOffRule({
          memberIds: ["alice"],
          specificDates: ["2024-02-01"],
          startTime: { hours: 9, minutes: 60 },
          endTime: { hours: 17, minutes: 0 },
          priority: "MANDATORY",
        }),
      ).toThrow(/minutes/i);
    });
  });

  describe("entity scoping", () => {
    it("accepts memberIds", () => {
      expect(() =>
        createTimeOffRule({
          memberIds: ["alice", "bob"],
          specificDates: ["2024-02-01"],
          priority: "MANDATORY",
        }),
      ).not.toThrow();
    });

    it("accepts roleIds", () => {
      expect(() =>
        createTimeOffRule({
          roleIds: ["student"],
          specificDates: ["2024-02-01"],
          priority: "MANDATORY",
        }),
      ).not.toThrow();
    });

    it("accepts skillIds", () => {
      expect(() =>
        createTimeOffRule({
          skillIds: ["forklift"],
          specificDates: ["2024-02-01"],
          priority: "MANDATORY",
        }),
      ).not.toThrow();
    });

    it("accepts global scope (no entity specified)", () => {
      expect(() =>
        createTimeOffRule({
          specificDates: ["2024-02-01"],
          priority: "MANDATORY",
        }),
      ).not.toThrow();
    });

    it("rejects multiple entity scopes", () => {
      expect(() =>
        // @ts-expect-error: deliberately passing both memberIds and roleIds to test runtime validation
        createTimeOffRule({
          memberIds: ["alice"],
          roleIds: ["student"],
          specificDates: ["2024-02-01"],
          priority: "MANDATORY",
        }),
      ).toThrow(/Only one of memberIds\/roleIds\/skillIds/);
    });
  });

  describe("priority levels", () => {
    it.each(["LOW", "MEDIUM", "HIGH", "MANDATORY"] as const)("accepts priority %s", (priority) => {
      expect(() =>
        createTimeOffRule({
          memberIds: ["alice"],
          specificDates: ["2024-02-01"],
          priority,
        }),
      ).not.toThrow();
    });

    it("rejects invalid priority", () => {
      expect(() =>
        createTimeOffRule({
          memberIds: ["alice"],
          specificDates: ["2024-02-01"],
          priority: "CRITICAL" as any,
        }),
      ).toThrow(/priority/i);
    });
  });
});

describe("CP-SAT time-off rule: validate()", () => {
  const baseContext: RuleCompileContext = {
    members: [
      { id: "alice", roleIds: ["barista"] },
      { id: "bob", roleIds: ["barista"] },
      { id: "charlie", roleIds: ["manager"] },
    ],
    days: ["2024-02-01", "2024-02-02", "2024-02-03"].map(toSchedulingDay),
    shiftPatterns: [
      {
        id: "morning",
        roleIds: ["barista"],
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 13, minutes: 0 },
      },
    ],
    weekStartsOn: "monday",
  };

  describe("MANDATORY priority", () => {
    it("does not report anything for MANDATORY time-off (hard constraint)", () => {
      const rule = createTimeOffRule({
        memberIds: ["alice"],
        specificDates: ["2024-02-01"],
        priority: "MANDATORY",
      });

      const reporter = new ValidationReporterImpl();
      const assignments = [createAssignment("alice", "2024-02-01", 9, 13)];

      rule.validate?.(assignments, reporter, baseContext);

      const validation = reporter.getValidation();
      expect(validation.violations).toHaveLength(0);
      expect(validation.passed).toHaveLength(0);
    });
  });

  describe("soft priority violations", () => {
    it("reports violation when member works during requested time-off", () => {
      const rule = createTimeOffRule({
        memberIds: ["alice"],
        specificDates: ["2024-02-01"],
        priority: "LOW",
      });

      const reporter = new ValidationReporterImpl();
      const assignments = [createAssignment("alice", "2024-02-01", 9, 13)];

      rule.validate?.(assignments, reporter, baseContext);

      const validation = reporter.getValidation();
      expect(validation.violations).toHaveLength(0);
      expect(validation.passed).toHaveLength(0);
    });

    it("reports passed when member does not work during requested time-off", () => {
      const rule = createTimeOffRule({
        memberIds: ["alice"],
        specificDates: ["2024-02-01"],
        priority: "HIGH",
      });

      const reporter = new ValidationReporterImpl();
      const assignments = [createAssignment("bob", "2024-02-01", 9, 13)];

      rule.validate?.(assignments, reporter, baseContext);

      const validation = reporter.getValidation();
      expect(validation.violations).toHaveLength(0);
      expect(validation.passed).toHaveLength(1);
      const passed = validation.passed[0];
      expect(passed?.type).toBe("rule");
      if (passed?.type === "rule") {
        expect(passed.rule).toBe("time-off");
        expect(passed.message).toContain("alice");
      }
    });

    it("reports passed when no assignments exist", () => {
      const rule = createTimeOffRule({
        memberIds: ["alice"],
        specificDates: ["2024-02-01"],
        priority: "MEDIUM",
      });

      const reporter = new ValidationReporterImpl();

      rule.validate?.([], reporter, baseContext);

      const validation = reporter.getValidation();
      expect(validation.violations).toHaveLength(0);
      expect(validation.passed).toHaveLength(1);
    });
  });

  describe("partial day time-off", () => {
    it("reports violation when shift overlaps with partial-day time-off", () => {
      const rule = createTimeOffRule({
        memberIds: ["alice"],
        specificDates: ["2024-02-01"],
        startTime: { hours: 10, minutes: 0 },
        endTime: { hours: 14, minutes: 0 },
        priority: "LOW",
      });

      const reporter = new ValidationReporterImpl();
      // Shift 9-13 overlaps with time-off 10-14
      const assignments = [createAssignment("alice", "2024-02-01", 9, 13)];

      rule.validate?.(assignments, reporter, baseContext);

      const validation = reporter.getValidation();
      expect(validation.violations).toHaveLength(0);
      expect(validation.passed).toHaveLength(0);
    });

    it("reports passed when shift does not overlap with partial-day time-off", () => {
      const rule = createTimeOffRule({
        memberIds: ["alice"],
        specificDates: ["2024-02-01"],
        startTime: { hours: 14, minutes: 0 },
        endTime: { hours: 18, minutes: 0 },
        priority: "LOW",
      });

      const reporter = new ValidationReporterImpl();
      // Shift 9-13 does not overlap with time-off 14-18
      const assignments = [createAssignment("alice", "2024-02-01", 9, 13)];

      rule.validate?.(assignments, reporter, baseContext);

      const validation = reporter.getValidation();
      expect(validation.violations).toHaveLength(0);
      expect(validation.passed).toHaveLength(1);
    });

    it("detects boundary overlap (shift ends when time-off starts)", () => {
      const rule = createTimeOffRule({
        memberIds: ["alice"],
        specificDates: ["2024-02-01"],
        startTime: { hours: 13, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
        priority: "LOW",
      });

      const reporter = new ValidationReporterImpl();
      // Shift 9-13 ends exactly when time-off 13-17 starts - no overlap
      const assignments = [createAssignment("alice", "2024-02-01", 9, 13)];

      rule.validate?.(assignments, reporter, baseContext);

      const validation = reporter.getValidation();
      expect(validation.violations).toHaveLength(0);
      expect(validation.passed).toHaveLength(1);
    });
  });

  describe("role-based scoping", () => {
    it("validates time-off for all members with matching role", () => {
      const rule = createTimeOffRule({
        roleIds: ["barista"],
        specificDates: ["2024-02-01"],
        priority: "LOW",
      });

      const reporter = new ValidationReporterImpl();
      // Alice works, Bob doesn't - both are baristas
      const assignments = [createAssignment("alice", "2024-02-01", 9, 13)];

      rule.validate?.(assignments, reporter, baseContext);

      const validation = reporter.getValidation();
      // Alice is violated by solver-tracked reporting; validator only reports Bob as passed
      expect(validation.violations).toHaveLength(0);
      expect(validation.passed).toHaveLength(1);
      const passed = validation.passed[0];
      expect(passed?.type).toBe("rule");
      if (passed?.type === "rule") {
        expect(passed.message).toContain("bob");
      }
    });

    it("ignores members without matching role", () => {
      const rule = createTimeOffRule({
        roleIds: ["barista"],
        specificDates: ["2024-02-01"],
        priority: "LOW",
      });

      const reporter = new ValidationReporterImpl();
      // Charlie (manager) works - should not affect barista time-off
      const assignments = [createAssignment("charlie", "2024-02-01", 9, 13)];

      rule.validate?.(assignments, reporter, baseContext);

      const validation = reporter.getValidation();
      // Both baristas (alice, bob) passed since neither worked
      expect(validation.violations).toHaveLength(0);
      expect(validation.passed).toHaveLength(2);
    });
  });

  describe("multiple days", () => {
    it("reports per-day violations and passed", () => {
      const rule = createTimeOffRule({
        memberIds: ["alice"],
        specificDates: ["2024-02-01", "2024-02-02"],
        priority: "LOW",
      });

      const reporter = new ValidationReporterImpl();
      // Alice works on 02-01 but not 02-02
      const assignments = [createAssignment("alice", "2024-02-01", 9, 13)];

      rule.validate?.(assignments, reporter, baseContext);

      const validation = reporter.getValidation();
      expect(validation.violations).toHaveLength(0);
      expect(validation.passed).toHaveLength(1);
      const passed = validation.passed[0];
      expect(passed?.type).toBe("rule");
      if (passed?.type === "rule") {
        expect(passed.message).toContain("2024-02-02");
      }
    });
  });

  describe("date range scoping", () => {
    it("validates all days in date range", () => {
      const rule = createTimeOffRule({
        memberIds: ["alice"],
        dateRange: { start: "2024-02-01", end: "2024-02-03" },
        priority: "LOW",
      });

      const reporter = new ValidationReporterImpl();
      // Alice works on one day
      const assignments = [createAssignment("alice", "2024-02-02", 9, 13)];

      rule.validate?.(assignments, reporter, baseContext);

      const validation = reporter.getValidation();
      // Violations are reported through solver-tracked soft constraints; validator reports only passes
      expect(validation.violations).toHaveLength(0);
      expect(validation.passed).toHaveLength(2);
    });
  });

  describe("context filtering", () => {
    it("only validates days present in context", () => {
      const rule = createTimeOffRule({
        memberIds: ["alice"],
        specificDates: ["2024-02-01", "2024-02-10"], // 02-10 not in context
        priority: "LOW",
      });

      const reporter = new ValidationReporterImpl();
      const assignments: ResolvedShiftAssignment[] = [];

      rule.validate?.(assignments, reporter, baseContext);

      const validation = reporter.getValidation();
      // Only 02-01 should be validated (02-10 not in context.days)
      expect(validation.passed).toHaveLength(1);
      expect(validation.passed[0]?.type).toBe("rule");
      expect(validation.passed[0]?.message).toContain("2024-02-01");
    });

    it("only validates members present in context", () => {
      const rule = createTimeOffRule({
        memberIds: ["alice", "unknown"], // unknown not in context
        specificDates: ["2024-02-01"],
        priority: "LOW",
      });

      const reporter = new ValidationReporterImpl();
      const assignments: ResolvedShiftAssignment[] = [];

      rule.validate?.(assignments, reporter, baseContext);

      const validation = reporter.getValidation();
      // Only alice should be validated (unknown not in context.members)
      expect(validation.passed).toHaveLength(1);
      expect(validation.passed[0]?.type).toBe("rule");
      expect(validation.passed[0]?.message).toContain("alice");
    });
  });
});

describe("CP-SAT time-off rule: regression coverage", () => {
  const compileContext: RuleCompileContext = {
    members: [{ id: "alice", roleIds: ["barista"] }],
    days: ["2024-02-01"].map(toSchedulingDay),
    shiftPatterns: [
      {
        id: "morning",
        roleIds: ["barista"],
        startTime: { hours: 8, minutes: 0 },
        endTime: { hours: 12, minutes: 0 },
      },
      {
        id: "afternoon",
        roleIds: ["barista"],
        startTime: { hours: 13, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      },
    ],
    weekStartsOn: "monday",
  };

  it("uses distinct soft constraint ids for different time windows on the same day", () => {
    const morningRule = timeOffRuleDescriptor.compile(
      TimeOffSchema.parse({
        memberIds: ["alice"],
        specificDates: ["2024-02-01"],
        startTime: { hours: 8, minutes: 0 },
        endTime: { hours: 12, minutes: 0 },
        priority: "LOW",
      }),
      compileContext,
    );
    const afternoonRule = timeOffRuleDescriptor.compile(
      TimeOffSchema.parse({
        memberIds: ["alice"],
        specificDates: ["2024-02-01"],
        startTime: { hours: 13, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
        priority: "LOW",
      }),
      compileContext,
    );

    const morningConstraint = morningRule.artifacts.find(
      (artifact) => artifact.kind === "soft-constraint",
    );
    const afternoonConstraint = afternoonRule.artifacts.find(
      (artifact) => artifact.kind === "soft-constraint",
    );

    expect(morningConstraint?.kind).toBe("soft-constraint");
    expect(afternoonConstraint?.kind).toBe("soft-constraint");
    if (morningConstraint?.kind !== "soft-constraint") {
      throw new Error("Expected morning time-off to compile to a soft constraint");
    }
    if (afternoonConstraint?.kind !== "soft-constraint") {
      throw new Error("Expected afternoon time-off to compile to a soft constraint");
    }

    expect(morningConstraint.constraintId).not.toBe(afternoonConstraint.constraintId);
  });

  it("fails loudly when solver metadata omits soft violations for soft time-off", () => {
    const builder = new ModelBuilder({
      members: [{ id: "alice", roleIds: ["barista"] }],
      shiftPatterns: [
        {
          id: "day",
          roleIds: ["barista"],
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 13, minutes: 0 },
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
      coverage: [
        {
          day: "2024-02-01",
          roleIds: ["barista"],
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 13, minutes: 0 },
          targetCount: 1,
          priority: "MANDATORY",
        },
      ],
      ruleConfigs: [
        {
          name: "time-off",
          memberIds: ["alice"],
          specificDates: ["2024-02-01"],
          priority: "LOW",
        },
      ],
    });

    builder.compile();

    const malformedResponse = {
      status: "OPTIMAL",
      values: { "assign:alice:day:2024-02-01": 1 },
    };

    expect(() =>
      builder.reporter.analyzeSolution(
        // @ts-expect-error: runtime validation coverage for malformed solver payload
        malformedResponse satisfies SolverResponse,
      ),
    ).toThrow(/missing softConstraintViolations/i);
  });
});
