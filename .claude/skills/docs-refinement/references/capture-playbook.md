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

First-run flow, same as the one documented in `AGENTS.md` and used by the
`review-actual-pr` skill:

1. Wait for the setup screen to render.
2. Click **"Don't use a server"**.
3. Click **"View demo"**.

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
supports dark mode and may default to the OS theme. Before capturing anything:

1. Open **Settings** (via the sidebar) and find the theme control (Appearance /
   Display section).
2. Select **Light**, if it isn't already selected.

If you can't find the control via a quick `playwright-cli snapshot`, check
`packages/desktop-client/src/components/settings/` for the theme setting's component
name/testid rather than guessing at a selector.

## 4. Set the capture viewport

The style guide caps the *capture area* — what's on screen when you take the
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

## 7. Save straight to the final path

```bash
playwright-cli screenshot --filename="packages/docs/static/img/<section>/<doc-prefix>-<slug>.png"
```

Save directly to the real destination in the repo, not a scratch directory — these
screenshots are meant to be committed. Overwrite in place when replacing a stale image
so history stays clean (same filename, new content) unless the old name no longer
describes the shot, in which case delete the old file and use `git status` to confirm
it's actually gone before moving on.

## Tooling assumptions

- `playwright-cli` is on PATH (typically via the `playwright-cli` skill in this
  environment). If it isn't, fall back to `npx --no-install playwright-cli`; if that
  also fails, stop and surface it rather than guessing at another tool.
- The dev server must be reachable at the URL you navigate to — confirm with a plain
  `curl -sS -o /dev/null -w '%{http_code}' http://localhost:3001` before spending time
  debugging `playwright-cli` if navigation seems to hang.
