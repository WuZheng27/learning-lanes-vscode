# Changelog

## 0.8.1

- Show cached root choices immediately and progressively fill the picker; cancel unused discovery work.
- Discover related threads from parent metadata before reading full histories, retaining a legacy prefix fallback.
- Reuse bounded cross-root snapshot caches, limit read concurrency, and discard stale background sync results.
- Aggregate lane activity in one pass, share background columns, and preserve table DOM on selection/status updates.
- Cache unchanged layouts and avoid unrelated-thread comparisons during legacy parent inference.
- Wait for App Server initialization before concurrent requests; allow slower cold startup up to 60 seconds.
- Add discovery, cancellation, controller race/cache, and Webview DOM regression tests.

## 0.8.0 - 2026-08-18

- Added optional per-node display labels while preserving the original Codex question in snapshots.
- Added one-click Learning Lanes entry points in the status bar, editor title, and Explorer title.
- Persisted labels across branch syncs with subtree deletion and in-window undo/redo support.

## 0.7.0-alpha - 2026-08-18

- Added a compact lane table that maps one user question to one learning depth.
- Synced branches created manually in the official Codex sidebar.
- Added exact interior-turn navigation through disposable temporary forks.
- Added safe Markdown, GFM, and MathML snapshots in a confirmation dialog.
- Added compact sizing, wrapping, font controls, keyboard navigation, and activity cues.
- Added subtree deletion, collapse, in-window undo/redo, and persistent frozen branches.
- Added Windows and Remote SSH support for Linux x86_64 and ARM64 extension hosts.

This is an experimental release. Official Codex extension updates can require compatibility
changes to sidebar navigation or bundled App Server discovery.
