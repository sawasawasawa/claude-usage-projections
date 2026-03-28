# Claude Usage Projections

Browser extension that adds **projected usage** and **linear budget** bars to Claude's usage settings page (`claude.ai/settings/usage`). Works in Chrome and Firefox.

![Claude Usage Projections screenshot](assets/screenshot.png)

## What it does

For each usage meter (session and weekly), the extension injects two extra indicators:

- **Projected usage** - Extrapolates your current consumption rate to estimate where you'll land by the end of the period. Turns red with a warning when projected to exceed 100%.
- **Linear budget** - Shows how much of the time period has elapsed, so you can compare your actual usage against an even pace.

## Install

### Chrome

1. Clone this repo
2. Go to `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked** and select the cloned folder
5. Navigate to [claude.ai/settings/usage](https://claude.ai/settings/usage)

### Firefox

1. Clone this repo
2. Go to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on**
4. Select the `manifest.json` file from the cloned folder
5. Navigate to [claude.ai/settings/usage](https://claude.ai/settings/usage)

Note: temporary add-ons in Firefox are removed when the browser closes. You'll need to reload it each session.

## Bonus: Claude Code status line link

If you use Claude Code, you can add a clickable link to the usage page in your status line. Use [OSC 8 hyperlinks](https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda) to make a clickable label that opens the usage page (with the extension active) directly from your terminal.

![Status line with usage link](assets/statusline.png)

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest (Manifest V3, no special permissions) |
| `content.js` | Content script that reads progress bars and injects projection/budget UI |
| `styles.css` | Styling for projection and budget bars |

## License

MIT
