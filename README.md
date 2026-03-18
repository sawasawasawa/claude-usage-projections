# Claude Usage Projections

Chrome extension that adds **linear budget** and **projected usage** bars to Claude's usage settings page (`claude.ai/settings/usage`).

## What it does

For each usage meter (session, daily, weekly), the extension injects two extra indicators:

- **Projected usage** - Extrapolates your current consumption rate to estimate where you'll land by the end of the period. Turns red with a warning when projected to exceed 100%.
- **Linear budget** - Shows how much of the time period has elapsed, so you can compare your actual usage against an even pace.

## Install

1. Clone or download this repo
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select this folder
5. Navigate to `claude.ai/settings/usage` - the bars appear after ~2 seconds

## Configuration

Edit the constants at the top of `content.js`:

| Constant | Default | Description |
|---|---|---|
| `SESSION_WINDOW_MS` | 5 hours | Assumed session window duration |
| `UPDATE_INTERVAL_MS` | 1 hour | How often the bars refresh |
| `INITIAL_DELAY_MS` | 2 seconds | Delay before first render (lets page load) |

After editing, click the reload button on the extension card in `chrome://extensions`.

## Files

- `manifest.json` - Extension manifest (Manifest V3, no special permissions)
- `content.js` - Content script that reads progress bars and injects projection/budget UI
- `styles.css` - Styling for the injected elements
