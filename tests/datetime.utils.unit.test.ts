import { describe, expect, it } from "vitest";
import {
  dateTimeRangesOverlap,
  generateDays,
  resolveDaysFromPeriod,
  splitPeriodIntoDays,
  splitPeriodIntoWeeks,
} from "../src/datetime.utils";

describe("splitPeriodIntoDays", () => {
  it("should split a 3-day period into daily ranges", () => {
    const start = new Date("2025-01-01T00:00:00");
    const end = new Date("2025-01-04T00:00:00");

    const ranges = splitPeriodIntoDays({ start, end });

    expect(ranges).toHaveLength(3);
    expect(ranges[0]?.[0]).toEqual(new Date("2025-01-01T00:00:00"));
    expect(ranges[0]?.[1]).toEqual(new Date("2025-01-02T00:00:00"));
    expect(ranges[1]?.[0]).toEqual(new Date("2025-01-02T00:00:00"));
    expect(ranges[1]?.[1]).toEqual(new Date("2025-01-03T00:00:00"));
    expect(ranges[2]?.[0]).toEqual(new Date("2025-01-03T00:00:00"));
    expect(ranges[2]?.[1]).toEqual(new Date("2025-01-04T00:00:00"));
  });

  it("should handle a single day period", () => {
    const start = new Date("2025-01-01T00:00:00");
    const end = new Date("2025-01-02T00:00:00");

    const ranges = splitPeriodIntoDays({ start, end });

    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.[0]).toEqual(new Date("2025-01-01T00:00:00"));
    expect(ranges[0]?.[1]).toEqual(new Date("2025-01-02T00:00:00"));
  });

  it("should handle a partial day at the end", () => {
    const start = new Date("2025-01-01T00:00:00");
    const end = new Date("2025-01-03T12:00:00");

    const ranges = splitPeriodIntoDays({ start, end });

    expect(ranges).toHaveLength(3);
    expect(ranges[2]?.[0]).toEqual(new Date("2025-01-03T00:00:00"));
    expect(ranges[2]?.[1]).toEqual(new Date("2025-01-03T12:00:00"));
  });
});

