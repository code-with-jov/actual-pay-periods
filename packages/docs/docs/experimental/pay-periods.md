# Pay Periods

<ExperimentalFeatureWarning />

## What Pay Periods Are

Actual normally gives you one budget column per calendar month. **Pay periods** replace those columns with columns that follow your own pay schedule, so a column covers the stretch of time between one payday and the next.

This helps if the calendar month isn't the rhythm your money actually moves in. Some examples:

- You are paid every two weeks, so some months contain three paychecks and others contain two. Budgeting a single monthly amount hides that difference.
- You are paid weekly and would rather decide what each paycheck has to cover than plan a whole month at once.
- Your rent, loan payments or other big bills are due right after a payday, and you want each paycheck's column to show what is left once those bills are covered.

Everything else in Actual works the way it always has. Transactions, accounts, categories, rules and schedules are unchanged — the only thing that changes is what a budget column represents. Instead of _January_, a column might be _Jan 5 - Jan 18_.

If your pay lines up reasonably well with calendar months already, you probably don't need this feature.

## Turning On Pay Periods

Pay periods are an experimental feature, so there are two steps: switch on the feature flag, then configure it.

1. In the sidebar, click **Settings**, then **Show advanced settings**, then open **Experimental features**.
2. Click **I understand the risks, show experimental features** if you haven't already agreed to the disclaimer. See [Experimental Features](../experimental/index.md) for more about how these features work.
3. Tick **Pay periods**.
4. Go back to the main **Settings** page. There is now a **Pay periods** section.
5. Choose your **Pay frequency**: **Weekly**, **Every 2 weeks** or **Monthly**.
6. In **Date of a payday**, enter the date of any one of your paydays. It does not have to be the first one, or a recent one — one real payday is enough.
7. Go to the **Budget** page and click the pay period icon next to the month picker to turn on **Budget by pay period**.

![The Pay periods checkbox ticked in Experimental features](/img/experimental/pay-periods/pay-periods-enable-experimental.png)

![The Pay periods section on the Settings page, with a frequency and payday filled in](/img/experimental/pay-periods/pay-periods-settings.png)

