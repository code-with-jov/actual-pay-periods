# Capture Playbook

Step-by-step for getting the app running and taking documentation-quality screenshots
with `playwright-cli`. Read `SKILL.md` first for when to use each step.

## 1. Start the app

From the repo root:

```bash
yarn start
```

This builds the plugins-service worker and loot-core browser backend, then starts the
Vite dev server on **port 3001**. Wait for it to report ready before pointing
`playwright-cli` at it.

**Constrained-environment fallback.** The Vite dev server serves many unbundled
modules; in resource-constrained environments the browser can hit
`ERR_INSUFFICIENT_RESOURCES`. If that happens:

```bash
yarn build:browser
```

then serve `packages/desktop-client/build/` yourself with
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` response headers (both are required — the
app won't initialize its SQLite worker without them). Point `playwright-cli` at
whatever local server you use to serve that directory instead of port 3001.

## 2. Reach the demo budget

```bash
playwright-cli navigate --url="http://localhost:3001"
```

The first-run screen offers more than one path in; the one that's actually proven —
because it's what `packages/desktop-client/e2e/page-models/configuration-page.ts`
(`createTestFile()`) uses for every e2e test that needs a populated budget, including
the pay-periods suite — is a single click:

1. Wait for the setup screen to render.
2. Click **"Try the demo"**.

Trust that button name over guessing from `AGENTS.md`'s general description of the
flow; the e2e page models are the ground truth for exact button text because CI
depends on them being right.

This loads a budget pre-populated with realistic accounts, transactions, categories,
and budgeted amounts — far more useful for screenshots than an empty budget, and it
means the numbers in your screenshots look like something a real user would have.

If a budget is already loaded (state carried over from a previous run), use it as-is.
To force a fresh state:

```bash
playwright-cli localstorage-clear
playwright-cli reload
```

## 3. Force light mode

The docs style guide requires light-mode screenshots only, even though the app
supports dark mode and may default to the OS theme (the theme setting itself defaults
to `auto`, i.e. "follow the browser's `prefers-color-scheme`"). The reliable way to get
light mode is to set the browser's color scheme before the page ever loads, rather than
clicking through the Theme setting in the UI:

- If your `playwright-cli` build exposes a color-scheme / emulate-media flag, use it.
- If you're driving Playwright directly (see the fallback in "Tooling assumptions"
  below), pass `colorScheme: 'light'` to `browser.newContext(...)` — this makes `auto`
  resolve to light without touching any Settings UI at all.

Only fall back to clicking the Theme dropdown in **Settings** if neither of those is
available to you.

## 4. Set the capture viewport

The style guide caps the _capture area_ — what's on screen when you take the
screenshot — at roughly 1100×700px, not the final saved image size. Resize the browser
window/viewport to something in that range before screenshotting rather than capturing
full-screen and cropping after the fact; a resized capture keeps UI proportions
consistent with the rest of the docs' existing screenshots.

Check `playwright-cli --help` (or `playwright-cli resize --help`) for the exact
resize/viewport command available in your build — the flag name has varied across
`playwright-cli` versions. Apply it once per distinct screenshot size you need, not
per-screenshot, to avoid needless reflows between shots of the same view.

## 5. Navigate to each planned shot

Walk the exact steps the doc's prose describes — same clicks, same order — using
`playwright-cli click`, `playwright-cli fill`, `playwright-cli navigate`, etc. If a
`snapshot` shows the flow has changed from what the doc says (a renamed button, an
extra confirmation step, a moved menu), that's a content gap: note it for the "content
gaps closed" section rather than silently adapting your walkthrough to match reality
without also fixing the doc.

## 6. Annotate (only when needed)

Skip this step entirely for a clean, single-focus screenshot — most documentation
images don't need an overlay. Reach for `references/annotate-screenshot.js` when either
is true:

- The screenshot is a wider view and only one part of it needs the reader's attention
  (a single box, unlabeled or labeled).
- The screenshot has to address more than one element at once — use numbered or
  lettered "steps" per the guide, not several near-duplicate screenshots.

```bash
SKILL_DIR="$(git rev-parse --show-toplevel)/.claude/skills/docs-refinement"

STEPS='[{"selector":"[data-testid=\"category-name\"]","label":"1","color":"red"},{"selector":"[data-testid=\"category-budgeted\"]","label":"2","color":"blue"}]' \
  playwright-cli run-code --filename="$SKILL_DIR/references/annotate-screenshot.js"
