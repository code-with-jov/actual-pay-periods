// Draw one or more "step" annotations (a colored box + a circled number/letter
// badge) over elements, matching packages/docs/docs/contributing/writing-docs.md's
// annotation rules: boxes over arrows, numbered/lettered steps when addressing
// several elements, and the guide's specific RGB palette. Adapted from
// review-actual-pr's references/highlight-element.js, which draws a single red
// dashed box — this version supports multiple simultaneous, differently-colored,
// differently-labeled steps in one pass, as documentation screenshots often need.
//
// Usage, via:
//   STEPS='[{"selector":"...","label":"1","color":"red"}, ...]' \
//     playwright-cli run-code --filename=this-file.js
//
// STEPS is a JSON array. Each entry:
//   - selector (required): CSS selector for the element to box.
//   - label (optional): text/number/letter shown in the circular badge. Omit for
//     an unlabeled box.
//   - color (optional, default "blue"): one of red | yellow | purple | blue | green,
//     taken from the style guide's Annotation Colors table. Avoid using red and
//     green in the same STEPS array — the guide calls this out as a color-blindness
//     accessibility issue.
//
// Overlay nodes are tagged with data-doc-highlight so they can be wiped:
//   playwright-cli eval "document.querySelectorAll('[data-doc-highlight]').forEach(n => n.remove())"

const PALETTE = {
  red: '#FF594B',
  yellow: '#FBBA00',
  purple: '#77409A',
  blue: '#70AFFD',
  green: '#00BBA1',
};

module.exports = async page => {
  const raw = process.env.STEPS;
  if (!raw) {
    throw new Error('STEPS env var is required (JSON array, see file header)');
  }

  let steps;
  try {
    steps = JSON.parse(raw);
  } catch (err) {
    throw new Error(`STEPS is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('STEPS must be a non-empty JSON array');
  }

  const colorsUsed = new Set(steps.map(s => (s.color || 'blue').toLowerCase()));
  if (colorsUsed.has('red') && colorsUsed.has('green')) {
    throw new Error(
      'Refusing to mix red and green annotations in one screenshot — the style ' +
        'guide flags this as a color-blindness accessibility problem. Pick ' +
        'different colors for these steps.',
    );
  }

  const results = await page.evaluate(
    ({ steps, palette }) => {
      const out = [];
      steps.forEach(step => {
        const el = document.querySelector(step.selector);
        if (!el) {
          out.push({ ok: false, selector: step.selector, reason: 'not-found' });
          return;
        }

        el.scrollIntoView({
          block: 'center',
          inline: 'center',
          behavior: 'instant',
        });
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          out.push({ ok: false, selector: step.selector, reason: 'zero-size' });
          return;
        }

        const color =
          palette[(step.color || 'blue').toLowerCase()] || palette.blue;
        const PAD = 6;

        const box = document.createElement('div');
        box.setAttribute('data-doc-highlight', 'box');
        Object.assign(box.style, {
          position: 'fixed',
          left: `${rect.left - PAD}px`,
          top: `${rect.top - PAD}px`,
          width: `${rect.width + PAD * 2}px`,
          height: `${rect.height + PAD * 2}px`,
          border: `3px solid ${color}`,
          borderRadius: '6px',
          pointerEvents: 'none',
          zIndex: '2147483647',
          boxSizing: 'border-box',
        });
        document.body.appendChild(box);

        if (step.label) {
          const badge = document.createElement('div');
          badge.setAttribute('data-doc-highlight', 'badge');
          badge.textContent = String(step.label);
          const size = 22;
          Object.assign(badge.style, {
            position: 'fixed',
            left: `${rect.left - PAD - size / 2}px`,
            top: `${rect.top - PAD - size / 2}px`,
            width: `${size}px`,
            height: `${size}px`,
            lineHeight: `${size}px`,
            textAlign: 'center',
            background: color,
            color: '#fff',
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            fontSize: '12px',
            fontWeight: '700',
            borderRadius: '50%',
            pointerEvents: 'none',
            zIndex: '2147483647',
            boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
          });
          document.body.appendChild(badge);
        }

        out.push({
          ok: true,
          selector: step.selector,
          rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
        });
      });
      return out;
    },
    { steps, palette: PALETTE },
  );

  const failed = results.filter(r => !r.ok);
  if (failed.length > 0) {
    throw new Error(
      `Highlight failed for ${failed.length} step(s): ` +
        failed.map(f => `${f.selector} (${f.reason})`).join(', '),
    );
  }

  // Give the browser a frame to paint before the next screenshot fires.
  await page.waitForTimeout(50);
};
