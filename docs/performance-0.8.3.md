# Local performance trial, 0.8.3

The root picker requests 25 records on its first page and 200 on subsequent pages. Family discovery keeps bulk pages, because a complete scan with only 25 records per page was slower. Every page is still consumed; list nulls still require parent verification, unlisted ancestors are still followed, and unknown ancestry still retains prefix-fallback candidates. Verified cached choices remain visible during refresh. Repeated cursors and the scan safety limit now fail explicitly instead of returning an incomplete result as a complete tree.

Selecting a root resolves its ancestry before opening the official sidebar. Full history discovery and lane synchronization then proceed in the same guarded operation, with the existing generation checks preventing stale results from overwriting a different root.

The panel sends a full state whenever its table version changes. Selection, preview, and status updates carry document metadata without the unchanged nodes, table preferences, or layout. Initialization, reveal, and a missing or mismatched Webview table request full state again. This keeps the existing table DOM and avoids repeated transport of the whole tree.

The existing 0.8.2 ancestry fixtures are now replayed across multiple pages with the same exact expected node edges and lane counts. Additional regressions cover later roots beyond 100 pages, empty pages, cursor loops, cached choices during refresh, normalized early sidebar navigation, and Webview state recovery.

This trial does not introduce cached workspace listings or skip ancestry verification. Those changes need separate freshness and branch-lifecycle validation.

## Validation

- TypeScript checks and all 98 tests in 21 files passed.
- Read-only comparison against the 0.8.2 source on official Codex 26.1002.51308 returned exactly the same 92 root IDs and 20 family-candidate IDs.
- With parent caches warm, the first verified scan update was 6.58 seconds in 0.8.2 and 0.24 seconds in 0.8.3. Full root scans were 10.24 and 6.96 seconds respectively. These are single-run measurements, including RPC and excluding the QuickPick rendering itself.
- Cold root discovery, including App Server startup, produced its first verified update after 8.18 seconds in 0.8.2 and 1.28 seconds in 0.8.3 in the same read-only experiment.
- The two paginated ancestry replays still have exactly 221 nodes / 16 lanes and 268 nodes / 17 lanes, with every expected parent edge preserved.
- Selection/status JSON on those structures changed from 183,906 / 228,072 bytes to 382 / 383 bytes. These samples exclude answer HTML; actual preview payloads add the selected question and answer, but no unchanged tree.
- No live threads were created, archived, or deleted during verification.