describe("splitPeriodIntoWeeks", () => {
  describe("with weekStartsOn: monday", () => {
    it("should split a period starting on Monday into weekly ranges", () => {
      // Jan 6, 2025 is a Monday
      const start = new Date("2025-01-06T00:00:00");
      const end = new Date("2025-01-27T00:00:00");

      const ranges = splitPeriodIntoWeeks({ start, end, weekStartsOn: "monday" });

      expect(ranges).toHaveLength(3);

      // First week: Monday Jan 6 to Monday Jan 13
      expect(ranges[0]?.[0]).toEqual(new Date("2025-01-06T00:00:00"));
      expect(ranges[0]?.[1]).toEqual(new Date("2025-01-13T00:00:00"));

      // Second week: Monday Jan 13 to Monday Jan 20
      expect(ranges[1]?.[0]).toEqual(new Date("2025-01-13T00:00:00"));
      expect(ranges[1]?.[1]).toEqual(new Date("2025-01-20T00:00:00"));

      // Third week: Monday Jan 20 to Monday Jan 27
      expect(ranges[2]?.[0]).toEqual(new Date("2025-01-20T00:00:00"));
      expect(ranges[2]?.[1]).toEqual(new Date("2025-01-27T00:00:00"));
    });

    it("should handle a period starting mid-week (Wednesday)", () => {
      // Jan 1, 2025 is a Wednesday
      const start = new Date("2025-01-01T00:00:00");
      const end = new Date("2025-01-15T00:00:00");

      const ranges = splitPeriodIntoWeeks({ start, end, weekStartsOn: "monday" });

      expect(ranges).toHaveLength(3);

      // First partial week: Wednesday Jan 1 to Monday Jan 6
      expect(ranges[0]?.[0]).toEqual(new Date("2025-01-01T00:00:00"));
      expect(ranges[0]?.[1]).toEqual(new Date("2025-01-06T00:00:00"));

      // Second full week: Monday Jan 6 to Monday Jan 13
      expect(ranges[1]?.[0]).toEqual(new Date("2025-01-06T00:00:00"));
      expect(ranges[1]?.[1]).toEqual(new Date("2025-01-13T00:00:00"));

      // Third partial week: Monday Jan 13 to Wednesday Jan 15
      expect(ranges[2]?.[0]).toEqual(new Date("2025-01-13T00:00:00"));
      expect(ranges[2]?.[1]).toEqual(new Date("2025-01-15T00:00:00"));
    });

    it("should handle a period starting on Friday", () => {
      // Jan 3, 2025 is a Friday
      const start = new Date("2025-01-03T00:00:00");
      const end = new Date("2025-01-17T00:00:00");

      const ranges = splitPeriodIntoWeeks({ start, end, weekStartsOn: "monday" });

      expect(ranges).toHaveLength(3);

      // First partial week: Friday Jan 3 to Monday Jan 6
      expect(ranges[0]?.[0]).toEqual(new Date("2025-01-03T00:00:00"));
      expect(ranges[0]?.[1]).toEqual(new Date("2025-01-06T00:00:00"));

      // Second full week: Monday Jan 6 to Monday Jan 13
      expect(ranges[1]?.[0]).toEqual(new Date("2025-01-06T00:00:00"));
      expect(ranges[1]?.[1]).toEqual(new Date("2025-01-13T00:00:00"));

      // Third partial week: Monday Jan 13 to Friday Jan 17
      expect(ranges[2]?.[0]).toEqual(new Date("2025-01-13T00:00:00"));
      expect(ranges[2]?.[1]).toEqual(new Date("2025-01-17T00:00:00"));
    });
  });

  describe("with weekStartsOn: sunday", () => {
    it("should split a period starting on Sunday into weekly ranges", () => {
      // Jan 5, 2025 is a Sunday
      const start = new Date("2025-01-05T00:00:00");
      const end = new Date("2025-01-26T00:00:00");

      const ranges = splitPeriodIntoWeeks({ start, end, weekStartsOn: "sunday" });

      expect(ranges).toHaveLength(3);

      // First week: Sunday Jan 5 to Sunday Jan 12
      expect(ranges[0]?.[0]).toEqual(new Date("2025-01-05T00:00:00"));
      expect(ranges[0]?.[1]).toEqual(new Date("2025-01-12T00:00:00"));

      // Second week: Sunday Jan 12 to Sunday Jan 19
      expect(ranges[1]?.[0]).toEqual(new Date("2025-01-12T00:00:00"));
      expect(ranges[1]?.[1]).toEqual(new Date("2025-01-19T00:00:00"));

      // Third week: Sunday Jan 19 to Sunday Jan 26
      expect(ranges[2]?.[0]).toEqual(new Date("2025-01-19T00:00:00"));
      expect(ranges[2]?.[1]).toEqual(new Date("2025-01-26T00:00:00"));
    });

    it("should handle a period starting mid-week (Wednesday)", () => {
      // Jan 1, 2025 is a Wednesday
      const start = new Date("2025-01-01T00:00:00");
      const end = new Date("2025-01-15T00:00:00");

      const ranges = splitPeriodIntoWeeks({ start, end, weekStartsOn: "sunday" });

      expect(ranges).toHaveLength(3);

      // First partial week: Wednesday Jan 1 to Sunday Jan 5
      expect(ranges[0]?.[0]).toEqual(new Date("2025-01-01T00:00:00"));
      expect(ranges[0]?.[1]).toEqual(new Date("2025-01-05T00:00:00"));

      // Second full week: Sunday Jan 5 to Sunday Jan 12
      expect(ranges[1]?.[0]).toEqual(new Date("2025-01-05T00:00:00"));
      expect(ranges[1]?.[1]).toEqual(new Date("2025-01-12T00:00:00"));

      // Third partial week: Sunday Jan 12 to Wednesday Jan 15
      expect(ranges[2]?.[0]).toEqual(new Date("2025-01-12T00:00:00"));
      expect(ranges[2]?.[1]).toEqual(new Date("2025-01-15T00:00:00"));
    });

    it("should handle a period starting on Saturday", () => {
      // Jan 4, 2025 is a Saturday
      const start = new Date("2025-01-04T00:00:00");
      const end = new Date("2025-01-18T00:00:00");

      const ranges = splitPeriodIntoWeeks({ start, end, weekStartsOn: "sunday" });

      expect(ranges).toHaveLength(3);

      // First partial week: Saturday Jan 4 to Sunday Jan 5
      expect(ranges[0]?.[0]).toEqual(new Date("2025-01-04T00:00:00"));
      expect(ranges[0]?.[1]).toEqual(new Date("2025-01-05T00:00:00"));

      // Second full week: Sunday Jan 5 to Sunday Jan 12
      expect(ranges[1]?.[0]).toEqual(new Date("2025-01-05T00:00:00"));
      expect(ranges[1]?.[1]).toEqual(new Date("2025-01-12T00:00:00"));

      // Third partial week: Sunday Jan 12 to Saturday Jan 18
      expect(ranges[2]?.[0]).toEqual(new Date("2025-01-12T00:00:00"));
      expect(ranges[2]?.[1]).toEqual(new Date("2025-01-18T00:00:00"));
    });
  });

  describe("edge cases", () => {
    it("should handle a single week period", () => {
      // Jan 6, 2025 is a Monday
      const start = new Date("2025-01-06T00:00:00");
      const end = new Date("2025-01-13T00:00:00");

      const ranges = splitPeriodIntoWeeks({ start, end, weekStartsOn: "monday" });

      expect(ranges).toHaveLength(1);
      expect(ranges[0]?.[0]).toEqual(new Date("2025-01-06T00:00:00"));
      expect(ranges[0]?.[1]).toEqual(new Date("2025-01-13T00:00:00"));
    });

    it("should handle a period shorter than a week", () => {
      const start = new Date("2025-01-06T00:00:00");
      const end = new Date("2025-01-09T00:00:00");

      const ranges = splitPeriodIntoWeeks({ start, end, weekStartsOn: "monday" });

      expect(ranges).toHaveLength(1);
      expect(ranges[0]?.[0]).toEqual(new Date("2025-01-06T00:00:00"));
      expect(ranges[0]?.[1]).toEqual(new Date("2025-01-09T00:00:00"));
    });
  });
});

