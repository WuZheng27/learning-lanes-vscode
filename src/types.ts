export type LearningNodeRuntimeState =
  | "waiting"
  | "running"
  | "completed"
  | "failed"
  | "interrupted";

export interface LearningNode {
  readonly id: string;
  readonly parentNodeId: string | null;
  readonly threadId: string;
  readonly turnId: string;
  readonly title: string;
  readonly runtimeState: LearningNodeRuntimeState;
  readonly collapsed: boolean;
  readonly navigationExact: boolean;
  readonly waitingBranchCount: number;
  readonly containingThreadIds: ReadonlyArray<string>;
  readonly terminalThreadIds: ReadonlyArray<string>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LearningPreferences {
  readonly textMode: "wrap" | "ellipsis";
  readonly fontScale: number;
  readonly tableScale: number;
  readonly autoFit: boolean;
  readonly defaultColumnWidth: number;
  readonly defaultRowHeight: number;
  readonly columnWidths: Readonly<Record<string, number>>;
  readonly rowHeights: Readonly<Record<string, number>>;
}

export interface LearningNodeActivity {
  readonly visitCount: number;
  readonly lastVisitedAt: string | null;
}

export type TemporaryForkState = "waiting" | "cleanupPending" | "archived";

export interface TemporaryFork {
  readonly nodeId: string;
  readonly sourceThreadId: string;
  readonly threadId: string;
  readonly baseTurnId: string;
  readonly state: TemporaryForkState;
  readonly createdAt: string;
  readonly lastOpenedAt: string;
  readonly cleanupAfter: string | null;
  readonly archivedAt: string | null;
}

export interface LearningDocument {
  readonly schemaVersion: 8;
  readonly workspaceUri: string;
  readonly rootThreadId: string | null;
  readonly hiddenTurnIds: ReadonlyArray<string>;
  readonly frozenRootNodeIds: ReadonlyArray<string>;
  readonly temporaryForks: ReadonlyArray<TemporaryFork>;
  readonly nodeActivity: Readonly<Record<string, LearningNodeActivity>>;
  readonly nodeLabels: Readonly<Record<string, string>>;
  readonly nodes: ReadonlyArray<LearningNode>;
  readonly preferences: LearningPreferences;
}

export interface LearningNodePreview {
  readonly nodeId: string;
  readonly label: string | null;
  readonly question: string;
  readonly questionHtml: string;
  readonly answerHtml: string | null;
  readonly answerState: "ready" | "running" | "unavailable";
  readonly path: ReadonlyArray<string>;
  readonly childCount: number;
  readonly descendantCount: number;
  readonly visitCount: number;
  readonly lastVisitedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CodexTurnSnapshot {
  readonly id: string;
  readonly status: string;
  readonly items: ReadonlyArray<unknown>;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface CodexThreadSnapshot {
  readonly id: string;
  readonly name: string | null;
  readonly preview: string | null;
  readonly cwd: string | null;
  readonly sessionId: string | null;
  readonly forkedFromId: string | null;
  readonly createdAt: number | null;
  readonly updatedAt: number | null;
  readonly turns: ReadonlyArray<CodexTurnSnapshot>;
  readonly status: unknown;
}

export interface CodexListedThread {
  readonly id: string;
  readonly name: string | null;
  readonly preview: string | null;
  readonly cwd: string | null;
  readonly sessionId: string | null;
  readonly forkedFromId: string | null;
  readonly createdAt: number | null;
  readonly updatedAt: number | null;
  readonly status: unknown;
}

export interface LanePlacement {
  readonly node: LearningNode;
  readonly depth: number;
  readonly lane: number;
  readonly columnSpan: number;
}

export interface LaneLayout {
  readonly rows: ReadonlyArray<ReadonlyArray<LanePlacement | null>>;
  readonly laneCount: number;
  readonly laneKeys: ReadonlyArray<string>;
}

export interface NavigatorViewState {
  readonly document: LearningDocument;
  readonly layout: LaneLayout;
  readonly selectedNodeId: string | null;
  readonly selectedNodePreview: LearningNodePreview | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly busy: boolean;
  readonly compatibility: {
    readonly checked: boolean;
    readonly ok: boolean;
    readonly extensionVersion: string | null;
    readonly appServerVersion: string | null;
    readonly message: string | null;
  };
  readonly transientMessage: string | null;
}
