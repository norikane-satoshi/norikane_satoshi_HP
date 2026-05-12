import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/app/**/page.tsx",
        "src/components/**/*.tsx",
      ],
      thresholds: {
        statements: 30,
        branches: 30,
        functions: 30,
        lines: 30,
        "src/lib/booking/**": {
          statements: 70,
          branches: 70,
          functions: 70,
          lines: 70,
        },
        "src/app/api/booking/**": {
          statements: 70,
          branches: 70,
          functions: 70,
          lines: 70,
        },
        "src/app/api/teams/**": {
          statements: 70,
          branches: 70,
          functions: 70,
          lines: 70,
        },
        "src/app/api/team-invitations/**": {
          statements: 70,
          branches: 70,
          functions: 70,
          lines: 70,
        },
      },
    },
  },
})