describe("dateTimeRangesOverlap", () => {
  it("should return true for overlapping ranges on same day", () => {
    const result = dateTimeRangesOverlap(
      {
        start: { year: 2025, month: 6, day: 1, hours: 9, minutes: 0 },
        end: { year: 2025, month: 6, day: 1, hours: 17, minutes: 0 },
      },
      {
        start: { year: 2025, month: 6, day: 1, hours: 12, minutes: 0 },
        end: { year: 2025, month: 6, day: 1, hours: 20, minutes: 0 },
      },
    );
    expect(result).toBe(true);
  });

  it("should return false for non-overlapping ranges on same day", () => {
    const result = dateTimeRangesOverlap(
      {
        start: { year: 2025, month: 6, day: 1, hours: 9, minutes: 0 },
        end: { year: 2025, month: 6, day: 1, hours: 12, minutes: 0 },
      },
      {
        start: { year: 2025, month: 6, day: 1, hours: 14, minutes: 0 },
        end: { year: 2025, month: 6, day: 1, hours: 18, minutes: 0 },
      },
    );
    expect(result).toBe(false);
  });

  it("should return false for adjacent ranges (end is exclusive)", () => {
    const result = dateTimeRangesOverlap(
      {
        start: { year: 2025, month: 6, day: 1, hours: 9, minutes: 0 },
        end: { year: 2025, month: 6, day: 1, hours: 12, minutes: 0 },
      },
      {
        start: { year: 2025, month: 6, day: 1, hours: 12, minutes: 0 },
        end: { year: 2025, month: 6, day: 1, hours: 17, minutes: 0 },
      },
    );
    expect(result).toBe(false);
  });

  it("should return false for ranges on different days", () => {
    const result = dateTimeRangesOverlap(
      {
        start: { year: 2025, month: 6, day: 1, hours: 9, minutes: 0 },
        end: { year: 2025, month: 6, day: 1, hours: 17, minutes: 0 },
      },
      {
        start: { year: 2025, month: 6, day: 2, hours: 9, minutes: 0 },
        end: { year: 2025, month: 6, day: 2, hours: 17, minutes: 0 },
      },
    );
    expect(result).toBe(false);
  });

  it("should return true when first range fully contains second", () => {
    const result = dateTimeRangesOverlap(
      {
        start: { year: 2025, month: 6, day: 1, hours: 8, minutes: 0 },
        end: { year: 2025, month: 6, day: 1, hours: 18, minutes: 0 },
      },
      {
        start: { year: 2025, month: 6, day: 1, hours: 12, minutes: 0 },
        end: { year: 2025, month: 6, day: 1, hours: 14, minutes: 0 },
      },
    );
    expect(result).toBe(true);
  });

  it("should return true when second range fully contains first", () => {
    const result = dateTimeRangesOverlap(
      {
        start: { year: 2025, month: 6, day: 1, hours: 12, minutes: 0 },
        end: { year: 2025, month: 6, day: 1, hours: 14, minutes: 0 },
      },
      {
        start: { year: 2025, month: 6, day: 1, hours: 8, minutes: 0 },
        end: { year: 2025, month: 6, day: 1, hours: 18, minutes: 0 },
      },
    );
    expect(result).toBe(true);
  });

  it("should return true for ranges with same start time", () => {
    const result = dateTimeRangesOverlap(
      {
        start: { year: 2025, month: 6, day: 1, hours: 9, minutes: 0 },
        end: { year: 2025, month: 6, day: 1, hours: 12, minutes: 0 },
      },
      {
        start: { year: 2025, month: 6, day: 1, hours: 9, minutes: 0 },
        end: { year: 2025, month: 6, day: 1, hours: 14, minutes: 0 },
      },
    );
    expect(result).toBe(true);
  });

  it("should return true for ranges with same end time", () => {
    const result = dateTimeRangesOverlap(
      {
        start: { year: 2025, month: 6, day: 1, hours: 9, minutes: 0 },
        end: { year: 2025, month: 6, day: 1, hours: 17, minutes: 0 },
      },
      {
        start: { year: 2025, month: 6, day: 1, hours: 12, minutes: 0 },
        end: { year: 2025, month: 6, day: 1, hours: 17, minutes: 0 },
      },
    );
    expect(result).toBe(true);
  });

  it("should return true for identical ranges", () => {
    const result = dateTimeRangesOverlap(
      {
        start: { year: 2025, month: 6, day: 1, hours: 9, minutes: 0 },
        end: { year: 2025, month: 6, day: 1, hours: 17, minutes: 0 },
      },
      {
        start: { year: 2025, month: 6, day: 1, hours: 9, minutes: 0 },
        end: { year: 2025, month: 6, day: 1, hours: 17, minutes: 0 },
      },
    );
    expect(result).toBe(true);
  });

  it("should return true for multi-day overlapping ranges", () => {
    const result = dateTimeRangesOverlap(
      {
        start: { year: 2025, month: 6, day: 1, hours: 20, minutes: 0 },
        end: { year: 2025, month: 6, day: 2, hours: 10, minutes: 0 },
      },
      {
        start: { year: 2025, month: 6, day: 1, hours: 22, minutes: 0 },
        end: { year: 2025, month: 6, day: 2, hours: 8, minutes: 0 },
      },
    );
    expect(result).toBe(true);
  });

  it("should return false for ranges in different months", () => {
    const result = dateTimeRangesOverlap(
      {
        start: { year: 2025, month: 6, day: 30, hours: 9, minutes: 0 },
        end: { year: 2025, month: 6, day: 30, hours: 17, minutes: 0 },
      },
      {
        start: { year: 2025, month: 7, day: 1, hours: 9, minutes: 0 },
        end: { year: 2025, month: 7, day: 1, hours: 17, minutes: 0 },
      },
    );
    expect(result).toBe(false);
  });
});

