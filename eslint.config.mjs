import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Not app code, and not ours to edit. spec/ is Beau's Obsidian vault (CLAUDE.md:
    // read it, never write to it). It carries the Obsidian Git plugin's esbuild
    // bundle, .obsidian/plugins/obsidian-git/main.js, which alone produced 108 of
    // the repo's 109 lint errors and 2,128 of its 2,134 warnings.
    "spec/**",
    // Claude Code worktrees: full checkouts of this repo nested inside it. ESLint 9
    // resolves config from the cwd, so linting the main checkout walked into each
    // one and reported every file twice. Each is linted in its own checkout.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
