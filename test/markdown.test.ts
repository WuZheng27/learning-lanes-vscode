import { describe, expect, it } from "vitest";
import {
  normalizeChatMathDelimiters,
  renderSnapshotMarkdown,
} from "../src/markdown.js";

describe("snapshot Markdown renderer", () => {
  it("renders GFM Markdown and all common Codex math delimiters", () => {
    const html = renderSnapshotMarkdown(
      [
        "## 光反应",
        "",
        "**ATP** 与 $NADP^+$，行内 \\(x^2 + y^2\\)。",
        "",
        "\\[ \\frac{6 \\times 3}{2}=9 \\]",
        "",
        "| 阶段 | 产物 |",
        "| --- | --- |",
        "| 还原 | G3P |",
      ].join("\n"),
    );
    expect(html).toContain("<h2>光反应</h2>");
    expect(html).toContain("<strong>ATP</strong>");
    expect(html.match(/<math/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("<table>");
  });

  it("does not rewrite math-looking text inside inline or fenced code", () => {
    const source = "`\\(not math\\)`\n\n\`\`\`tex\n\\[still code\\]\n\`\`\`\n\n\\(real\\)";
    const normalized = normalizeChatMathDelimiters(source);
    expect(normalized).toContain("`\\(not math\\)`");
    expect(normalized).toContain("\\[still code\\]");
    expect(normalized).toContain("$ real $");
  });

  it("removes raw HTML, dangerous links, and remote image loading", () => {
    const html = renderSnapshotMarkdown(
      '<script>alert(1)</script><img src="https://tracker.invalid/a.png" onerror="alert(2)">\n\n[危险](javascript:alert(3)) ![示意图](https://tracker.invalid/b.png)',
    );
    expect(html).not.toMatch(/<script|onerror|javascript:|<img/u);
    expect(html).toContain("[图片：示意图]");
  });

  it("keeps malformed math local instead of failing the entire snapshot", () => {
    expect(() => renderSnapshotMarkdown("前文 \\(\\notARealCommand{\\) 后文")).not.toThrow();
    expect(renderSnapshotMarkdown("前文 \\(\\notARealCommand{\\) 后文")).toContain("前文");
  });
});