describe("generateDays", () => {
  it("should generate days from horizon (inclusive end)", () => {
    const days = generateDays({
      start: new Date("2025-01-01"),
      end: new Date("2025-01-04"),
    });

    // End is inclusive: Jan 1-4 = 4 days
    expect(days).toEqual(["2025-01-01", "2025-01-02", "2025-01-03", "2025-01-04"]);
  });

  it("should handle two-day horizon", () => {
    const days = generateDays({
      start: new Date("2025-01-01"),
      end: new Date("2025-01-02"),
    });

    expect(days).toEqual(["2025-01-01", "2025-01-02"]);
  });

  it("should return single day for same start and end", () => {
    const days = generateDays({
      start: new Date("2025-01-01"),
      end: new Date("2025-01-01"),
    });

    // Same day means just that day
    expect(days).toEqual(["2025-01-01"]);
  });

  it("should handle week-long horizon (Mon to Sun inclusive)", () => {
    const days = generateDays({
      start: new Date("2025-01-06"), // Monday
      end: new Date("2025-01-12"), // Sunday (7 days total)
    });

    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2025-01-06");
    expect(days[6]).toBe("2025-01-12");
  });

  it("should handle month boundary", () => {
    const days = generateDays({
      start: new Date("2025-01-30"),
      end: new Date("2025-02-02"),
    });

    // Jan 30, 31, Feb 1, 2 = 4 days
    expect(days).toEqual(["2025-01-30", "2025-01-31", "2025-02-01", "2025-02-02"]);
  });
});

