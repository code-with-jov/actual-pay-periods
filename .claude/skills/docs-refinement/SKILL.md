---
name: docs-refinement
description: Refine an existing Actual Budget documentation page by walking the real app with playwright-cli and adding the screenshots and small clarifying sentences it's missing. Use whenever the user asks to "add screenshots to the docs", "refine the docs for X", "the accounts doc needs images", "walk through the app and update this doc page", "this doc is missing pictures", or points at a specific page/section under packages/docs/docs/ and asks for it to be brought up to date visually. Also trigger when a user says a doc page "doesn't match the app anymore" or "needs more visuals" — this skill plans the exact screenshots needed, captures them live from the running app, and wires them into the page with the minimum edit needed, without rewriting or restructuring the surrounding prose.
allowed-tools: Bash(yarn:*) Bash(playwright-cli:*) Bash(npx:*) Bash(mkdir:*) Bash(ls:*) Bash(git:*) Bash(cat:*) Bash(mv:*) Bash(curl:*) Read Edit Write Glob Grep
---

# Refine Actual Budget Documentation with Screenshots

This skill takes a documentation page that's light on screenshots or has drifted from
the current UI, and brings it up to date: it plans exactly which screenshots the page
needs, captures them from the real running app with `playwright-cli`, and wires them
into the markdown with the smallest edit that closes the gap. It does **not** rewrite,
restructure, or retitle pages — a docs refinement is a patch, not a rewrite.

## Why this skill exists

Docs pages accumulate screenshot debt: a page written before a UI change now shows a
stale dialog, or a page was always mostly prose because nobody wanted to hand-capture
and hand-annotate five screenshots. Both problems have the same fix — actually open the
app, follow the steps the doc describes, and capture what's there. Doing that by hand is
tedious enough that it doesn't happen; this skill makes it a repeatable pass.

## Scope: minimal, targeted changes only

This is a refinement, not a docs rewrite:

- Add a screenshot where the prose describes a UI step and none exists.
- Replace a screenshot that's stale (doesn't match the current UI it's meant to depict).
- Add the one or two sentences a new screenshot needs to make sense in context.
- Fix a genuine gap — the UI has an option or step the doc doesn't mention, or the doc
  mentions something the UI no longer has — but only touch the sentence(s) at issue.

Don't reorganize headings, rewrite paragraphs that are already correct, change the
page's tone, or expand scope to sibling pages the user didn't ask about. If you notice
a bigger structural problem while working, name it in the final report instead of
fixing it — that's a separate, deliberate task.

## Workflow

### 1. Resolve the target page(s)

The user will point at a doc by topic, filename, or URL path (e.g. "the categories
doc", `packages/docs/docs/budgeting/categories.md`,
`actualbudget.org/docs/budgeting/categories`). Resolve it to the actual file(s) under
`packages/docs/docs/`. If the ask is a whole section (e.g. "the budgeting docs"), list
every page in that folder and confirm the list with the user before doing a full pass —
this skill is meant for one to a handful of pages per run, not a repo-wide sweep.

### 2. Read the style guide

Read `packages/docs/docs/contributing/writing-docs.md` in full — the same authoritative
source the `writing-actual-docs` skill points to. Don't restate it here; the important
parts for this skill are:

- **Image placement**: `/static/img/<section>/<doc-prefix>-...png`, where `<section>`
  mirrors the doc's folder under `packages/docs/docs/` and `<doc-prefix>` matches the
  doc's filename (e.g. `docs/budgeting/categories.md` → images in
  `static/img/budgeting/`, named `categories-....png`).
