---
id: providers
title: Model providers and Cartethyia AI
summary: Cartethyia AI is auto-provisioned after sign-in for pay-per-token model access; manage it (and custom providers) in Settings > Model Providers.
tab: providers
---
Claude Code, Codex, and lightweight utility models can use **Cartethyia AI** for pay-per-token model access. Voice input is included for signed-in Cartethyia users and uses the separate voice service; it does not require or receive a Cartethyia AI key.

**Cartethyia AI:**

- Open **Settings > Model Providers** (the tab is labeled "Providers"). Cartethyia AI is pinned at the top.
- You don't paste a key — it's **provisioned automatically after you sign in**. The page fetches its credentials for you ("Fetching credentials…" while it does).
- Controls: **Refresh credentials**, **Rotate key**, and **Disconnect** (which clears the Cartethyia AI key saved locally). Because it's tied to your account, it's available on each device you sign into.

**Status badges:**

- **Connected** — this device has usable Cartethyia AI credentials.
- If it's still fetching or disconnected, use Refresh credentials / sign in.

**Custom providers:**

- You can also add your own provider (a base URL + key) — that's the flow with a paste-a-key dialog. Cartethyia AI itself never uses that dialog.

**Notes:**

- Direct service keys such as Brave Search and Tavily are **not** managed here — they live on the matching plugin detail pages under Plugins (Cindy Web Search).
- Rotating or replacing credentials takes effect for new turns; in-flight requests finish on the previous key.
