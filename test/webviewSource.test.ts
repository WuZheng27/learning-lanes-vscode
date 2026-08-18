import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src", "webview.ts"), "utf8");

describe("learning navigator webview source", () => {
  it("contains valid inline JavaScript", () => {
    const script = source.match(/<script nonce="\$\{nonce\}">([\s\S]*?)<\/script>/u)?.[1];
    expect(script).toBeTruthy();
    expect(() => Function(script ?? "")).not.toThrow();
  });

  it("uses preview-before-open interaction and removes depth separator labels", () => {
    expect(source).toContain("renderInspector(selected, current.selectedNodePreview)");
    expect(source).toContain("requestNodePreview(node.id)");
    expect(source).toContain("button(enterText, 'openNode'");
    expect(source).not.toContain("'第 ' + (depth + 1) + ' 层'");
    expect(source).not.toContain("corner.textContent = '层级'");
  });

  it("opens the snapshot in an accessible modal dialog", () => {
    expect(source).toContain("document.createElement('dialog')");
    expect(source).toContain("previewDialog.showModal()");
    expect(source).toContain("dialog.addEventListener('cancel'");
    expect(source).toContain("dismissPreview(dialog, node.id)");
    expect(source).toContain("--reading-font");
    expect(source).not.toContain("font-family: var(--vscode-editor-font-family, var(--vscode-font-family))");
  });

  it("uses VS Code theme tokens, scalable typography, and flat visual structure", () => {
    expect(source).toContain("--vscode-editor-font-size");
    expect(source).toContain("--node-font-scale");
    expect(source).toContain("--vscode-contrastBorder");
    expect(source).not.toContain("box-shadow");
    expect(source).not.toMatch(/linear-gradient|radial-gradient/u);
  });

  it("uses safe rich snapshots and independently scrollable compact tables", () => {
    expect(source).toContain("answer.innerHTML = preview.answerHtml");
    expect(source).toContain("question.innerHTML = preview.questionHtml");
    expect(source).toContain("className = 'table-scroll'");
    expect(source).toContain("new ResizeObserver");
    expect(source).toContain("tableMetrics(logicalWidths");
    expect(source).toContain("overscroll-behavior: contain");
    expect(source).not.toMatch(/(?:transform|zoom):\s*(?:scale|[.\d])/u);
  });

  it("supports roving keyboard navigation and scoped subtree deletion", () => {
    expect(source).toContain("moveGridFocus(cell, event.key)");
    expect(source).toContain("event.target.closest('.node')");
    expect(source).toContain("role', 'separator'");
    expect(source).toContain("aria-valuenow");
  });

  it("supports navigator-only frozen subtrees with compact gray lanes", () => {
    expect(source).toContain("case \"toggleFreeze\"");
    expect(source).toContain("frozenLaneFlags");
    expect(source).toContain(".lane-header.frozen");
    expect(source).toContain(".node.frozen");
    expect(source).toContain("冻结只整理学习泳道");
    expect(source).toContain("冻结此节点及子节点");
  });

  it("uses optional display labels while retaining the original question in snapshots", () => {
    expect(source).toContain('case "editLabel"');
    expect(source).toContain("current.document.nodeLabels[node.id]");
    expect(source).toContain("title.textContent = displayTitle");
    expect(source).toContain("preview.label ? '修改节点标签' : '添加节点标签'");
    expect(source).toContain("'原问题：' + node.title");
    expect(source).toContain("question.innerHTML = preview.questionHtml");
  });
});