describe("resolveDaysFromPeriod", () => {
  describe("with specificDates", () => {
    it("should return specific dates sorted", () => {
      const days = resolveDaysFromPeriod({
        specificDates: ["2025-02-07", "2025-02-03", "2025-02-10"],
      });
      expect(days).toEqual(["2025-02-03", "2025-02-07", "2025-02-10"]);
    });

    it("should return empty array for empty specificDates", () => {
      const days = resolveDaysFromPeriod({
        specificDates: [],
      });
      expect(days).toEqual([]);
    });

    it("should handle single date", () => {
      const days = resolveDaysFromPeriod({
        specificDates: ["2025-02-05"],
      });
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

  describe("with dateRange and daysOfWeek filter", () => {
    it("should filter to specific days of week", () => {
      // 2025-02-03 is Monday, 2025-02-09 is Sunday
      const days = resolveDaysFromPeriod({
        dateRange: { start: "2025-02-03", end: "2025-02-09" },
        daysOfWeek: ["wednesday", "friday"],
      });
      // Wednesday is 2025-02-05, Friday is 2025-02-07
      expect(days).toEqual(["2025-02-05", "2025-02-07"]);
    });

    it("should handle restaurant closed Monday/Tuesday use case", () => {
      // 2025-02-03 is Monday, 2025-02-09 is Sunday
      const days = resolveDaysFromPeriod({
        dateRange: { start: "2025-02-03", end: "2025-02-09" },
        daysOfWeek: ["wednesday", "thursday", "friday", "saturday", "sunday"],
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
        daysOfWeek: ["saturday", "sunday"],
      });
      expect(days).toEqual([]);
    });

    it("should handle single day of week filter", () => {
      // 2025-02-03 is Monday, 2025-02-16 is Sunday (two weeks)
      const days = resolveDaysFromPeriod({
        dateRange: { start: "2025-02-03", end: "2025-02-16" },
        daysOfWeek: ["saturday"],
      });
      expect(days).toEqual(["2025-02-08", "2025-02-15"]);
    });

    it("should treat empty daysOfWeek as empty whitelist (no days)", () => {
      const days = resolveDaysFromPeriod({
        dateRange: { start: "2025-02-03", end: "2025-02-05" },
        daysOfWeek: [],
      });
      // Empty array = empty whitelist = no days match
      // Use undefined/omit daysOfWeek to include all days
      expect(days).toEqual([]);
    });
  });
});
