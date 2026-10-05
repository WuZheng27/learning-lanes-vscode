# Branch discovery regression fix, 0.8.2

## Root cause

The 0.8.1 optimization treated an explicit null `forkedFromId` in thread/list as proof that a thread was a root. On the observed Codex backend, all 171 active vscode list records returned null, while thread/read returned the real parent for many of those records. As a result, descendants appeared in the root picker and metadata prefiltering discarded their sibling branches.

A second flaw assumed every intermediate parent was in the active workspace list. Some active children reference a thread omitted by that list. Direct adjacency filtering then severed the ancestry chain. Skipping turn-prefix inference merely because a parent field was present also prevented recovery.

## Correction

Null list metadata is now unverified. Cached lightweight summaries establish the parent; only verified roots enter the picker, progressively. The parent resolver follows omitted intermediates, coalesces concurrent summary reads, and detects cycles. Threads whose complete ancestry cannot be established remain candidates for turn-prefix inference; only confirmed unrelated roots are excluded. The model again uses prefix inference when an explicit parent cannot be used within the listed set.

Documents saved with a descendant as root are normalized to its real root during synchronization while keeping navigator preferences and metadata. Existing cached histories and rendering improvements are retained.

## Validation

The reported environment ran official Codex extension 26.930.51102. Read-only backend checks produced 91 verified roots from 171 list records. A one-time check read the full history structures for all 171 records, discarding message text and tool payloads. For two reported families, the repaired discovery was compared against the original 0.8.0 model applied to the entire history set, with exact node-ID and parent-ID equality:

| Family | Candidate histories | Problem nodes | Lanes | Matches original global tree |
| --- | ---: | ---: | ---: | --- |
| A | 20 | 221 | 16 | Yes |
| B | 21 | 268 | 17 | Yes |

The candidate counts include unresolved ancestry retained conservatively. Unrelated candidates are eliminated by turn-prefix modeling. Family B requires an intermediate parent omitted from the active list; a first metadata-only fix still missed 18 nodes and was rejected during validation.

The two structures were anonymized into test/fixtures/list-null-ancestry.json: synthetic IDs, relative times, no titles, messages, project paths or tool output. Replay tests cover root filtering, ancestor normalization, summary/full-read behavior, exact edges and lane counts. Additional unit tests cover misleading list nulls, missing summaries/ancestors, cancellation, cycles and cached verification. DOM and existing lifecycle safety tests also remain in the suite.

Installation requires reloading the VS Code window. Opening the navigator then performs automatic root correction and sync; the manual sync command can request a refresh immediately.
