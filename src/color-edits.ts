/**
 * 颜色命令的偏移计算（纯函数，不依赖 vscode，便于独立验证）。
 * 编辑器层只负责把 vscode 对象适配成这里的接口，并应用返回的编辑。
 */

// 文档中的一个 ==...== 高亮区间（均为文本偏移，contentStart/End 不含两侧 == 与颜色标记）
export interface HighlightSpan {
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  color: string | null;
}

/** 编辑所需的文档信息（vscode.TextDocument 的适配层） */
export interface EditorText {
  readonly text: string;
  /** 该行起始偏移 */
  lineStartOffset(line: number): number;
  /** 该行内容结束偏移（不含换行符） */
  lineEndOffset(line: number): number;
  /** 偏移所在行号 */
  lineOfOffset(offset: number): number;
}

/** 选区/光标，用文本偏移表示 */
export interface SelectionOffsets {
  start: number;
  end: number;
}

/**
 * 一个替换编辑：[startOffset, startOffset + oldLength) 替换为 newText。
 * anchorStart/End 为结果文本内的相对偏移，用于编辑后恢复选区。
 */
export interface ColorEdit {
  startOffset: number;
  oldLength: number;
  newText: string;
  anchorStart: number;
  anchorEnd: number;
}

/**
 * 为目标选区/光标计算加色编辑。
 * - 选区（或光标）落在已有高亮内时只改写颜色标记，避免嵌套
 * - 有选区时逐行包裹，不生成跨行高亮（跨行高亮无法被编辑器装饰器识别）
 * - 空选区且不在高亮内时插入一对空标记，光标停在标记之后
 * - marker 为空串表示默认配色：不写颜色标记，但仍使用默认高亮色
 */
export function computeColorEdits(
  editor: EditorText,
  spans: HighlightSpan[],
  selections: SelectionOffsets[],
  marker: string
): ColorEdit[] {
  const edits: ColorEdit[] = [];
  const queue = (start: number, end: number, newText: string, anchorStart: number, anchorEnd: number) => {
    if (edits.some((edit) => start < edit.startOffset + edit.oldLength && end > edit.startOffset)) {
      return;
    }
    edits.push({ startOffset: start, oldLength: end - start, newText, anchorStart, anchorEnd });
  };
  const queueWrap = (start: number, end: number) => {
    const content = editor.text.slice(start, end);
    queue(start, end, `==${marker}${content}==`, 2 + marker.length, 2 + marker.length + content.length);
  };
  const queueRecolor = (span: HighlightSpan) => {
    const content = editor.text.slice(span.contentStart, span.contentEnd);
    const newText = `==${marker}${content}==`;
    queue(span.start, span.end, newText, 2 + marker.length, newText.length - 2);
  };

  for (const selection of selections) {
    // 选区（或光标）整体落在某个高亮内（含恰好相等）时只改颜色
    const enclosing = spans.find((span) => selection.start >= span.start && selection.end <= span.end);
    if (enclosing) {
      queueRecolor(enclosing);
      continue;
    }

    if (selection.start === selection.end) {
      queue(selection.start, selection.end, `==${marker}==`, 2 + marker.length, 2 + marker.length);
      continue;
    }

    const firstLine = editor.lineOfOffset(selection.start);
    const lastLine = editor.lineOfOffset(selection.end);
    for (let line = firstLine; line <= lastLine; line++) {
      const lineStart = line === firstLine ? selection.start : editor.lineStartOffset(line);
      const lineEnd = line === lastLine ? selection.end : editor.lineEndOffset(line);
      if (lineStart === lineEnd) {
        continue;
      }

      // 行范围内完整的高亮改色、其余间隙包裹；与行范围边界交叠的高亮保持原样，避免嵌套标记
      let cursor = lineStart;
      let blocked = false;
      for (const span of spans) {
        if (span.end <= lineStart) {
          continue;
        }
        if (span.start >= lineEnd) {
          break;
        }
        if (span.start < cursor || span.end > lineEnd) {
          blocked = true;
          break;
        }
        if (span.start > cursor) {
          queueWrap(cursor, span.start);
        }
        queueRecolor(span);
        cursor = span.end;
      }
      if (!blocked && cursor < lineEnd) {
        queueWrap(cursor, lineEnd);
      }
    }
  }

  return edits.sort((a, b) => a.startOffset - b.startOffset);
}

/**
 * 移除选区/光标处高亮的 == 标记（连同颜色标记），只保留文字内容。
 * 仅处理整体落在某个高亮内的选区/光标，其余情况无法判断该移除哪一个高亮。
 */
export function computeRemoveEdits(
  editor: EditorText,
  spans: HighlightSpan[],
  selections: SelectionOffsets[]
): ColorEdit[] {
  const edits: ColorEdit[] = [];

  for (const selection of selections) {
    const span = spans.find((item) => selection.start >= item.start && selection.end <= item.end);
    if (!span) {
      continue;
    }
    if (edits.some((edit) => span.start < edit.startOffset + edit.oldLength && span.end > edit.startOffset)) {
      continue;
    }

    const content = editor.text.slice(span.contentStart, span.contentEnd);
    edits.push({
      startOffset: span.start,
      oldLength: span.end - span.start,
      newText: content,
      // 锚点相对新文本：保留的文字整体仍在选区里
      anchorStart: 0,
      anchorEnd: content.length,
    });
  }

  return edits.sort((a, b) => a.startOffset - b.startOffset);
}
