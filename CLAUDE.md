# UI & Design System Guidelines

## Available Skills
Invoke specific skills by name depending on the design direction:
- High-End Aesthetic: `/design-taste-frontend` and `/high-end-visual-design`
- Modern / Minimal: `/minimalist-ui` and `/stitch-design-taste`
- Brutalist / Bold: `/industrial-brutalist-ui`
- UX Rules: `/web-design-guidelines` and `/redesign-existing-projects`

## Design Reference Files
Read all `.md` files inside `.claude/design-references/` for exact design systems, color tokens, typography scales, and visual inspiration.

## Browser Verification
Use Playwright driven via Chrome (`channel: 'chrome'`) to capture visual snapshots of pages.

## Goal
Do NOT just fix code quality, console errors, or accessibility. Your primary job is visual transformation: typography hierarchy, whitespace, modern micro-interactions, elevated card design, and color harmony.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
