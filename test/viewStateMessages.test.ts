import { describe, expect, it } from "vitest";
import { buildLaneLayout } from "../src/layout.js";
import { defaultDocument } from "../src/model.js";
import { buildStateMessage } from "../src/viewStateMessages.js";
import type { NavigatorViewState } from "../src/types.js";

function state(): NavigatorViewState {
  const document = defaultDocument("test");
  return {
    tableVersion: 3, document, layout: buildLaneLayout(document.nodes),
    selectedNodeId: null, selectedNodePreview: null, canUndo: false, canRedo: false, busy: false,
    compatibility: { checked: true, ok: true, extensionVersion: "test", appServerVersion: "test", message: null },
    transientMessage: null,
  };
}

describe("versioned view state messages", () => {
  it("sends a complete table on first delivery, structural change, and recovery", () => {
    const current = state();
    expect(buildStateMessage(current, null)).toEqual({ type: "state", state: current });
    expect(buildStateMessage(current, 2).type).toBe("state");
    expect(buildStateMessage(current, 3, true).type).toBe("state");
  });

  it("preserves status and document metadata without resending the unchanged table", () => {
    const current = { ...state(), busy: true, selectedNodeId: "selected", transientMessage: "Loading" };
    const message = buildStateMessage(current, 3);
    expect(message.type).toBe("stateUpdate");
    expect(message.state).toMatchObject({ busy: true, selectedNodeId: "selected", transientMessage: "Loading" });
    expect(message.state).not.toHaveProperty("layout");
    expect(message.state.document).toEqual({ schemaVersion: 8, workspaceUri: "test", rootThreadId: null, hiddenTurnIds: [] });
    expect(message.state.document).not.toHaveProperty("nodes");
    expect(message.state.document).not.toHaveProperty("preferences");
    expect(message.state.document).not.toHaveProperty("temporaryForks");
  });

  it("delivers changed previews without discarding cached table fields", () => {
    const preview = { nodeId: "selected", label: null, question: "Q", questionHtml: "<p>Q</p>", answerHtml: "<p>A</p>",
      answerState: "ready" as const, path: [], childCount: 0, descendantCount: 0, visitCount: 0,
      lastVisitedAt: null, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    expect(buildStateMessage({ ...state(), selectedNodePreview: preview }, 3).state.selectedNodePreview).toBe(preview);
  });

  it("keeps full-state compatibility when no table version is available", () => {
    const { tableVersion: _version, ...legacy } = state();
    expect(buildStateMessage(legacy, null).type).toBe("state");
    expect(buildStateMessage(legacy, 3).type).toBe("state");
  });
});
