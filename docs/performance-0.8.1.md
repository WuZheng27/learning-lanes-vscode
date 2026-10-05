# Performance validation for 0.8.1

The ancestry assumptions in this release caused a correctness regression and are superseded by [the 0.8.2 fix](ancestry-0.8.2.md). The rendering optimizations and their measurements remain applicable.

Validated on Linux / Node 24 with official Codex extension 26.930.41038 and its bundled Codex 0.160.0. Automated tests also run in CI on Node 22. Original comparison commit: 3db9981c081e571dd2aa111cd9c712af5ff9cb43.

## Automated coverage

The suite covers progressive/cancellable root discovery, authoritative null versus missing parent metadata, legacy fallback, limited concurrency and failure draining, A → B → A snapshot reuse, stale background results after switching, concurrent initialization, DOM identity and scroll retention, frozen backgrounds, activity totals and preview interaction. Existing turn merging, cleanup safety, Markdown sanitization, layout and protocol tests remain in the suite.

## Chromium check

Headless Chromium 130, viewport 1400 × 900, synthetic 300-lane / 100-depth tree with 399 actual nodes. Two animation frames are awaited after state delivery. Single-run observations on this host, not end-to-end VS Code latency guarantees:

| Measurement | 0.8.0 | 0.8.1 |
| --- | ---: | ---: |
| First frame | 1,889 ms | 253 ms |
| Selection + busy update | 966 ms | 39 ms |
| Background DOM elements | 30,000 | 300 |

The new version retained table/cell identity and scroll position; sibling alignment, parent spans and click handling passed in a real browser with no JavaScript errors. Timing includes browser layout/rendering but excludes RPC and extension-host messaging. Wall-clock numbers vary with load and browser warmup.

An optional reproducible smoke script is provided at `scripts/webview-browser-smoke.cjs`. Install a Playwright version compatible with the host OS in a separate directory, then run using `NODE_PATH=/path/to/node_modules node scripts/webview-browser-smoke.cjs`. `PLAYWRIGHT_BROWSERS_PATH` can select the matching downloaded browser. Use `--baseline` against the old checkout to record its results without applying new-version assertions. Screenshots and outputs are emitted under `dist/`.

## Real backend, read-only

A local smoke run discovered 169 roots via two list pages, with zero summary reads and zero full-history reads. First roots arrived after about 6.4 seconds, full roots after 9.3 seconds. The sampled related-tree discovery also used metadata only. No history bodies were printed and no conversations were created, archived or deleted. Another cold initialization probe took about 34 seconds: the old 20-second startup deadline was insufficient, so initialization now permits 60 seconds. This is a timeout tolerance change, not a claim that cold backend startup itself is faster.

## Compatibility and remaining limits

The installed 0.160.0 schema does not define `ancestorThreadId` for thread/list. New performance discovery uses client-side ancestry indexing rather than relying on an unsupported filter. Missing legacy ancestry retains the original full-read/prefix fallback. Existing temporary-fork deletion guards are preserved.

Snapshot eviction preserves every thread required for the current tree; the cache is bounded to a target of 128 threads outside larger active working sets, not a strict byte limit. Rendering still builds actual node cards and a dense layout array; extremely large trees may benefit from viewport virtualization in a later release. Full native Codex sidebar interaction and streaming must be checked after reloading the installed extension in the user's window.
