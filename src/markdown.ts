import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

const CACHE_LIMIT = 100;
const cache = new Map<string, string>();

const snapshotSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", "language-math", "math-inline", "math-display"],
    ],
  },
} satisfies Parameters<typeof rehypeSanitize>[0];

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkBreaks)
  .use(remarkRehype)
  .use(rehypeSanitize, snapshotSchema)
  .use(rehypeKatex, {
    output: "mathml",
    strict: "ignore",
    trust: false,
    maxExpand: 1_000,
    maxSize: 50,
  })
  .use(restrictSnapshotLinks)
  .use(rehypeStringify);

export function renderSnapshotMarkdown(markdown: string): string {
  const normalized = normalizeChatMathDelimiters(markdown);
  const cached = cache.get(normalized);
  if (cached !== undefined) {
    cache.delete(normalized);
    cache.set(normalized, cached);
    return cached;
  }
  let html: string;
  try {
    html = String(processor.processSync(normalized));
  } catch {
    html = `<p>${escapeHtml(markdown)}</p>`;
  }
  cache.set(normalized, html);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (typeof oldest === "string") cache.delete(oldest);
  }
  return html;
}

/**
 * Codex often emits MathJax delimiters, while remark-math expects dollar
 * delimiters. Fenced and inline code are intentionally left untouched.
 */
export function normalizeChatMathDelimiters(markdown: string): string {
  let fence: { marker: "`" | "~"; length: number } | null = null;
  let inlineCodeTicks = 0;
  let paddedDisplayMathOpen = false;
  let normalized = "";

  for (const line of markdown.match(/[^\n]*(?:\n|$)/g) ?? []) {
    const lineWithoutEnding = line.replace(/\r?\n$/, "");
    const fenceMatch =
      inlineCodeTicks === 0 ? /^[ \t]{0,3}(`{3,}|~{3,})/.exec(lineWithoutEnding) : null;

    if (fence) {
      normalized += line;
      if (
        fenceMatch &&
        fenceMatch[1]?.[0] === fence.marker &&
        fenceMatch[1].length >= fence.length &&
        /^[ \t]*$/.test(lineWithoutEnding.slice(fenceMatch[0].length))
      ) {
        fence = null;
      }
      continue;
    }

    if (fenceMatch?.[1]) {
      fence = {
        marker: fenceMatch[1][0] as "`" | "~",
        length: fenceMatch[1].length,
      };
      normalized += line;
      continue;
    }

    for (let index = 0; index < line.length; ) {
      if (line[index] === "`") {
        let end = index + 1;
        while (line[end] === "`") end += 1;
        const tickCount = end - index;
        normalized += line.slice(index, end);
        if (inlineCodeTicks === 0) inlineCodeTicks = tickCount;
        else if (inlineCodeTicks === tickCount) inlineCodeTicks = 0;
        index = end;
        continue;
      }

      if (
        inlineCodeTicks === 0 &&
        paddedDisplayMathOpen &&
        (line[index] === " " || line[index] === "\t") &&
        line[index + 1] === "\\" &&
        line[index + 2] === "]"
      ) {
        normalized += "\n$$";
        paddedDisplayMathOpen = false;
        index += 3;
        continue;
      }

      if (inlineCodeTicks === 0 && line[index] === "\\") {
        let end = index + 1;
        while (line[end] === "\\") end += 1;
        const delimiter = line[end];
        if (end === index + 1 && delimiter && "()[]".includes(delimiter)) {
          if (delimiter === "[" && (line[end + 1] === " " || line[end + 1] === "\t")) {
            normalized += "$$\n";
            paddedDisplayMathOpen = true;
            index = end + 2;
          } else {
            normalized +=
              delimiter === "[" || delimiter === "]" ? "$$" : delimiter === "(" ? "$ " : " $";
            index = end + 1;
          }
          continue;
        }
      }

      normalized += line[index];
      index += 1;
    }
  }

  return normalized;
}

function restrictSnapshotLinks() {
  return (tree: unknown): void => {
    visit(tree);
  };
}

function visit(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const node = value as {
    type?: unknown;
    tagName?: unknown;
    properties?: Record<string, unknown>;
    children?: unknown[];
  };
  if (node.type === "element" && node.tagName === "a") {
    const href = typeof node.properties?.href === "string" ? node.properties.href : "";
    if (!isSafeExternalHref(href)) {
      node.tagName = "span";
      node.properties = {};
    } else {
      node.properties = { href };
    }
  }
  if (node.type === "element" && node.tagName === "img") {
    const alt = typeof node.properties?.alt === "string" ? node.properties.alt : "图片";
    node.tagName = "span";
    node.properties = { className: ["snapshot-image-placeholder"] };
    node.children = [{ type: "text", value: `[图片：${alt}]` }];
  }
  for (const child of node.children ?? []) visit(child);
}

function isSafeExternalHref(href: string): boolean {
  try {
    const protocol = new URL(href).protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:";
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
