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
    include: ["tests/unit/**/*.test.ts", "src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/app/**/page.tsx",
        "src/components/notes/**",
        "src/components/**/*.tsx",
      ],
      thresholds: {
        statements: 60,
        branches: 55,
        functions: 70,
        lines: 60,
        "src/lib/booking/**": {
          statements: 94,
          branches: 85,
          functions: 98,
          lines: 97,
        },
        "src/app/api/booking/**": {
          statements: 95,
          branches: 90,
          functions: 90,
          lines: 95,
        },
        "src/app/api/teams/**": {
          statements: 95,
          branches: 95,
          functions: 95,
          lines: 95,
        },
        "src/app/api/team-invitations/**": {
          statements: 95,
          branches: 95,
          functions: 95,
          lines: 95,
        },
      },
    },
  },
})
