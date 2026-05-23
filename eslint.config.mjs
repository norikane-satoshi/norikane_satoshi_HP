import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}", "tests/unit/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "IfStatement > BinaryExpression[operator='==='][left.object.object.name='process'][left.object.property.name='env'][left.property.name='NODE_ENV'][right.value='production']",
          message:
            'NODE_ENV === "production" の単一ガードは禁止。positive allowlist + VERCEL_ENV + VERCEL の三重ガードを使うこと。',
        },
        {
          selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='BOOKING_CALENDAR_ADMIN_EMAIL']",
          message:
            "BOOKING_CALENDAR_ADMIN_EMAIL の直参照は禁止。isAdmin() ヘルパー経由で参照すること。",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "**/.next/**",
    ".codex-worktrees/**",
    "**/.codex-worktrees/**",
    ".claude/**",
    ".claire/**",
    "coverage/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
