# Codex Learning Navigator

> **Unofficial companion extension.** This project is not affiliated with, endorsed by, or
> supported by OpenAI. It uses compatibility-tested integration points in the official Codex
> VS Code extension that may change between releases.

Codex Learning Navigator is a companion for the official OpenAI Codex VS Code extension. It
merges the turns from official Codex tasks into a compact question tree and uses temporary
forks to open interior questions exactly. It never creates a second chat editor.

## Requirements

- VS Code 1.96.2 or newer.
- The official `openai.chatgpt` extension installed in the same extension host.
- A workspace folder and a working Codex sign-in.

## Usage

1. Run **Learning Navigator: Open** from the Command Palette.
2. Start or open a task in the official Codex view on the far-right sidebar.
3. In the navigator, choose **Select root conversation**. The clean global picker searches
   official Codex root tasks across every project and hides all forked or temporary tasks.
   Search by title, first question, project path, or task ID.
4. Create ordinary branches with the official Codex branch button. The navigator detects the
   forked tasks automatically; **Sync official branches** forces an immediate refresh.
5. Click a question once to open a centered snapshot dialog with its path, answer, branch size,
   and visit history. Close it with Escape, the close button, or the backdrop. Use the
   confirmation button only when you want to enter that branch in the official Codex sidebar.
6. Use **Freeze this node and descendants** in the snapshot when a topic is temporarily inactive.
   The complete subtree becomes a narrow gray archived lane so active work remains prominent.
   Opening any frozen descendant lets you restore the owning frozen branch.

The snapshot uses a Chinese-friendly proportional reading font and a separate scrollable answer
pane. It renders headings, emphasis,
lists, GFM tables, code blocks, and Codex math written with `$...$`, `$$...$$`,
`\\(...\\)`, or `\\[...\\]` as native MathML. Raw HTML and unsafe links are removed;
external HTTP(S) links are opened by VS Code after a second protocol check.

Each node is one user question/turn, so consecutive follow-ups occupy consecutive rows. Turns
copied by a fork are merged; different turns after the same parent become sibling lanes. A fork
with no new question is shown as a badge on its base question and does not consume a row.

When a root from another project is selected, branch discovery follows that task's original
`cwd`; the VS Code folder currently showing the navigator does not limit the root picker.

When an interior node needs exact navigation, selecting it does not create anything. Only the
snapshot confirmation creates a persisted temporary fork through Codex App Server and opens it
in the far-right official sidebar. Sending a question in that task promotes it to a normal
branch. Leaving it without sending a question schedules permanent deletion after five minutes
if it still has no new turn or descendants. Reopening the node cancels cleanup and reuses the
same temporary task.

The table follows the active VS Code theme and editor font. Font size and structural table scale
are independent. **Auto fit** uses an 85% compact ceiling while preserving readable column
widths; the table scrolls instead of crushing text when many lanes exist. **Compact reset**
restores automatic sizing and clears manual row/column overrides. Rows grow naturally unless
they were manually resized, and the table scrolls independently from the toolbar and snapshot.

Keyboard users can enter the grid once with Tab, move between questions with arrow keys or
Home/End, resize separators with arrow keys, and use Delete only while a node has focus. Deleting
a subtree always shows its size and explains that official Codex history is preserved. A single
accent scale records confirmed branch visits: stronger marks indicate recent or frequent use,
while the selected-node snapshot shows exact visit counts and timestamps.

Deleting a question hides its complete subtree only in the navigator; the official tasks and
their history remain untouched. Delete, collapse, sizing, text mode, undo, and redo are
navigator-only.

Freezing is also navigator-only. It persists a frozen root rather than duplicating flags on
every child, so descendants discovered during later Codex syncs are automatically frozen too.
It does not archive, delete, or move official Codex tasks: a Codex task can contribute copied
ancestor turns to several learning lanes, so task-level archival could otherwise hide an active
sibling. Freeze and unfreeze participate in the same in-window undo/redo history as other layout
changes.

Automatic App Server polling pauses while the navigator editor is hidden and refreshes
immediately when it becomes visible again.

## Compatibility

This extension does not patch the official extension. It reads task/fork metadata through the
bundled Codex App Server and opens the official sidebar through `chatgpt.openSidebar` plus the
official extension's VS Code URI handler. App Server task APIs are documented, but the sidebar
deep-link route is not a stable public extension API. A future official extension update may
therefore require a compatibility update here.

The official extension's public navigation target is a task, not an arbitrary turn. Nodes whose
existing task already ends at the selected question open directly. Other nodes are labelled
**Click for exact location** and use the temporary-fork lifecycle above. Temporary task metadata
is stored in the workspace extension storage so interrupted cleanup resumes on the next window.

## Development

```bash
pnpm install --frozen-lockfile
pnpm run check
pnpm run test
pnpm run build
```

Packaged VSIX files are attached to GitHub Releases rather than committed to the repository.
