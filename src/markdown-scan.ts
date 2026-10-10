/**
 * 编辑器侧的 Markdown 轻量扫描：代码块范围与行内代码范围。
 * 纯函数、不依赖 vscode，便于脱离扩展宿主独立验证（与 color-edits.ts 同一约定）。
 */
import { colorMarkers } from "./highlight-plugin";
import type { HighlightSpan } from "./color-edits";

export interface Range {
  start: number;
  end: number;
}

export interface CodeBlockRange extends Range {
  /** 围栏代码块 info string 的首个词（小写）；缩进代码块为空串 */
  language: string;
  type: "fence" | "indent";
}

/** ==…== 不跨行、内容不含 |（避免表格单元格误匹配）；组 1 为紧邻起始 == 的颜色表情 */
const HIGHLIGHT_REGEX = /==([🔴🟠🟡🟢🔵🟣]\uFE0F?)?([^=\n\r|]+)==/gu;

/**
 * 围栏代码块行：允许最多 3 个空格缩进与任意层 `>` 引用前缀（callout 内的代码块）。
 * 组 1 为引用前缀，组 2 为缩进，组 3 为反引号串，组 4 为 info string。
 */
const FENCE_REGEX = /^((?: {0,3}>[ \t]?)*)( {0,3})(`{3,})[ \t]*(.*)$/;

/** 每行起始偏移，末项为文末位置 */
function getLineStarts(lines: readonly string[]): number[] {
  const starts = [0];
  for (let i = 0; i < lines.length; i++) {
    starts.push(starts[i] + lines[i].length + 1);
  }
  return starts;
}

/**
 * 收集代码块范围。
 * 围栏需同引用深度、闭合围栏不短于起始围栏且不带 info string（否则视为围栏内容），
 * 这样 ```` 包裹 ``` 的写法、`> > ``` 的 callout 代码块都能正确配对；未闭合的围栏延伸到文末。
 */
export function getCodeBlockRanges(text: string): CodeBlockRange[] {
  const lines = text.split("\n");
  const starts = getLineStarts(lines);
  const ranges: CodeBlockRange[] = [];
  let open: { start: number; length: number; language: string; depth: number } | undefined;

  for (let line = 0; line < lines.length; line++) {
    const match = FENCE_REGEX.exec(lines[line]);
    if (match) {
      const depth = (match[1].match(/>/g) ?? []).length;
      const length = match[3].length;
      const language = match[4].trim().split(/\s+/)[0].toLowerCase();

      if (!open) {
        open = { start: starts[line], length, language, depth };
      } else if (depth === open.depth && length >= open.length && language === "") {
        ranges.push({ start: open.start, end: starts[line + 1], language: open.language, type: "fence" });
        open = undefined;
      }
      continue;
    }

    if (!open && /^ {4}/.test(lines[line])) {
      ranges.push({ start: starts[line], end: starts[line + 1], language: "", type: "indent" });
    }
  }

  if (open) {
    ranges.push({ start: open.start, end: text.length, language: open.language, type: "fence" });
  }

  return ranges;
}

/**
 * 收集行内代码范围（左闭右开，含两侧反引号）。
 * 反引号串按 CommonMark 规则配对：只有长度相同的串能配对，配不上的串不构成代码跨度。
 * 逐行配对还保证落单的反引号（例如表格单元格里的单个 ` ）不会让后面所有配对整体错位。
 */
export function getInlineCodeRanges(text: string, codeBlockRanges: readonly CodeBlockRange[]): Range[] {
  const lines = text.split("\n");
  const starts = getLineStarts(lines);
  const ranges: Range[] = [];

  for (let line = 0; line < lines.length; line++) {
    const content = lines[line];
    if (!content.includes("`")) {
      continue;
    }

    const runs = Array.from(content.matchAll(/`+/g), (match) => ({
      offset: match.index ?? 0,
      length: match[0].length,
    }));
    const paired = runs.map(() => false);

    for (let i = 0; i < runs.length; i++) {
      if (paired[i]) {
        continue;
      }
      for (let j = i + 1; j < runs.length; j++) {
        if (paired[j] || runs[j].length !== runs[i].length) {
          continue;
        }
        paired[i] = true;
        paired[j] = true;
        ranges.push({ start: starts[line] + runs[i].offset, end: starts[line] + runs[j].offset + runs[j].length });
        break;
      }
    }
  }

  return ranges.filter(
    (range) => !codeBlockRanges.some((block) => range.start < block.end && range.end > block.start)
  );
}

/** 偏移是否落在任一区间内（左闭右开） */
export function isInRange(offset: number, ranges: readonly Range[]): boolean {
  return ranges.some((range) => offset >= range.start && offset < range.end);
}

/** 收集文档中所有 ==…== 区间（忽略行内代码与代码块；```markdown 围栏内的高亮示例照常收集） */
export function collectHighlightSpans(text: string): HighlightSpan[] {
  const codeBlockRanges = getCodeBlockRanges(text);
  const inlineCodeRanges = getInlineCodeRanges(text, codeBlockRanges);
  const spans: HighlightSpan[] = [];

  // 重置全局正则的 lastIndex，避免状态污染
  HIGHLIGHT_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = HIGHLIGHT_REGEX.exec(text))) {
    const start = match.index;
    const end = start + match[0].length;

    // 起始或结束 == 落在行内代码里都不算高亮
    if (isInRange(start, inlineCodeRanges) || isInRange(end - 1, inlineCodeRanges)) {
      continue;
    }

    const startBlock = codeBlockRanges.find((range) => start >= range.start && start < range.end);
    const endBlock = codeBlockRanges.find((range) => end - 1 >= range.start && end - 1 < range.end);

    // 两个 == 都在代码块外：正常高亮；都在同一个围栏内：只有 ```markdown 围栏才高亮
    let shouldHighlight = !startBlock && !endBlock;
    if (startBlock && endBlock && startBlock.type === endBlock.type && startBlock.language === endBlock.language) {
      shouldHighlight = startBlock.type === "fence" && startBlock.language === "markdown";
    }
    if (!shouldHighlight) {
      continue;
    }

    const marker = match[1];
    const emoji = marker ? [...marker][0] : undefined;
    spans.push({
      start,
      end,
      contentStart: start + 2 + (marker?.length ?? 0),
      contentEnd: end - 2,
      color: emoji ? colorMarkers[emoji] ?? null : null,
    });
  }

  return spans;
}
