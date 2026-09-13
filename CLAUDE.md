# Project Design & Development Guidelines

## Installed Skills & Tools
- Use the `/taste-skill` skill when refactoring or judging UI aesthetics.
- Use the `/web-design-guidelines` skill to audit layout, accessibility, and UX rules.
- Use `playwright-cli` to take screenshots of the website and visually verify changes.

## Design References
Before making UI edits, read the design pattern guidelines located in `.claude/design-references/` to match top-tier design aesthetics (typography, spacing, color choices, micro-interactions).

## Workflow for UI Redesigns
1. Read the relevant design guidelines in `.claude/design-references/`.
2. Apply design improvements to the codebase using `/web-design-guidelines` and `/taste-skill`.
3. Test locally and take a screenshot using `npx playwright-cli screenshot` (or your local dev URL) to visually inspect the final result.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
