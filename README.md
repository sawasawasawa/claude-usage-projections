# Claude Usage Projections

Chrome extension that adds **projected usage** and **linear budget** bars to Claude's usage settings page (`claude.ai/settings/usage`).

![Claude Usage Projections screenshot](assets/screenshot.png)

## What it does

For each usage meter (session and weekly), the extension injects two extra indicators:

- **Projected usage** - Extrapolates your current consumption rate to estimate where you'll land by the end of the period. Turns red with a warning when projected to exceed 100%.
- **Linear budget** - Shows how much of the time period has elapsed, so you can compare your actual usage against an even pace.

## Install

1. Clone this repo
2. Open Chrome, go to `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked** and select the cloned folder
5. Navigate to [claude.ai/settings/usage](https://claude.ai/settings/usage)

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest (Manifest V3, no special permissions) |
| `content.js` | Content script that reads progress bars and injects projection/budget UI |
| `styles.css` | Styling for projection and budget bars |

## License

MIT