![The pay period toggle in the budget page's month picker](/img/experimental/pay-periods/pay-periods-budget-toggle.png)

If you haven't finished steps 5 and 6 yet, the toggle still works — Actual fills in a monthly cadence starting today instead of blocking you, and you can refine the pay frequency and payday date on the Settings page afterward.

Once it's on, Actual rebuilds your budget columns and the budget page starts showing pay periods instead of months, with the compact month picker now showing period labels like **J1** and **F1**.

![The budget page after turning pay periods on, showing period columns and the compact period labels](/img/experimental/pay-periods/pay-periods-budget-columns.png)

Click the same icon again to go back to calendar months.

## How Your Choices Shape the Columns

The pay frequency decides how long a column is, and the payday date decides where the columns fall.

- **Weekly** gives you a new column every 7 days, and **Every 2 weeks** gives you a new column every 14 days, counted out from the payday date you entered. If you tell Actual about a payday on a Friday, every period will begin on a Friday.
- **Monthly** gives you one column per calendar month, but starting on the day of the month you entered rather than on the 1st. If your payday is on the 25th, your columns run from the 25th to the 24th. For a day that some months don't have, Actual uses the last day of the shorter month instead — a payday on the 31st means the February column starts on the 28th, or the 29th in a leap year.

Columns always sit right next to each other with no gaps and no overlaps, so every day belongs to exactly one column.

Each column is labeled with its date range, so the first period of the year appears as something like _Jan 5 - Jan 18_ and the second as _Jan 19 - Feb 1_. The compact month picker above the desktop budget shortens each period to a letter and a number — _J1_ for the first period starting in January, _F1_ for the first starting in February — and a few places, like the column's menu, add the period's position in the year as _(PP1)_, _(PP2)_ and so on.

### How Periods Are Numbered

Periods are numbered within each calendar year. The first period of a year is the first one that _begins_ in January of that year, and numbering carries on from there — so the count restarts at 1 every January, no matter which payday date you entered.

Because a period doesn't have to stop at the end of the year, a period that begins in late December can run on into the first days of January. Those January days belong to that December period, which is the last period of the old year rather than the first period of the new one.

:::note
Changing the payday date to a different date shifts where your columns fall, even if you keep the same pay frequency. Pick a date that reflects your real pay schedule and then leave it alone. See the limitations below for what happens to amounts you have already budgeted.
:::

## Known Limitations

Pay periods are still under development, and there are some rough edges worth knowing about before you switch your budget over.

### Pay Period and Calendar Month Budgets Are Kept Separately

Amounts you budget while **Budget by pay period** is on are not visible when you switch back to calendar months, and amounts you budgeted in calendar months are not visible while you are budgeting by pay period. There is no conversion between the two.

Nothing is deleted when you switch. Each mode simply keeps its own set of budget columns, so whatever you budgeted in the other mode is waiting for you if you switch back. But you can't budget in one mode and read the results in the other, and switching back and forth means maintaining two budgets.

Your transactions and account balances are shared between both modes. Category balances are not: a category's balance is worked out per column from what you budgeted and spent there, and since the budgeted amounts are separate in each mode, the balances are too.

### Changing the Cadence Rebuilds Your Columns

If you change the pay frequency or the payday date while pay periods are on, Actual rebuilds your budget columns to match the new schedule. The stored amounts keep their period numbers, but those numbers now describe different date ranges — the amount you put into "the two weeks starting January 6" reappears in "the week starting January 1", and amounts in periods past the new schedule's count (a weekly year has more periods than a monthly one) stop being shown at all. Check your budget after a cadence change and expect to budget again.

:::caution
Settle on your pay frequency and payday date before you spend time budgeting. Changing them later means redoing that work.
:::

### Budget-Based Reports Are Not Available

While you are budgeting by pay period, reports that read budgeted amounts can't be drawn. That means:

- The [Budget Analysis](../experimental/budget-analysis-report.md) card has no data to show.
- A [custom report](../reports/custom-reports.md) using the **Budgeted** balance type has no data to show, on the full report page and on a saved dashboard card alike.
- The Spending report's **Budgeted** comparison is unavailable; its **Single month** and **Average** comparisons work normally.
- The Sankey report's **Budgeted** view falls back to **Spent** while pay periods are on.

Reports built from your transactions — spending, net worth, cash flow, income vs expenses and the rest — are unaffected and keep working normally.

### Monthly Schedule Templates Fund the Bill in One Period

If you use a [goal template](../experimental/goal-templates.md) based on a schedule, and that schedule repeats monthly, the whole amount is budgeted in the single pay period that the bill actually falls in. The earlier periods of that month set nothing aside for it.

So a $1,200 rent payment due on the 1st is funded in full in the period containing the 1st, rather than being spread across the two or three periods that make up the month. If you would rather build the money up over several paychecks, budget for it manually instead of relying on the template.

### Goal Templates Still Speak in Calendar Months

Templates keep their calendar wording whatever your pay cycle is. A goal is written as "by August", "every 2 months" or "$50 a week", and the target month picker offers calendar months only — there's no way to aim a goal at a specific pay period.

The one deliberate exception is a plain fixed amount. `#template 50` budgets $50 into **every** budget column, so with pay periods on it behaves as _$50 per paycheck_ — about $108 a month on a two-week cycle — not $50 a month. If you want the same monthly total after switching, divide your fixed templates by the number of paychecks in a month.

Everything that describes a _window of time_ is converted into pay periods for you:

- **Save by a month.** A goal due by August is funded across every period between now and the end of August, so each paycheck sets aside a smaller amount than a monthly budget would.
- **Repeating amounts.** "$25 every week" budgets the occurrences that fall inside each period — usually one — rather than the whole month's worth in every period.
- **Spending limits.** An `up to` limit is a cap on a stretch of time, so it is scaled to the column: a daily limit counts the column's days, a weekly limit counts its weeks, and a monthly limit is reduced to the column's share of a month — `up to 600` caps a two-week column at roughly $276, keeping the monthly total honest. Note the contrast with fixed amounts above: a cap is a monthly total, a fixed template is an amount per paycheck.

### Switching Modes Takes a Moment

Turning **Budget by pay period** on or off from the budget page rebuilds every budget column, which can take a few seconds on a large budget. The toggle is disabled until the rebuild finishes — let it complete rather than reloading the page. Changing the pay frequency or payday date on the Settings page rebuilds your columns the same way, and shows a **Rebuilding your budget…** message while it works.

## Pay Periods and the API

This section only matters if you use the [`@actual-app/api` package](../api/index.md) or scripts built on it. If you don't, you can stop reading here.

Pay periods share the same identifier format as calendar months, `YYYY-MM`, but they continue past month 12 — the first pay period of 2026 is `2026-13`, the second is `2026-14`, and so on.

While pay periods are on, this changes what the budget methods expect and return:

- [`getBudgetMonths()`](../api/reference.md#getbudgetmonths) returns pay period identifiers such as `2026-13`, not calendar months such as `2026-01`.
- [`getBudgetMonth()`](../api/reference.md#getbudgetmonth) and the other budget methods only accept those same pay period identifiers. Passing a calendar month raises an error, because no budget column exists for it. (The one exception is a running import, which skips this check.)

The fix is the same in every case: have your script use the values that `getBudgetMonths()` gives back, rather than building month strings itself.

```js
// Works whether or not the budget uses pay periods
const months = await api.getBudgetMonths();
const latest = months[months.length - 1];
const budget = await api.getBudgetMonth(latest);

// Breaks when the budget uses pay periods
const badBudget = await api.getBudgetMonth('2026-01');
```

If a script has to work with real dates, read the identifiers from `getBudgetMonths()` and pick the one you need, instead of formatting a date into `YYYY-MM` yourself.
