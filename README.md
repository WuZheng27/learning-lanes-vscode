# Codex Learning Navigator

**Keep the native Codex chat. Add a map for every question and branch.**

Codex Learning Navigator is an experimental VS Code companion extension for people who use
branched Codex conversations to learn, investigate, and revisit complex topics. It reconstructs
official Codex tasks as a compact lane table without replacing the official chat interface.

> **Unofficial companion extension.** This project is not affiliated with, endorsed by, or
> supported by OpenAI. It uses compatibility-tested integration points that can change in future
> versions of the official Codex extension.

## Abstract

Long AI conversations are easy to continue but difficult to navigate. Once a learner returns to
an earlier answer and creates several branches, the official task list shows many similar tasks
without preserving the visible parent-child structure of the questions.

Codex Learning Navigator turns those tasks back into a question map:

- one user question occupies one row;
- sibling follow-ups occupy equal lanes;
- a parent spans all lanes that descend from it;
- copied ancestor turns are merged instead of displayed repeatedly;
- clicking a node first opens a readable answer snapshot;
- confirming a node opens the corresponding task in the official Codex sidebar.

The model, reasoning effort, permissions, attachments, approvals, streaming output, Markdown,
math, and images remain the responsibility of the official Codex interface.

## Background

### A task list loses the learning structure

Codex can fork a task from an earlier turn. That preserves useful context, but every fork appears
as another task in a mostly flat list. After enough exploration, titles alone no longer answer:

- Which question produced this branch?
- Which follow-ups are siblings?
- Which topics are deeper continuations?
- Which branch did I visit recently?
- Which topics are temporarily inactive?

### An old turn is not a public navigation target

The official VS Code integration can open a task, but it does not expose a stable public API for
scrolling to and selecting an arbitrary historical turn. Opening a task that continued beyond the
desired question therefore lands at the end, not at that intermediate learning position.

### Replacing the chat creates a second set of problems

A custom chat view would need to reproduce model selection, reasoning controls, permissions,
attachments, approvals, streaming, formulas, images, and future Codex features. It would also
split the user between two chat experiences.

This project deliberately avoids that approach. The navigator manages structure and location;
the official Codex extension remains the conversation UI.

## Result

| Need | What the extension does |
| --- | --- |
| Preserve question hierarchy | Rebuilds a turn-prefix tree from official tasks and forks |
| Keep sibling questions equal | Uses lane columns with no privileged main path |
| Avoid repeated ancestors | Merges turns with the same Codex turn ID |
| Use native Codex controls | Opens the official far-right Codex sidebar instead of a second chat |
| Inspect before navigating | Shows a modal snapshot with path, question, answer, math, and activity |
| Reach an intermediate turn | Creates a temporary exact fork only after explicit confirmation |
| Reduce temporary task clutter | Deletes an unused exact fork after a guarded five-minute cleanup period |
| Add non-conversation meaning | Allows an optional display label while preserving the original question |
| De-emphasize inactive topics | Freezes a subtree into narrow gray lanes without changing official history |

## The learning-lane model

The visual model follows the questions rather than the task list:

~~~text
Row 1   [ How does photosynthesis store light energy?                    ]
Row 2   [ What does ATP do? ] [ Why is chlorophyll green? ] [ Calvin cycle? ]
Row 3   [ Explain ATP hydrolysis and ΔG < 0 ]               [ Where is ATP used? ]
~~~

The rules are intentionally small:

1. Every visible node represents one user question and one Codex turn.
2. Depth is determined by the question parent, not by a preferred task or main path.
3. Questions after the same parent are siblings and receive equal lanes.
4. A parent spans the complete lane range of its visible descendants.
5. Empty official forks are badges on their base question, not extra rows.
6. A manually deleted node hides its complete subtree only in the navigator.

## Key capabilities

### Sync branches created in official Codex

