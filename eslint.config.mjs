import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import i18nPlugin from "@spaced-out/eslint-plugin-i18n";

export default tseslint.config(
  { ignores: [".webpack/", "out/", "dist/", "node_modules/", "*.js"] },

  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // Global rule tuning
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_|^React$",
        ignoreRestSiblings: true,
      }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-undef": "off",
      "no-redeclare": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-empty-function": "off",
    },
  },

  // React hooks — tsx files only
  {
    files: ["src/**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // i18n rules — tsx files only
  {
    files: ["src/**/*.tsx"],
    plugins: { "@spaced-out/i18n": i18nPlugin },
    rules: {
      "@spaced-out/i18n/no-static-labels": "error",
      "@spaced-out/i18n/no-react-i18next-import": "off",
      "@spaced-out/i18n/missing-translation": "off",
      "@spaced-out/i18n/invalid-translation-key-format": "off", // disabled: plugin enforces fallback-derived casing, but we use lowercase snake_case keys
      "@spaced-out/i18n/no-dynamic-labels": "off",
      "@spaced-out/i18n/i18n-enforce-makeKey-wrapper": "off",
    },
  },

  // Main process — allow require()
  {
    files: ["src/main.ts", "src/preload.ts", "src/main/**/*.ts", "src/core/**/*.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // Test files — relax any warnings
  {
    files: ["src/**/*.test.ts", "src/__tests__/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
