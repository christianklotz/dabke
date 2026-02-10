import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["**/*.unit.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["**/*.integration.test.ts"],
          globalSetup: "./tests/global-setup.ts",
        },
      },
    ],
  },
});