- **Format**: PNG only, light mode only, capture area at most 1100×700px (that's the
  size of what's on screen when you capture, not the final rendered size).
- **Annotation**: boxes, not arrows; numbered/lettered "steps" when addressing several
  elements; use the RGB palette from the guide's Annotation Colors table; never pair
  red and green in the same image; alt text is required on every image.

If any doc-writing question comes up outside of screenshots (front matter, headings,
tone), defer to the `writing-actual-docs` skill rather than improvising — it owns that
guidance.

### 3. Plan the screenshots

Read the target doc's full prose and build a short plan before touching the browser.
For each numbered step or described UI state in the doc, note:

- **Has image, still accurate** → leave alone.
- **Has image, looks stale** → note what changed (new field, moved button, renamed
  label) and plan a replacement.
- **No image, prose describes a concrete UI state** → plan a new screenshot.
- **Prose describes UI that doesn't seem to exist anymore, or the running app has a
  step/option the prose never mentions** → this is a content gap, not just a screenshot
  gap; note the smallest sentence-level fix.

Not every paragraph needs a picture — a screenshot earns its place when it shows the
reader something words alone leave ambiguous (an unfamiliar icon, a specific field
layout, a multi-part dialog). Purely conceptual paragraphs stay text-only. Write the
plan as a short list: `<anchor point in doc> → <what to capture> → <why>`. This list is
what you'll walk through in the browser and what grounds the "what I chose not to
touch" section of the final report.

### 4. Get the app running

Follow `references/capture-playbook.md` for the full sequence: starting the app
locally (`yarn start` on port 3001, with the Cursor Cloud/constrained-environment
fallback noted there), reaching the standard demo budget, and forcing light mode before
capturing anything. Do this once per session, not once per screenshot.

### 5. Capture each planned screenshot

For each item in the plan, also detailed in `references/capture-playbook.md`:

1. Navigate/click through the exact steps the doc's prose describes — if the doc's
   steps don't match what you find in the app, that's itself a content gap to note.
2. Set the capture viewport within the ≤1100×700 budget.
3. Apply annotation only if the screenshot needs to direct attention to one part of a
   larger view, or address several elements at once — use
   `references/annotate-screenshot.js` (an Actual-docs-styled adaptation of the
   highlighting approach in the `review-actual-pr` skill, using the guide's step/box
   conventions and color palette instead of a single red outline).
4. Screenshot straight to the final destination path —
   `packages/docs/static/img/<section>/<doc-prefix>-<descriptive-slug>.png` — not a
   scratch directory. These are real files that get committed.
5. Write down a one-sentence alt text for the image while the context is fresh; you'll
   need it in the next step.

### 6. Wire each screenshot into the markdown

For each captured image, make the smallest edit that places it correctly:

```markdown
![<alt text>](/img/<section>/<doc-prefix>-<slug>.png)
```

Insert it right after the paragraph/step it illustrates — match the placement pattern
already used elsewhere in the same doc if one exists. If a step had no prose at all
describing what's now shown (rare — most gaps are missing pictures, not missing text),
add the shortest sentence that makes the image make sense; don't pad it into a new
paragraph. If you're replacing a stale image, keep the same alt-text style as the
original unless the image's content genuinely changed.

Leave every other line of the document untouched.

### 7. Sanity-check before reporting

- Confirm every new/changed image reference resolves to a file you actually saved at
  that path (`ls packages/docs/static/img/<section>/`).
- Re-read the edited paragraphs once for grammar and tone consistency with the rest of
  the page — nothing more invasive than that.
- If you're unsure whether a term you introduced would trip the `typos` spell-checker,
  check it against `.github/actions/docs-spelling/typos.toml` per the style guide.

### 8. Report back

Summarize in three short groups, so the user can sanity-check scope at a glance:

- **Added/replaced** — one line per image: doc location, filename, what it shows.
- **Content gaps closed** — one line per sentence-level fix, quoting old → new if it's
  short enough to be legible inline.
- **Considered, left alone** — anything from the plan in step 3 that turned out not to
  need a change, with the one-line reason (e.g. "step 3 is purely conceptual, no UI to
  show" or "existing image still matches the current UI").

Don't commit or push unless the user asks — this skill's job ends at a clean working
tree the user can review, consistent with how documentation changes in this repo are
normally staged for review (see the `committing-actual-changes` skill for the actual
commit/PR mechanics when the user is ready for that step).

## Reference files

- `references/capture-playbook.md` — step-by-step: getting the app running locally,
  reaching the demo budget, forcing light mode, setting the capture viewport, and the
  concrete `playwright-cli` commands for navigation and screenshotting.
- `references/annotate-screenshot.js` — overlay script for numbered/lettered "step"
  annotations and colored boxes, matching the doc style guide's annotation rules
  (invoke via `playwright-cli run-code`, same mechanism as `review-actual-pr`'s
  `highlight-element.js` but built for the docs guide's conventions instead of a single
  red callout box).
