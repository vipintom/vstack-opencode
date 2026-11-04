import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": "warn",
      "no-console": "off",
      "prefer-const": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "no-useless-escape": "warn",
      "no-case-declarations": "warn",
      "no-empty": "warn",
      // Downgrade strict rules to warn for CI
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/await-thenable": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/require-await": "warn",
      "@typescript-eslint/no-unnecessary-condition": "warn",
    },
  },
  {
    ignores: ["dist/", "node_modules/", "*.config.js"],
  }
);