```

See the header comment in `annotate-screenshot.js` for the exact `STEPS` JSON shape and
the available color names (drawn from the style guide's palette). Remove the overlay
before the next unrelated screenshot:

```bash
playwright-cli eval "document.querySelectorAll('[data-doc-highlight]').forEach(n => n.remove())"
```

## 7. Crop to match the docs' existing convention

Look at a couple of the screenshots already sitting next to your target doc before
deciding how much of the window to capture — e.g.
`packages/docs/static/img/experimental/setting.webp` or
`packages/docs/static/img/categories/CategoryGroupRename.webp`. Across this repo's docs
that convention is a **tight crop of just the relevant card or table**, not a full
window with the sidebar and app chrome around it. A full-viewport screenshot with the
sidebar, account balances, and "No server" status bar in frame reads as noticeably off
next to the rest of the site.

Two crop shapes cover most cases:

- **A settings card** (the bordered, background-filled sections on the Settings page):
  there's no stable `data-testid` on these, so locate the card by walking up from a
  control you already have a locator for (a checkbox, a `Select`, an `Input`) until you
  hit an ancestor with its own border and background and a width over ~300px — that's
  the card, not the control itself (the control's own border/background will match
  first if you don't skip past it). Clip the screenshot to that element's bounding box
  plus a few px of padding.
- **Main content on a page with the sidebar** (e.g. the budget page): clip everything
  left of the sidebar's width — `packages/desktop-client/src/components/sidebar/Sidebar.tsx`
  defaults it to 240px (`DEFAULT_SIDEBAR_WIDTH`) — rather than trying to hide the
  sidebar itself.

If `playwright-cli screenshot` in your build doesn't take a clip/region flag, take a
full screenshot and crop it afterward with any image tool on PATH (`sips`, `convert`,
etc.) rather than shipping the untrimmed version.

## 8. Save straight to the final path

```bash
playwright-cli screenshot --filename="packages/docs/static/img/<section>/<doc-prefix>-<slug>.png"
```

Save directly to the real destination in the repo, not a scratch directory — these
screenshots are meant to be committed. Overwrite in place when replacing a stale image
so history stays clean (same filename, new content) unless the old name no longer
describes the shot, in which case delete the old file and use `git status` to confirm
it's actually gone before moving on.

## Wiring screenshots into a numbered list

If the steps you're illustrating are a numbered list, don't interleave images between
list items unless you've confirmed elsewhere in this repo's docs that a numbered list
survives being interrupted by a non-list paragraph and still renders as one continuous,
correctly-numbered list in this Docusaurus setup. This repo's existing docs consistently
place the whole numbered list first and then the relevant screenshot(s) right after it
ends (see `packages/docs/docs/experimental/monte-carlo-analysis.md` and
`formulas.md`) — follow that pattern rather than risking a list that silently renumbers
or splits. If you want to verify a different structure is safe, run
`yarn workspace docs build` and check the generated HTML under
`packages/docs/build/docs/.../index.html` for a single `<ol>` with all your `<li>`s in
it before trusting it.

## Tooling assumptions

- `playwright-cli` is on PATH (typically via the `playwright-cli` skill in this
  environment). If it isn't, fall back to `npx --no-install playwright-cli`.
- **If neither is available** (no `playwright-cli` anywhere, as in some remote/CI
  containers): drive Playwright directly instead of giving up. Chromium and the
  `playwright`/`@playwright/test` library are commonly pre-installed in these
  environments even when the CLI wrapper isn't — check for a browser at a path like
  `/opt/pw-browsers/chromium` and a resolvable `@playwright/test` in the target repo's
  `node_modules` (Actual's own e2e suite already depends on it, so `yarn install` is
  usually enough). A short Node script using `chromium.launch({ executablePath, headless: true })`
  and `browser.newContext({ viewport, colorScheme: 'light' })` covers navigation,
  clicking, filling, and `page.screenshot({ clip })` — everything this playbook
  describes as `playwright-cli` commands maps directly to Playwright API calls.
  - Set `userAgent: 'playwright'` on the context. Actual's own
    `packages/loot-core/src/shared/platform.ts` (`isPlaywright`) checks for that exact
    substring and, when it matches, suppresses the "Welcome to Actual!" tour-offer
    notification that otherwise sits in the corner of your first screenshots —
    `packages/desktop-client/playwright.config.ts` sets the same value for the same
    reason.
  - Reuse the same locators the e2e suite uses (`getByRole`, `getByTestId`,
    `page.locator('#some-id')`) — `packages/desktop-client/e2e/page-models/` and any
    feature-specific helpers (e.g. `pay-period-helpers.ts`) are the fastest way to find
    a working selector instead of guessing from the rendered DOM.
- The dev server must be reachable at the URL you navigate to — confirm with a plain
  `curl -sS -o /dev/null -w '%{http_code}' http://localhost:3001` before spending time
  debugging navigation issues.
- If `yarn start`'s output is being piped into another command (e.g. `| tail`), redirect
  it to a file instead (`yarn start > server.log 2>&1 &`) and poll the file. `yarn start`
  never exits, so a pipe like `tail -200` will buffer forever waiting for EOF and you'll
  see no output at all, even though the server is up.
