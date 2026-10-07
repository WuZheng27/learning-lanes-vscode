import type { LearningDocument, NavigatorViewState } from "./types.js";

type TableDocumentFields =
  | "nodes"
  | "preferences"
  | "nodeLabels"
  | "nodeActivity"
  | "frozenRootNodeIds"
  | "temporaryForks";

export interface NavigatorViewUpdate extends Omit<NavigatorViewState, "document" | "layout"> {
  readonly document: Omit<LearningDocument, TableDocumentFields>;
}

export type NavigatorStateMessage =
  | { readonly type: "state"; readonly state: NavigatorViewState }
  | { readonly type: "stateUpdate"; readonly state: NavigatorViewUpdate };

/** A table version covers every document field needed to render its cells. */
export function buildStateMessage(
  state: NavigatorViewState,
  previousTableVersion: number | null,
  forceFull = false,
): NavigatorStateMessage {
  if (forceFull || state.tableVersion === undefined || state.tableVersion !== previousTableVersion) {
    return { type: "state", state };
  }
  const { document, layout: _layout, ...update } = state;
  const {
    nodes: _nodes,
    preferences: _preferences,
    nodeLabels: _labels,
    nodeActivity: _activity,
    frozenRootNodeIds: _frozen,
    temporaryForks: _forks,
    ...metadata
  } = document;
  return { type: "stateUpdate", state: { ...update, document: metadata } };
}
