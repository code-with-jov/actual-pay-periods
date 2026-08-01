//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

import { runClassic } from 'eslint-vitest-rule-tester';

import plugin from '../../index';
const rule = plugin.rules['no-month-date-concat'];

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

void runClassic(
  'no-month-date-concat',
  rule,
  {
    valid: [
      // The sanctioned helpers
      `const day = monthUtils.firstDayOfMonth(month);`,
      `const range = monthUtils.budgetColumnDayRange(month);`,

      // String concatenation that isn't a date segment
      `const label = name + '-suffix';`,
      `const id = base + '-1';`,
      `const id = base + '-123';`,

      // Template literals without a trailing date segment
      `const label = \`\${month} overview\`;`,
      `const key = \`\${sheetName}!\${cellName}\`;`,

      // No expression involved — a plain literal is someone writing a date
      'const day = `2026-01-01`;',
    ],

    invalid: [
      {
        code: `const day = month + '-01';`,
        output: null,
        errors: [{ messageId: 'noConcat' }],
      },
      {
        code: `const day = year + '-01-01';`,
        output: null,
        errors: [{ messageId: 'noConcat' }],
      },
      {
        code: `const parsed = d.parseISO(endMonth + '-01');`,
        output: null,
        errors: [{ messageId: 'noConcat' }],
      },
      {
        code: `const day = \`\${template.month}-01\`;`,
        output: null,
        errors: [{ messageId: 'noConcat' }],
      },
      {
        code: `const day = \`\${year}-12-31\`;`,
        output: null,
        errors: [{ messageId: 'noConcat' }],
      },
    ],
  },
  {
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
);
