//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

// Matches a date-segment suffix being glued onto an expression:
// `month + '-01'`, `${month}-01`, `${year}-01-01`.
const SEGMENT_SUFFIX = /^-\d{2}(-\d{2})?$/;

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid building dates by concatenating segments onto month IDs; ' +
        'a budget column can be a pay period, whose ID is not a parseable ' +
        'calendar month',
    },
    fixable: null,
    schema: [],
    messages: {
      noConcat:
        "Don't build a date by appending '{{suffix}}' to a month value: a " +
        'budget column ID can be a pay period (`2026-13`), which this turns ' +
        'into a nonsense date that fails silently. Use the helpers in ' +
        'loot-core shared/months instead — `firstDayOfMonth`/`lastDayOfMonth` ' +
        'for a calendar month, `budgetColumnDayRange` for a budget column.',
    },
  },

  createOnce(context) {
    function report(node, suffix) {
      context.report({
        node,
        messageId: 'noConcat',
        data: { suffix },
      });
    }

    return {
      BinaryExpression(node) {
        if (
          node.operator === '+' &&
          node.right.type === 'Literal' &&
          typeof node.right.value === 'string' &&
          SEGMENT_SUFFIX.test(node.right.value)
        ) {
          report(node, node.right.value);
        }
      },
      TemplateLiteral(node) {
        if (node.expressions.length === 0) {
          return;
        }
        const lastQuasi = node.quasis[node.quasis.length - 1];
        const value = lastQuasi.value.cooked;
        if (typeof value === 'string' && SEGMENT_SUFFIX.test(value)) {
          report(node, value);
        }
      },
    };
  },
};