Continue to create branches with the official Codex branch action. While the navigator is
visible it periodically reads the official task graph and updates the lane table. **Sync official
branches** requests an immediate refresh.

The root picker is intentionally cleaner than the official task list: it lists root tasks and
hides descendant forks and temporary navigation tasks. Search works across task title, first
question, project path, and task ID.

### Preview before entering

Clicking a node does not immediately create or switch a task. It opens a modal snapshot containing:

- the ancestor question path;
- the original user question;
- the assistant answer;
- child and descendant counts;
- visit frequency and last-access time;
- exact-navigation and frozen-state information.

The answer has its own scroll area. Markdown is sanitized before it reaches the webview, and the
snapshot supports headings, emphasis, lists, tables, code, links, and math written with dollar or
LaTeX-style delimiters. External links are opened by VS Code only after protocol validation.

### Add a display label without changing the conversation

Use **Add node label** in the snapshot to show a short topic name, study note, or semantic marker
on the lane card. For example, a long question can be displayed as **ATP energy accounting**.

Labels are navigator metadata:

- they never modify the official Codex task;
- the original question remains visible in the snapshot;
- clearing the label restores the original card text;
- labels survive branch synchronization;
- deletion, undo, and redo include label changes.

### Navigate exactly to an intermediate question

If an official task already ends at the selected question, the navigator opens it directly.
Otherwise, confirmation creates a precise fork from the selected thread and turn through Codex
App Server, then opens that fork in the official sidebar.

The temporary fork follows a conservative lifecycle:

1. No task is created while the user only browses the snapshot.
2. Confirmation creates or reuses one exact temporary fork.
3. Sending a new question promotes it to a normal branch.
4. Leaving without a new turn schedules cleanup after five minutes.
5. Cleanup first verifies that the task still has no new turn and no descendants.
6. Reopening the node cancels pending cleanup and reuses the task.

### Freeze inactive subtrees

Freezing a node visually archives that node and all descendants:

- affected lanes become narrower and gray;
- active lanes remain visually prominent;
- descendants discovered during later syncs inherit the frozen state;
- unfreezing any descendant restores the owning frozen subtree.

Freeze is navigator-only. It does not archive, delete, or move official Codex tasks because one
official task can contain ancestor turns shared by several visible learning branches.

### Compact and accessible table controls

- independent font-size and structural table-scale controls;
- automatic compact fitting with readable minimum column widths;
- wrap or ellipsis text modes;
- resizable lanes and rows;
- collapsible subtrees;
- recent and frequent access cues;
- Delete-key subtree removal with confirmation;
- in-window undo and redo;
- roving keyboard navigation with arrow keys and Home or End;
- independent table and snapshot scrolling.

## Requirements

- VS Code 1.96.2 or newer.
- The official **Codex – OpenAI coding agent** extension, ID **openai.chatgpt**.
- A working Codex sign-in in the same VS Code extension host.
- An open workspace folder.
- Windows for local use, or Linux x86_64 / ARM64 through VS Code Remote SSH.

Version 0.8.0 was compatibility-tested with official Codex extension 26.814.41407 and its bundled
Codex App Server 0.148.0-alpha.15. Startup checks report missing capabilities instead of silently
creating invalid navigation nodes.

## Installation

### Local VS Code

1. Build the VSIX from this repository or download one attached to a GitHub Release.
2. Open **Extensions** in VS Code.
3. Choose **Install from VSIX...** from the Extensions menu.
4. Select the VSIX and run **Developer: Reload Window**.

### Remote SSH

1. Connect to the server and keep the **SSH: host** VS Code window active.
2. Choose **Install from VSIX...** in that remote window.
3. Use **Show Local** to select a VSIX stored on the local computer.
4. Confirm the extension is installed in **SSH: host**, not only in Local.
5. Reload the remote window.

Both this extension and official Codex must run in the remote workspace extension host. Use
**Developer: Show Running Extensions** to verify that both entries show the same SSH target.

## Getting started

