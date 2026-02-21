import { describe, expect, it } from "vitest";
import { resolveDaysFromPeriod } from "../src/datetime.utils.js";

describe("resolveDaysFromPeriod", () => {
  describe("with dates filter", () => {
    it("should return only specified dates within range", () => {
      const days = resolveDaysFromPeriod({
        dateRange: { start: "2025-02-03", end: "2025-02-10" },
        dates: ["2025-02-07", "2025-02-03", "2025-02-10"],
      });
      expect(days).toEqual(["2025-02-03", "2025-02-07", "2025-02-10"]);
    });

    it("should return empty array for empty dates filter", () => {
      const days = resolveDaysFromPeriod({
        dateRange: { start: "2025-02-03", end: "2025-02-05" },
        dates: [],
      });
      expect(days).toEqual([]);
    });

    it("should handle single date filter", () => {
      const days = resolveDaysFromPeriod({
        dateRange: { start: "2025-02-03", end: "2025-02-07" },
        dates: ["2025-02-05"],
      });
      expect(days).toEqual(["2025-02-05"]);
    });

    it("should ignore dates outside the range", () => {
      const days = resolveDaysFromPeriod({
        dateRange: { start: "2025-02-03", end: "2025-02-05" },
        dates: ["2025-02-01", "2025-02-04", "2025-02-10"],
      });
      expect(days).toEqual(["2025-02-04"]);
    });

    it("should compose with dayOfWeek filter", () => {
      const days = resolveDaysFromPeriod({
        dateRange: { start: "2025-02-03", end: "2025-02-09" },
        dayOfWeek: ["wednesday", "friday"],
        dates: ["2025-02-05", "2025-02-06"], // Wed and Thu
      });
      // Only 2025-02-05 (Wed) passes both filters
      expect(days).toEqual(["2025-02-05"]);
    });
  });

  describe("with dateRange", () => {
    it("should return all days in range (inclusive)", () => {
      const days = resolveDaysFromPeriod({
        dateRange: { start: "2025-02-03", end: "2025-02-05" },
      });
      expect(days).toEqual(["2025-02-03", "2025-02-04", "2025-02-05"]);
    });

    it("should return single day when start equals end", () => {
      const days = resolveDaysFromPeriod({
        dateRange: { start: "2025-02-03", end: "2025-02-03" },
      });
      expect(days).toEqual(["2025-02-03"]);
    });

    it("should handle week range", () => {
      // 2025-02-03 is Monday
      const days = resolveDaysFromPeriod({
        dateRange: { start: "2025-02-03", end: "2025-02-09" },
      });
      expect(days).toHaveLength(7);
      expect(days[0]).toBe("2025-02-03");
      expect(days[6]).toBe("2025-02-09");
    });

    it("should handle month boundary", () => {
      const days = resolveDaysFromPeriod({
        dateRange: { start: "2025-01-30", end: "2025-02-02" },
      });
      expect(days).toEqual(["2025-01-30", "2025-01-31", "2025-02-01", "2025-02-02"]);
    });
  });

  describe("with dateRange and dayOfWeek filter", () => {
    it("should filter to specific days of week", () => {
      // 2025-02-03 is Monday, 2025-02-09 is Sunday
      const days = resolveDaysFromPeriod({
        dateRange: { start: "2025-02-03", end: "2025-02-09" },
        dayOfWeek: ["wednesday", "friday"],
      });
      // Wednesday is 2025-02-05, Friday is 2025-02-07
      expect(days).toEqual(["2025-02-05", "2025-02-07"]);
    });

    it("should handle restaurant closed Monday/Tuesday use case", () => {
      // 2025-02-03 is Monday, 2025-02-09 is Sunday
      const days = resolveDaysFromPeriod({
        dateRange: { start: "2025-02-03", end: "2025-02-09" },
        dayOfWeek: ["wednesday", "thursday", "friday", "saturday", "sunday"],
      });
      expect(days).toHaveLength(5);
      expect(days).toEqual([
        "2025-02-05", // Wednesday
        "2025-02-06", // Thursday
        "2025-02-07", // Friday
        "2025-02-08", // Saturday
        "2025-02-09", // Sunday
      ]);
    });

    it("should return empty array if no matching days in range", () => {
      // 2025-02-03 to 2025-02-04 is Monday to Tuesday
      const days = resolveDaysFromPeriod({
        dateRange: { start: "2025-02-03", end: "2025-02-04" },
        dayOfWeek: ["saturday", "sunday"],
      });
      expect(days).toEqual([]);
    });

    it("should handle single day of week filter", () => {
      // 2025-02-03 is Monday, 2025-02-16 is Sunday (two weeks)
      const days = resolveDaysFromPeriod({
        dateRange: { start: "2025-02-03", end: "2025-02-16" },
        dayOfWeek: ["saturday"],
      });
      expect(days).toEqual(["2025-02-08", "2025-02-15"]);
    });

    it("should treat empty dayOfWeek as empty whitelist (no days)", () => {
      const days = resolveDaysFromPeriod({
        dateRange: { start: "2025-02-03", end: "2025-02-05" },
        dayOfWeek: [],
      });
      // Empty array = empty whitelist = no days match
      // Use undefined/omit dayOfWeek to include all days
      expect(days).toEqual([]);
    });
  });
});
