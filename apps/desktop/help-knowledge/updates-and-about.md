---
id: updates-and-about
title: App updates, version and logs
summary: How Windows update notifications work; where to find the app and agent versions, the debug-log toggle, and the logs folder.
tab: about
---
On Windows, Cindy checks the official release manifest and only displays a notification when a newer version is available. It does not download, install, or restart automatically; use the notification to open the official download page.

**Settings > About:**

- **App version** — the desktop app's release.
- **Claude Code version** / **Codex version** — the agent CLIs Cindy manages and downloads at runtime into your user data (they update separately from the app).
- **Update notifications** — confirms that Windows only reports official releases and never downloads or installs them automatically.
- **Debug log toggle** — turn on more verbose logging when reproducing a problem. Leave it off for normal use.
- **Open logs folder** — opens the logs directory in your OS file browser, useful when you need to attach logs to a bug report.
- **Storage** — a storage-management card for reviewing / clearing local app data.

**Notes:**

- You can dismiss the update banner for the current run and reopen it from the sidebar later.
- Installing a newer official package remains a manual choice; fully exit Cindy before running that installer.
- The Claude Code / Codex versions you see here are what Cindy's **managed agents** run as — they're independent from any Claude / Codex CLI you have installed globally on your shell.