1. Click **学习泳道** in the VS Code status bar.
2. Alternatively click the branch-tree icon in the editor or Explorer title bar.
3. Choose **Select root conversation**.
4. Search for and select an official Codex root task.
5. Create branches manually in the official Codex sidebar.
6. Return to the navigator and wait for automatic refresh or click **Sync official branches**.
7. Click a node to read its snapshot.
8. Confirm only when you want to enter that exact branch in official Codex.

The Command Palette entry **Learning Navigator: Open** remains available as a fallback.

## Architecture

~~~text
Learning Lanes webview
        |
        v
Navigator controller ---- versioned workspace JSON
        |
        v
Bundled Codex App Server over stdio
        |
        +---- read official tasks and turns
        +---- inspect fork ancestry
        +---- fork an exact historical turn when confirmed
        +---- clean unused temporary forks
        |
        v
Official Codex sidebar and conversation renderer
~~~

Main responsibilities:

- **CodexBridge** discovers the official extension and its platform-specific bundled executable.
- **AppServerClient** provides typed JSON-RPC-style request handling over stdio.
- **NavigatorController** synchronizes tasks, manages exact forks, and persists navigator state.
- **Lane layout** converts the question tree into rows, equal sibling lanes, and parent spans.
- **Webview** renders the table and modal snapshots with VS Code theme tokens.

The extension does not patch official extension files, copy login tokens, expose App Server on a
network port, or inject custom teaching prompts.

## Data, privacy, and storage

Official conversation content remains in Codex task storage. The extension stores only its own
versioned navigator document under the VS Code workspace extension storage, including:

- selected root task ID;
- hidden turn IDs;
- node labels;
- frozen subtree roots;
- visit counters and timestamps;
- table preferences and manual dimensions;
- temporary-fork lifecycle metadata.

Snapshots are read from official tasks when needed; full transcripts are not duplicated into the
learning document. Automatic polling pauses while the navigator editor is hidden and refreshes
immediately when it becomes visible again.

Deleting or freezing a node does not delete official history. The only official tasks that can be
deleted automatically are unused temporary forks created by this extension for exact navigation,
and only after the guarded cleanup checks described above.

## Compatibility boundary

Codex App Server task and fork operations are the stable center of the integration. Opening the
far-right official sidebar at a task currently relies on compatibility-tested VS Code commands
and URI routing from the official extension, which are not a stable public extension API.

An official extension update can therefore require an update here. The extension checks the
official extension, conversation editor, sidebar route, bundled executable, and App Server
capabilities before use.

See the official [Codex App Server documentation](https://developers.openai.com/codex/app-server)
for the underlying task protocol.

## Current limitations

- One VS Code workspace stores one learning-lane document.
- Existing official tasks are selected as roots; unrelated roots are not merged into one table.
- Direct follow-ups in official Codex appear after synchronization, not as optimistic local nodes.
- Exact navigation targets a forked task ending at the chosen turn; it cannot scroll and highlight
  an arbitrary turn inside a longer official task.
- Navigator undo and redo history lasts only for the current VS Code window.
- Compatibility may need adjustment after an official Codex extension update.

## Development

~~~powershell
pnpm install --frozen-lockfile
pnpm run check
pnpm run test
pnpm run build
pnpm run package
~~~

The automated suite covers document migration, lane layout, task-prefix merging, root filtering,
temporary-fork promotion and cleanup, safe Markdown and math rendering, compact table sizing,
compatibility checks, node labels, one-click entry points, and App Server protocol behavior.

The generated VSIX is written to the **dist** directory and is intentionally excluded from Git.
Release VSIX files should be attached to GitHub Releases instead of committed to the repository.

## Project status

Version 0.8.0 is an experimental MVP. The storage schema is versioned and migrates earlier local
documents, but the integration should still be treated as compatibility-sensitive software.
Issues and reproducible compatibility reports are welcome.

## License

[MIT](LICENSE)
