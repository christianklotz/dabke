import { describe, it, expect } from "vitest";
import {
  defineSemanticTimes,
  isConcreteCoverage,
  isSemanticCoverage,
  isVariantCoverage,
} from "../../src/cpsat/semantic-time.js";
import type {
  MixedCoverageRequirement,
  VariantCoverageRequirement,
} from "../../src/cpsat/semantic-time.js";
import type { TimeOfDay } from "../../src/types.js";

const t = (hours: number, minutes = 0): TimeOfDay => ({ hours, minutes });

describe("defineSemanticTimes", () => {
  describe("basic usage", () => {
    it("should create a semantic time context with type-safe names", () => {
      const times = defineSemanticTimes({
        opening: { startTime: t(6), endTime: t(8) },
        lunch: { startTime: t(11, 30), endTime: t(14) },
        closing: { startTime: t(21), endTime: t(23) },
      });

      expect(times.defs).toHaveProperty("opening");
      expect(times.defs).toHaveProperty("lunch");
      expect(times.defs).toHaveProperty("closing");
    });

    it("should pass through coverage requirements", () => {
      const times = defineSemanticTimes({
        lunch: { startTime: t(11, 30), endTime: t(14) },
      });

      const coverage = times.coverage([
        { semanticTime: "lunch", roleIds: ["server"], targetCount: 3 },
      ]);

      expect(coverage).toHaveLength(1);
      expect(coverage[0]).toEqual({
        semanticTime: "lunch",
        roleIds: ["server"],
        targetCount: 3,
      });
    });
  });

  describe("resolve", () => {
    it("should resolve simple semantic time to all days", () => {
      const times = defineSemanticTimes({
        lunch: { startTime: t(11, 30), endTime: t(14) },
      });

      const coverage = times.coverage([
        { semanticTime: "lunch", roleIds: ["server"], targetCount: 3 },
      ]);

      const days = ["2026-01-12", "2026-01-13", "2026-01-14"];
      const resolved = times.resolve(coverage, days);

      expect(resolved).toHaveLength(3);
      expect(resolved[0]).toMatchObject({
        day: "2026-01-12",
        startTime: t(11, 30),
        endTime: t(14),
        roleIds: ["server"],
        targetCount: 3,
        priority: "MANDATORY",
      });
      // Should auto-generate group
      expect(resolved[0]?.group?.title).toBe("3x server during lunch");
    });

    it("should resolve semantic coverage scoped to specific days of week", () => {
      const times = defineSemanticTimes({
        lunch: { startTime: t(11, 30), endTime: t(14) },
      });

      const coverage = times.coverage([
        {
          semanticTime: "lunch",
          roleIds: ["server"],
          targetCount: 4,
          dayOfWeek: ["saturday", "sunday"],
        },
      ]);

      // 2026-01-10 is Saturday, 2026-01-11 is Sunday, 2026-01-12 is Monday
      const days = ["2026-01-10", "2026-01-11", "2026-01-12"];
      const resolved = times.resolve(coverage, days);

      expect(resolved).toHaveLength(2);
      expect(resolved.map((r) => r.day)).toEqual(["2026-01-10", "2026-01-11"]);
    });

    it("should resolve semantic coverage scoped to specific dates", () => {
      const times = defineSemanticTimes({
        lunch: { startTime: t(11, 30), endTime: t(14) },
      });

      const coverage = times.coverage([
        {
          semanticTime: "lunch",
          roleIds: ["server"],
          targetCount: 5,
          dates: ["2026-01-12"],
        },
      ]);

      const days = ["2026-01-11", "2026-01-12", "2026-01-13"];
      const resolved = times.resolve(coverage, days);

      expect(resolved).toHaveLength(1);
      expect(resolved[0]?.day).toBe("2026-01-12");
      expect(resolved[0]?.targetCount).toBe(5);
    });

    it("should resolve concrete coverage requirements", () => {
      const times = defineSemanticTimes({
        lunch: { startTime: t(11, 30), endTime: t(14) },
      });

      const coverage = times.coverage([
        // One-off party
        {
          day: "2026-01-14",
          startTime: t(15),
          endTime: t(20),
          roleIds: ["server"],
          targetCount: 5,
        },
      ]);

      const days = ["2026-01-13", "2026-01-14", "2026-01-15"];
      const resolved = times.resolve(coverage, days);

      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toMatchObject({
        day: "2026-01-14",
        startTime: t(15),
        endTime: t(20),
        roleIds: ["server"],
        targetCount: 5,
        priority: "MANDATORY",
      });
      // Should auto-generate group for concrete coverage
      expect(resolved[0]?.group?.title).toBe("5x server on 2026-01-14 15:00-20:00");
    });

    it("should filter out concrete coverage for days not in horizon", () => {
      const times = defineSemanticTimes({
        lunch: { startTime: t(11, 30), endTime: t(14) },
      });

      const coverage = times.coverage([
        {
          day: "2026-01-20",
          startTime: t(15),
          endTime: t(20),
          roleIds: ["server"],
          targetCount: 5,
        },
      ]);

      const days = ["2026-01-13", "2026-01-14", "2026-01-15"];
      const resolved = times.resolve(coverage, days);

      expect(resolved).toHaveLength(0);
    });

    it("should handle mixed semantic and concrete coverage", () => {
      const times = defineSemanticTimes({
        lunch: { startTime: t(11, 30), endTime: t(14) },
      });

      const coverage = times.coverage([
        { semanticTime: "lunch", roleIds: ["server"], targetCount: 3 },
        {
          day: "2026-01-14",
          startTime: t(15),
          endTime: t(20),
          roleIds: ["server"],
          targetCount: 5,
          priority: "MANDATORY",
        },
      ]);

      const days = ["2026-01-13", "2026-01-14"];
      const resolved = times.resolve(coverage, days);

      expect(resolved).toHaveLength(3);
      // 2 lunch requirements + 1 party
      const lunchReqs = resolved.filter((r) => r.startTime.hours === 11);
      const partyReqs = resolved.filter((r) => r.startTime.hours === 15);
      expect(lunchReqs).toHaveLength(2);
      expect(partyReqs).toHaveLength(1);
      expect(partyReqs[0]?.priority).toBe("MANDATORY");
    });
  });

  describe("variants", () => {
    it("should resolve different times for weekdays vs weekends", () => {
      const times = defineSemanticTimes({
        lunch: [
          {
            startTime: t(11, 30),
            endTime: t(14),
            dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
          },
          { startTime: t(12), endTime: t(15), dayOfWeek: ["saturday", "sunday"] },
        ],
      });

      const coverage = times.coverage([
        { semanticTime: "lunch", roleIds: ["server"], targetCount: 3 },
      ]);

      // 2026-01-09 is Friday, 2026-01-10 is Saturday
      const days = ["2026-01-09", "2026-01-10"];
      const resolved = times.resolve(coverage, days);

      expect(resolved).toHaveLength(2);

      const friday = resolved.find((r) => r.day === "2026-01-09");
      const saturday = resolved.find((r) => r.day === "2026-01-10");

      expect(friday?.startTime).toEqual(t(11, 30));
      expect(friday?.endTime).toEqual(t(14));

      expect(saturday?.startTime).toEqual(t(12));
      expect(saturday?.endTime).toEqual(t(15));
    });

    it("should resolve date-specific overrides over day-of-week variants", () => {
      const times = defineSemanticTimes({
        closing: [
          { startTime: t(21), endTime: t(23) }, // default
          { startTime: t(23), endTime: t(1), dates: ["2026-01-01"] }, // NYE late
        ],
      });

      const coverage = times.coverage([
        { semanticTime: "closing", roleIds: ["server"], targetCount: 2 },
      ]);

      const days = ["2025-12-31", "2026-01-01", "2026-01-02"];
      const resolved = times.resolve(coverage, days);

      expect(resolved).toHaveLength(3);

      const nye = resolved.find((r) => r.day === "2026-01-01");
      const normal = resolved.find((r) => r.day === "2026-01-02");

      expect(nye?.startTime).toEqual(t(23));
      expect(nye?.endTime).toEqual(t(1));

      expect(normal?.startTime).toEqual(t(21));
      expect(normal?.endTime).toEqual(t(23));
    });

    it("should return null for days with no matching variant", () => {
      const times = defineSemanticTimes({
        weekdayOnly: [
          {
            startTime: t(9),
            endTime: t(17),
            dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
          },
        ],
      });

      const coverage = times.coverage([
        { semanticTime: "weekdayOnly", roleIds: ["staff"], targetCount: 1 },
      ]);

      // 2026-01-10 is Saturday - no variant matches
      const days = ["2026-01-10"];
      const resolved = times.resolve(coverage, days);

      expect(resolved).toHaveLength(0);
    });

    it("should prefer day-of-week over default when date-specific not available", () => {
      const times = defineSemanticTimes({
        lunch: [
          { startTime: t(11), endTime: t(14) }, // default
          { startTime: t(12), endTime: t(15), dayOfWeek: ["saturday"] },
        ],
      });

      const coverage = times.coverage([
        { semanticTime: "lunch", roleIds: ["server"], targetCount: 2 },
      ]);

      // 2026-01-09 Friday (uses default), 2026-01-10 Saturday (uses variant)
      const days = ["2026-01-09", "2026-01-10"];
      const resolved = times.resolve(coverage, days);

      const friday = resolved.find((r) => r.day === "2026-01-09");
      const saturday = resolved.find((r) => r.day === "2026-01-10");

      expect(friday?.startTime).toEqual(t(11));
      expect(saturday?.startTime).toEqual(t(12));
    });
  });

  describe("type guards", () => {
    it("should correctly identify concrete coverage", () => {
      expect(
        isConcreteCoverage({
          day: "2026-01-14",
          startTime: t(15),
          endTime: t(20),
          roleIds: ["server"],
          targetCount: 5,
        }),
      ).toBe(true);

      expect(
        isConcreteCoverage({
          semanticTime: "lunch",
          roleIds: ["server"],
          targetCount: 3,
        } as any),
      ).toBe(false);
    });

    it("should correctly identify semantic coverage", () => {
      expect(
        isSemanticCoverage({
          semanticTime: "lunch",
          roleIds: ["server"],
          targetCount: 3,
        }),
      ).toBe(true);

      expect(
        isSemanticCoverage({
          day: "2026-01-14",
          startTime: t(15),
          endTime: t(20),
          roleIds: ["server"],
          targetCount: 5,
        } as any),
      ).toBe(false);
    });
  });

  describe("priority handling", () => {
    it("should default to MANDATORY priority", () => {
      const times = defineSemanticTimes({
        lunch: { startTime: t(11, 30), endTime: t(14) },
      });

      const coverage = times.coverage([
        { semanticTime: "lunch", roleIds: ["server"], targetCount: 3 },
      ]);

      const resolved = times.resolve(coverage, ["2026-01-12"]);
      expect(resolved[0]?.priority).toBe("MANDATORY");
    });

    it("should preserve specified priority", () => {
      const times = defineSemanticTimes({
        opening: { startTime: t(6), endTime: t(8) },
      });

      const coverage = times.coverage([
        {
          semanticTime: "opening",
          roleIds: ["keyholder"],
          targetCount: 1,
          priority: "MANDATORY",
        },
      ]);

      const resolved = times.resolve(coverage, ["2026-01-12"]);
      expect(resolved[0]?.priority).toBe("MANDATORY");
    });
  });

  describe("error handling", () => {
    it("should throw for unknown semantic time during resolve", () => {
      const times = defineSemanticTimes({
        lunch: { startTime: t(11, 30), endTime: t(14) },
      });

      // Force an invalid semantic time name
      const coverage = [
        {
          semanticTime: "dinner" as "lunch",
          roleIds: ["server"] as [string, ...string[]],
          targetCount: 2,
        },
      ];

      expect(() => times.resolve(coverage, ["2026-01-12"])).toThrow(
        "Unknown semantic time: dinner",
      );
    });
  });

  describe("skill-based coverage", () => {
    it("should resolve semantic coverage with skills only", () => {
      const times = defineSemanticTimes({
        opening: { startTime: t(6), endTime: t(8) },
      });

      const coverage = times.coverage([
        {
          semanticTime: "opening",
          skillIds: ["keyholder"],
          targetCount: 1,
          priority: "MANDATORY",
        },
      ]);

      const resolved = times.resolve(coverage, ["2026-01-12"]);

      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toMatchObject({
        day: "2026-01-12",
        startTime: t(6),
        endTime: t(8),
        skillIds: ["keyholder"],
        targetCount: 1,
        priority: "MANDATORY",
      });
      expect(resolved[0]?.roleIds).toBeUndefined();
      expect(resolved[0]?.group?.title).toBe("1x keyholder during opening");
    });

    it("should resolve semantic coverage with both roles and skills", () => {
      const times = defineSemanticTimes({
        training: { startTime: t(9), endTime: t(17) },
      });

      const coverage = times.coverage([
        {
          semanticTime: "training",
          roleIds: ["waiter"],
          skillIds: ["senior", "trainer"],
          targetCount: 1,
        },
      ]);

      const resolved = times.resolve(coverage, ["2026-01-12"]);

      expect(resolved).toHaveLength(1);
      expect(resolved[0]?.roleIds).toEqual(["waiter"]);
      expect(resolved[0]?.skillIds).toEqual(["senior", "trainer"]);
    });

    it("should resolve concrete coverage with skills only", () => {
      const times = defineSemanticTimes({
        lunch: { startTime: t(11, 30), endTime: t(14) },
      });

      const coverage = times.coverage([
        {
          day: "2026-01-12",
          startTime: t(6),
          endTime: t(8),
          skillIds: ["keyholder"],
          targetCount: 1,
        },
      ]);

      const resolved = times.resolve(coverage, ["2026-01-12"]);

      expect(resolved).toHaveLength(1);
      expect(resolved[0]?.skillIds).toEqual(["keyholder"]);
      expect(resolved[0]?.roleIds).toBeUndefined();
    });

    it("should resolve concrete coverage with both roles and skills", () => {
      const times = defineSemanticTimes({
        lunch: { startTime: t(11, 30), endTime: t(14) },
      });

      const coverage = times.coverage([
        {
          day: "2026-01-12",
          startTime: t(22),
          endTime: t(23),
          roleIds: ["waiter"],
          skillIds: ["can_close"],
          targetCount: 1,
          priority: "MANDATORY",
        },
      ]);

      const resolved = times.resolve(coverage, ["2026-01-12"]);

      expect(resolved).toHaveLength(1);
      expect(resolved[0]?.roleIds).toEqual(["waiter"]);
      expect(resolved[0]?.skillIds).toEqual(["can_close"]);
    });

    it("should not include skills when not provided", () => {
      const times = defineSemanticTimes({
        lunch: { startTime: t(11, 30), endTime: t(14) },
      });

      const coverage = times.coverage([
        { semanticTime: "lunch", roleIds: ["server"], targetCount: 3 },
      ]);

      const resolved = times.resolve(coverage, ["2026-01-12"]);

      expect(resolved[0]).not.toHaveProperty("skills");
    });

    it("should include skills when provided with roles", () => {
      const times = defineSemanticTimes({
        lunch: { startTime: t(11, 30), endTime: t(14) },
      });

      const coverage = times.coverage([
        {
          semanticTime: "lunch",
          roleIds: ["server"],
          skillIds: ["senior"],
          targetCount: 3,
        },
      ]);

      const resolved = times.resolve(coverage, ["2026-01-12"]);

      expect(resolved[0]?.roleIds).toEqual(["server"]);
      expect(resolved[0]?.skillIds).toEqual(["senior"]);
    });
  });

  describe("variant coverage", () => {
    it("resolves default variant on all days", () => {
      const times = defineSemanticTimes({
        dinner: { startTime: t(17), endTime: t(22) },
      });

      const coverage: MixedCoverageRequirement<"dinner">[] = [
        {
          semanticTime: "dinner",
          roleIds: ["waiter"],
          variants: [{ count: 3 }],
        },
      ];

      const days = ["2026-01-12", "2026-01-13", "2026-01-14"];
      const resolved = times.resolve(coverage, days);

      expect(resolved).toHaveLength(3);
      for (const r of resolved) {
        expect(r.targetCount).toBe(3);
        expect(r.startTime).toEqual(t(17));
        expect(r.endTime).toEqual(t(22));
      }
    });

    it("resolves date-specific variant over default", () => {
      const times = defineSemanticTimes({
        dinner: { startTime: t(17), endTime: t(22) },
      });

      const coverage: MixedCoverageRequirement<"dinner">[] = [
        {
          semanticTime: "dinner",
          roleIds: ["waiter"],
          variants: [{ count: 3 }, { count: 1, dates: ["2026-01-13"] }],
        },
      ];

      const days = ["2026-01-12", "2026-01-13", "2026-01-14"];
      const resolved = times.resolve(coverage, days);

      expect(resolved).toHaveLength(3);
      expect(resolved.find((r) => r.day === "2026-01-12")?.targetCount).toBe(3);
      expect(resolved.find((r) => r.day === "2026-01-13")?.targetCount).toBe(1);
      expect(resolved.find((r) => r.day === "2026-01-14")?.targetCount).toBe(3);
    });

    it("resolves dayOfWeek variant over default", () => {
      const times = defineSemanticTimes({
        dinner: { startTime: t(17), endTime: t(22) },
      });

      const coverage: MixedCoverageRequirement<"dinner">[] = [
        {
          semanticTime: "dinner",
          roleIds: ["waiter"],
          variants: [{ count: 2 }, { count: 4, dayOfWeek: ["saturday", "sunday"] }],
        },
      ];

      // 2026-01-09 Fri, 2026-01-10 Sat, 2026-01-11 Sun, 2026-01-12 Mon
      const days = ["2026-01-09", "2026-01-10", "2026-01-11", "2026-01-12"];
      const resolved = times.resolve(coverage, days);

      expect(resolved).toHaveLength(4);
      expect(resolved.find((r) => r.day === "2026-01-09")?.targetCount).toBe(2);
      expect(resolved.find((r) => r.day === "2026-01-10")?.targetCount).toBe(4);
      expect(resolved.find((r) => r.day === "2026-01-11")?.targetCount).toBe(4);
      expect(resolved.find((r) => r.day === "2026-01-12")?.targetCount).toBe(2);
    });

    it("resolves date-specific over dayOfWeek over default", () => {
      const times = defineSemanticTimes({
        dinner: { startTime: t(17), endTime: t(22) },
      });

      const coverage: MixedCoverageRequirement<"dinner">[] = [
        {
          semanticTime: "dinner",
          roleIds: ["waiter"],
          variants: [
            { count: 2 },
            { count: 4, dayOfWeek: ["saturday"] },
            { count: 6, dates: ["2026-01-10"] },
          ],
        },
      ];

      // 2026-01-09 Fri, 2026-01-10 Sat (has date override), 2026-01-17 Sat (dayOfWeek only)
      const days = ["2026-01-09", "2026-01-10", "2026-01-17"];
      const resolved = times.resolve(coverage, days);

      expect(resolved).toHaveLength(3);
      expect(resolved.find((r) => r.day === "2026-01-09")?.targetCount).toBe(2);
      expect(resolved.find((r) => r.day === "2026-01-10")?.targetCount).toBe(6);
      expect(resolved.find((r) => r.day === "2026-01-17")?.targetCount).toBe(4);
    });

    it("emits nothing for days without matching variant (no default)", () => {
      const times = defineSemanticTimes({
        dinner: { startTime: t(17), endTime: t(22) },
      });

      const coverage: MixedCoverageRequirement<"dinner">[] = [
        {
          semanticTime: "dinner",
          roleIds: ["waiter"],
          variants: [{ count: 4, dayOfWeek: ["saturday", "sunday"] }],
        },
      ];

      // 2026-01-09 is Friday
      const days = ["2026-01-09"];
      const resolved = times.resolve(coverage, days);

      expect(resolved).toHaveLength(0);
    });

    it("preserves per-variant priority", () => {
      const times = defineSemanticTimes({
        dinner: { startTime: t(17), endTime: t(22) },
      });

      const coverage: MixedCoverageRequirement<"dinner">[] = [
        {
          semanticTime: "dinner",
          roleIds: ["waiter"],
          variants: [
            { count: 3, priority: "MANDATORY" },
            { count: 1, dates: ["2026-01-13"], priority: "HIGH" },
          ],
        },
      ];

      const days = ["2026-01-12", "2026-01-13"];
      const resolved = times.resolve(coverage, days);

      expect(resolved.find((r) => r.day === "2026-01-12")?.priority).toBe("MANDATORY");
      expect(resolved.find((r) => r.day === "2026-01-13")?.priority).toBe("HIGH");
    });

    it("defaults priority to MANDATORY for variants without explicit priority", () => {
      const times = defineSemanticTimes({
        dinner: { startTime: t(17), endTime: t(22) },
      });

      const coverage: MixedCoverageRequirement<"dinner">[] = [
        {
          semanticTime: "dinner",
          roleIds: ["waiter"],
          variants: [{ count: 3 }],
        },
      ];

      const resolved = times.resolve(coverage, ["2026-01-12"]);
      expect(resolved[0]?.priority).toBe("MANDATORY");
    });

    it("generates group key for variant coverage", () => {
      const times = defineSemanticTimes({
        dinner: { startTime: t(17), endTime: t(22) },
      });

      const coverage: MixedCoverageRequirement<"dinner">[] = [
        {
          semanticTime: "dinner",
          roleIds: ["waiter"],
          variants: [{ count: 3 }, { count: 5, dates: ["2026-01-13"] }],
        },
      ];

      const resolved = times.resolve(coverage, ["2026-01-12", "2026-01-13"]);
      // All resolved entries from the same variant cover share a group key
      expect(resolved[0]?.group?.title).toBe("waiter during dinner");
      expect(resolved[1]?.group?.title).toBe("waiter during dinner");
    });

    it("resolves variant coverage with skill-only target", () => {
      const times = defineSemanticTimes({
        opening: { startTime: t(6), endTime: t(8) },
      });

      const coverage: MixedCoverageRequirement<"opening">[] = [
        {
          semanticTime: "opening",
          skillIds: ["keyholder"],
          variants: [{ count: 1 }, { count: 2, dayOfWeek: ["saturday", "sunday"] }],
        },
      ];

      // 2026-01-09 Fri, 2026-01-10 Sat
      const days = ["2026-01-09", "2026-01-10"];
      const resolved = times.resolve(coverage, days);

      expect(resolved).toHaveLength(2);
      expect(resolved.find((r) => r.day === "2026-01-09")?.targetCount).toBe(1);
      expect(resolved.find((r) => r.day === "2026-01-10")?.targetCount).toBe(2);
      expect(resolved[0]?.skillIds).toEqual(["keyholder"]);
      expect(resolved[0]?.roleIds).toBeUndefined();
    });

    it("works with semantic time variants", () => {
      const times = defineSemanticTimes({
        dinner: [
          { startTime: t(17), endTime: t(21) },
          { startTime: t(18), endTime: t(22), dayOfWeek: ["saturday", "sunday"] },
        ],
      });

      const coverage: MixedCoverageRequirement<"dinner">[] = [
        {
          semanticTime: "dinner",
          roleIds: ["waiter"],
          variants: [{ count: 2 }, { count: 4, dayOfWeek: ["saturday", "sunday"] }],
        },
      ];

      // 2026-01-09 Fri, 2026-01-10 Sat
      const days = ["2026-01-09", "2026-01-10"];
      const resolved = times.resolve(coverage, days);

      expect(resolved).toHaveLength(2);
      // Friday: default time (17-21), default count (2)
      const fri = resolved.find((r) => r.day === "2026-01-09")!;
      expect(fri.startTime).toEqual(t(17));
      expect(fri.endTime).toEqual(t(21));
      expect(fri.targetCount).toBe(2);
      // Saturday: weekend time (18-22), weekend count (4)
      const sat = resolved.find((r) => r.day === "2026-01-10")!;
      expect(sat.startTime).toEqual(t(18));
      expect(sat.endTime).toEqual(t(22));
      expect(sat.targetCount).toBe(4);
    });

    it("throws for unknown semantic time in variant coverage", () => {
      const times = defineSemanticTimes({
        lunch: { startTime: t(11, 30), endTime: t(14) },
      });

      const coverage = [
        {
          semanticTime: "dinner" as "lunch",
          roleIds: ["server"] as [string, ...string[]],
          variants: [{ count: 2 }] as [{ count: number }],
        },
      ];

      expect(() => times.resolve(coverage, ["2026-01-12"])).toThrow(
        "Unknown semantic time: dinner",
      );
    });
  });

  describe("type guards", () => {
    it("isVariantCoverage identifies variant coverage", () => {
      const variant: VariantCoverageRequirement<"lunch"> = {
        semanticTime: "lunch",
        roleIds: ["waiter"],
        variants: [{ count: 2 }],
      };
      expect(isVariantCoverage(variant)).toBe(true);
    });

    it("isVariantCoverage returns false for simple semantic coverage", () => {
      expect(
        isVariantCoverage({
          semanticTime: "lunch",
          roleIds: ["waiter"],
          targetCount: 2,
        }),
      ).toBe(false);
    });

    it("isSemanticCoverage returns false for variant coverage", () => {
      expect(
        isSemanticCoverage({
          semanticTime: "lunch",
          roleIds: ["waiter"],
          variants: [{ count: 2 }],
        } as MixedCoverageRequirement<"lunch">),
      ).toBe(false);
    });

    it("isVariantCoverage returns false for concrete coverage", () => {
      expect(
        isVariantCoverage({
          day: "2026-01-12",
          startTime: t(12),
          endTime: t(15),
          roleIds: ["waiter"],
          targetCount: 2,
        } as MixedCoverageRequirement<"lunch">),
      ).toBe(false);
    });
  });
});
