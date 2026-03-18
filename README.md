# Claude Usage Projections

Chrome extension that adds **linear budget**, **projected usage**, and **API cost estimates** to Claude's usage settings page (`claude.ai/settings/usage`).

## What it does

For each usage meter (session, daily, weekly), the extension injects extra indicators:

- **Projected usage** - Extrapolates your current consumption rate to estimate where you'll land by the end of the period. Turns red with a warning when projected to exceed 100%.
- **Linear budget** - Shows how much of the time period has elapsed, so you can compare your actual usage against an even pace.
- **API cost estimate** - Shows what your usage would cost if you were paying via the Claude API instead of a subscription. Includes per-model comparison chips (Opus/Sonnet/Haiku) so you can see costs across different models.
- **Monthly summary** - Compares your estimated monthly API cost against your plan price and shows whether your subscription is saving you money.

## Install

1. Clone or download this repo
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select this folder
5. Navigate to `claude.ai/settings/usage` - the bars appear after ~2 seconds

## Configuration

### Settings panel (on page)

The extension adds a settings panel at the top of the usage page:

- **Plan tier** - Select your subscription (Pro, Max 5x, Max 20x) to get accurate token budget estimates
- **I/O ratio** - Adjust the assumed input/output token ratio to match your usage pattern:
  - 80/20: Heavy on prompts (long system prompts, pasted documents)
  - 60/40: Typical chat usage (default)
  - 50/50: Balanced
  - 30/70: Generating long outputs (code, articles)

Settings persist across page reloads via localStorage.

### Constants in content.js

| Constant | Default | Description |
|---|---|---|
| `SESSION_WINDOW_MS` | 5 hours | Assumed session window duration |
| `UPDATE_INTERVAL_MS` | 1 hour | How often the bars refresh |
| `INITIAL_DELAY_MS` | 2 seconds | Delay before first render (lets page load) |

After editing constants, click the reload button on the extension card in `chrome://extensions`.

## How cost estimation works

The extension estimates API cost using:

1. **Community-estimated token budgets** per plan tier and model (these are approximations, not official numbers)
2. **Current API pricing** per million tokens (Opus: $5/$25, Sonnet: $3/$15, Haiku: $1/$5 for input/output)
3. **Your usage percentage** from the progress bars on the page

The formula: `estimated_tokens = tier_token_budget * usage_pct / 100`, then `cost = tokens * blended_price_per_token`

The blended price uses your selected I/O ratio to weight input vs output pricing.

**Important:** These are rough estimates. Actual token quotas are dynamic and depend on message length, system load, and Anthropic's allocation. The comparison is directional, not precise.

## Files

- `manifest.json` - Extension manifest (Manifest V3, no special permissions)
- `content.js` - Content script that reads progress bars and injects all UI
- `styles.css` - Styling for projections, budget bars, cost estimates, and settings
