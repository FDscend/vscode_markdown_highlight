import * as vscode from "vscode";
import MarkdownIt from "markdown-it";
import { highlightPlugin, defaultColor, defaultRadius, colorMarkers, colorEmoji, highlightColors, highlightPalette } from "./highlight-plugin";
import { computeColorEdits, computeRemoveEdits, type ColorEdit, type HighlightSpan } from "./color-edits";

// 标记高亮文本装饰器
const highlightDecorationType = vscode.window.createTextEditorDecorationType({
  backgroundColor: defaultColor,
  borderRadius: defaultRadius,
});

// 带颜色标记的高亮装饰器（每种颜色一个）
const highlightDecorationTypes: Record<string, vscode.TextEditorDecorationType> = {};
for (const [name, color] of Object.entries(highlightColors)) {
  highlightDecorationTypes[name] = vscode.window.createTextEditorDecorationType({
    backgroundColor: color,
    borderRadius: defaultRadius,
  });
}

// 改进的正则表达式，不匹配包含 | 的内容（避免表格错误匹配）
// 并且不允许跨越换行符
// 捕获组 1 为紧跟在 == 之后的颜色表情（可选），组 2 为高亮内容
const HIGHLIGHT_REGEX = /==([🔴🟠🟡🟢🔵🟣]\uFE0F?)?([^=\n\r|]+)==/gu;

// 颜色命令：菜单、命令面板共用；快捷键不设默认绑定，留待用户自行绑定
const colorCommands: Record<string, string | null> = {
  'markdown-highlight.setColorDefault': null,
  'markdown-highlight.setColorRed': 'red',
  'markdown-highlight.setColorOrange': 'orange',
  'markdown-highlight.setColorYellow': 'yellow',
  'markdown-highlight.setColorGreen': 'green',
  'markdown-highlight.setColorBlue': 'blue',
  'markdown-highlight.setColorPurple': 'purple',
};

export function activate(context: vscode.ExtensionContext) {
  console.log("Markdown highlight extension is now active!");

  // 获取markdown中代码块的范围
  function getCodeBlockRanges(text: string, document: vscode.TextDocument): Array<{ start: number; end: number; language: string; type: string }> {
    const ranges: Array<{ start: number; end: number; language: string; type: string }> = [];
    const lines = text.split('\n');
    let inFencedBlock = false;
    let fenceStart = 0;
    let blockLanguage = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fenceMatch = line.match(/^```(\w*)/);

      if (fenceMatch) {
        if (inFencedBlock) {
          // 代码块结束
          const startOffset = document.offsetAt(new vscode.Position(fenceStart, 0));
          const endOffset = document.offsetAt(new vscode.Position(i + 1, 0));
          ranges.push({ start: startOffset, end: endOffset, language: blockLanguage, type: 'fence' });
          inFencedBlock = false;
        } else {
          // 代码块开始
          inFencedBlock = true;
          fenceStart = i;
          blockLanguage = fenceMatch[1];
        }
      } else if (line.match(/^    /) && !inFencedBlock) {
        // 缩进代码块
        const startOffset = document.offsetAt(new vscode.Position(i, 0));
        const endOffset = document.offsetAt(new vscode.Position(i + 1, 0));
        ranges.push({ start: startOffset, end: endOffset, language: '', type: 'indent' });
      }
    }

    return ranges;
  }

  // 获取行内代码（backticks）的范围，排除代码块内的 backticks
  function getInlineCodeRanges(text: string, document: vscode.TextDocument, codeBlockRanges: Array<{ start: number; end: number; language: string; type: string }>): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    const inlineCodeRegex = /`[^`]*`/g;
    let match;
    
    while ((match = inlineCodeRegex.exec(text))) {
      const matchStart = match.index;
      const matchEnd = match.index + match[0].length;
      
      // 检查该行间代码是否与任何代码块重叠
      // 如果与代码块有重叠，则跳过（因为在代码块内）
      let inCodeBlock = false;
      for (const codeRange of codeBlockRanges) {
        // 范围重叠检查：不是 (b在a的右边 OR a在b的右边)
        if (!(matchEnd <= codeRange.start || matchStart >= codeRange.end)) {
          inCodeBlock = true;
          break;
        }
      }
      
      if (!inCodeBlock) {
        ranges.push({ start: matchStart, end: matchEnd });
      }
    }
    return ranges;
  }

  // 检查位置是否在行内代码中
  function isInInlineCode(offset: number, inlineCodeRanges: Array<{ start: number; end: number }>): boolean {
    for (const range of inlineCodeRanges) {
      if (offset >= range.start && offset < range.end) {
        return true;
      }
    }
    return false;
  }

  // 检查位置是否在代码块中
  function isInCodeBlock(offset: number, codeBlockRanges: Array<{ start: number; end: number; language: string; type: string }>): { inCodeBlock: boolean; language: string; type: string } {
    for (const range of codeBlockRanges) {
      if (offset >= range.start && offset < range.end) {
        return { inCodeBlock: true, language: range.language, type: range.type };
      }
    }
    return { inCodeBlock: false, language: '', type: '' };
  }

  // 收集文档中所有 ==...== 区间（与预览插件同一套规则，忽略代码块与行内代码）
  function collectHighlightSpans(document: vscode.TextDocument, text: string): HighlightSpan[] {
    const codeBlockRanges = getCodeBlockRanges(text, document);
    const inlineCodeRanges = getInlineCodeRanges(text, document, codeBlockRanges);
    const spans: HighlightSpan[] = [];

    // 重置全局正则的 lastIndex，避免状态污染
    HIGHLIGHT_REGEX.lastIndex = 0;

    let match;
    while ((match = HIGHLIGHT_REGEX.exec(text))) {
      const start = match.index;
      const end = start + match[0].length;

      // 检查是否在行内代码中
      if (isInInlineCode(start, inlineCodeRanges) || isInInlineCode(end - 1, inlineCodeRanges)) {
        continue;
      }

      // 检查匹配的开始和结束位置是否都不在代码块中
      const startBlockInfo = isInCodeBlock(start, codeBlockRanges);
      const endBlockInfo = isInCodeBlock(end - 1, codeBlockRanges);

      // 只有当两个标记都不在代码块中时，才高亮
      // 或者都在 markdown 代码块中时，才高亮
      let shouldHighlight = !startBlockInfo.inCodeBlock && !endBlockInfo.inCodeBlock;
      if (startBlockInfo.inCodeBlock && endBlockInfo.inCodeBlock &&
          startBlockInfo.type === endBlockInfo.type &&
          startBlockInfo.language === endBlockInfo.language) {
        shouldHighlight = startBlockInfo.type === 'fence' && startBlockInfo.language === 'markdown';
      }
      if (!shouldHighlight) {
        continue;
      }

      // 捕获组 1 是颜色表情（可能带变体选择符），只有紧跟 == 时才作为颜色标记
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

  // 更新编辑器高亮
  function updateDecorations() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    // 支持 markdown 文件和 notebook 中的 markdown cells
    const isMarkdownFile = editor.document.languageId === "markdown";
    const isNotebookMarkdown = editor.document.languageId === "markdown" && 
                              vscode.window.activeNotebookEditor !== undefined;
    
    if (!isMarkdownFile && !isNotebookMarkdown) {
      return;
    }

    const highlights: vscode.DecorationOptions[] = [];
    const coloredHighlights: Record<string, vscode.DecorationOptions[]> = {};
    for (const name of Object.keys(highlightColors)) {
      coloredHighlights[name] = [];
    }

    for (const span of collectHighlightSpans(editor.document, editor.document.getText())) {
      const decoration = {
        range: new vscode.Range(editor.document.positionAt(span.start), editor.document.positionAt(span.end)),
      };
      if (span.color && coloredHighlights[span.color]) {
        coloredHighlights[span.color].push(decoration);
      } else {
        highlights.push(decoration);
      }
    }

    editor.setDecorations(highlightDecorationType, highlights);
    for (const [name, decorationType] of Object.entries(highlightDecorationTypes)) {
      editor.setDecorations(decorationType, coloredHighlights[name]);
    }
  }

  // 编辑器文本适配与编辑应用（供纯函数使用）
  function getEditorAdapter(document: vscode.TextDocument) {
    return {
      text: document.getText(),
      lineStartOffset: (line: number) => document.offsetAt(new vscode.Position(line, 0)),
      lineEndOffset: (line: number) => document.offsetAt(document.lineAt(line).range.end),
      lineOfOffset: (offset: number) => document.positionAt(offset).line,
    };
  }

  function getSelectionOffsets(editor: vscode.TextEditor) {
    return editor.selections.map((selection) => ({
      start: editor.document.offsetAt(selection.start),
      end: editor.document.offsetAt(selection.end),
    }));
  }

  async function applyEdits(editor: vscode.TextEditor, edits: ColorEdit[]) {
    if (edits.length === 0) {
      return;
    }

    const document = editor.document;
    const applied = await editor.edit((editBuilder) => {
      for (const edit of edits) {
        const range = new vscode.Range(document.positionAt(edit.startOffset), document.positionAt(edit.startOffset + edit.oldLength));
        editBuilder.replace(range, edit.newText);
      }
    });
    if (!applied) {
      return;
    }

    // 编辑后偏移会变化，按顺序累计前面的增量，把锚点映射回新文档
    let shift = 0;
    const updatedSelections: vscode.Selection[] = [];
    for (const edit of edits) {
      const newStart = edit.startOffset + shift;
      shift += edit.newText.length - edit.oldLength;
      const anchorStart = document.positionAt(newStart + edit.anchorStart);
      const anchorEnd = document.positionAt(newStart + edit.anchorEnd);
      updatedSelections.push(new vscode.Selection(anchorStart, anchorEnd));
    }
    editor.selections = updatedSelections;
  }

  // 把颜色应用到当前所有选区/光标处的高亮；colorName 为 null 表示默认颜色（不写颜色标记，仍是默认高亮色）
  async function applyHighlightColor(colorName: string | null) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "markdown") {
      return;
    }

    const adapter = getEditorAdapter(editor.document);
    const edits = computeColorEdits(
      adapter,
      collectHighlightSpans(editor.document, adapter.text),
      getSelectionOffsets(editor),
      colorEmoji(colorName)
    );
    await applyEdits(editor, edits);
  }

  // 移除选区/光标处高亮的 == 标记（连同颜色标记），保留文字
  async function removeHighlight() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "markdown") {
      return;
    }

    const adapter = getEditorAdapter(editor.document);
    const edits = computeRemoveEdits(
      adapter,
      collectHighlightSpans(editor.document, adapter.text),
      getSelectionOffsets(editor)
    );
    await applyEdits(editor, edits);
  }

  // 7 种配色（默认 + 6 色），供补全与选色器共用
  function highlightChoices(): Array<{ name: string | null; label: string; emoji: string }> {
    const labels: Record<string, string> = {
      red: vscode.l10n.t("Red"),
      orange: vscode.l10n.t("Orange"),
      yellow: vscode.l10n.t("Yellow"),
      green: vscode.l10n.t("Green"),
      blue: vscode.l10n.t("Blue"),
      purple: vscode.l10n.t("Purple"),
    };
    return [
      { name: null, label: vscode.l10n.t("Default Color"), emoji: "" },
      ...highlightPalette.map(({ name, emoji }) => ({ name: name as string | null, label: labels[name], emoji })),
    ];
  }

  // 补全：键入 == 时列出颜色，选中即插入带色高亮；手动触发（Ctrl+Space）时可为光标所在高亮改色
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    { language: 'markdown' },
    {
      provideCompletionItems(document, position, _token, context) {
        const text = document.getText();
        const offset = document.offsetAt(position);
        const codeBlockRanges = getCodeBlockRanges(text, document);
        if (isInCodeBlock(offset, codeBlockRanges).inCodeBlock ||
            isInInlineCode(offset, getInlineCodeRanges(text, document, codeBlockRanges))) {
          return [];
        }

        const choices = highlightChoices();
        // filterPrefix 必须包含 item.range 覆盖的已输入文本，否则该项会被 VS Code 的过滤前缀规则丢弃
        const itemFor = (choice: { name: string | null; label: string; emoji: string }, index: number, sortText: string, filterPrefix: string) => {
          const label = choice.emoji ? `${choice.emoji} ${choice.label}` : choice.label;
          const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Color);
          item.sortText = sortText;
          item.filterText = `${filterPrefix}${label}`;
          return item;
        };

        // 触发字符路径下，光标前的连续 = 是刚键入的；据此还原"键入之前"的文本，
        // 才能判断光标本来就在某个高亮内（此时应改色而不是再插入一段高亮）
        const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
        const trailingEquals = /(=*)$/.exec(linePrefix)?.[1].length ?? 0;
        const typedLength = context.triggerKind === vscode.CompletionTriggerKind.Invoke ? 0 : Math.min(2, trailingEquals);
        const baseText = typedLength > 0 ? text.slice(0, offset - typedLength) + text.slice(offset) : text;
        // 右端取开区间：光标正好在某个高亮之后时，应视为在该高亮之外（插入新标记而非改上一个的颜色）
        const baseSpan = collectHighlightSpans(document, baseText).find(
          (item) => offset - typedLength >= item.start && offset - typedLength < item.end
        );

        // 1) 光标本就在某个高亮内（含刚在该高亮内键入 =）：改成对应颜色，刚键入的 = 一并替换掉
        if (baseSpan) {
          const range = new vscode.Range(document.positionAt(baseSpan.start), document.positionAt(baseSpan.end + typedLength));
          const content = baseText.slice(baseSpan.contentStart, baseSpan.contentEnd);
          return choices.map((choice, index) => {
            const item = itemFor(choice, index, String(index).padStart(2, '0'), document.getText(range));
            item.textEdit = vscode.TextEdit.replace(range, `==${colorEmoji(choice.name)}${content}==`);
            if (baseSpan.color === choice.name) {
              item.detail = vscode.l10n.t("Current");
            }
            return item;
          });
        }

        // 2) 刚键入 == 且不在高亮内：插入一对带色标记，光标停在内容处
        if (typedLength === 2) {
          const range = new vscode.Range(position.translate(0, -2), position);
          return choices.map((choice, index) => {
            const marker = colorEmoji(choice.name);
            const item = itemFor(choice, index, String(index).padStart(2, '0'), document.getText(range));
            item.kind = vscode.CompletionItemKind.Snippet;
            item.range = range;
            item.insertText = new vscode.SnippetString(`==${marker}$1==`);
            item.detail = `==${marker}…==`;
            return item;
          });
        }

        // 3) 手动触发（Ctrl+Space）、单个光标、不在高亮内：在光标处插入，排在其它补全项之后
        const editor = vscode.window.activeTextEditor;
        if (context.triggerKind !== vscode.CompletionTriggerKind.Invoke ||
            !editor || editor.document !== document || editor.selections.length !== 1) {
          return [];
        }

        const range = new vscode.Range(position, position);
        return choices.map((choice, index) => {
          const marker = colorEmoji(choice.name);
          const item = itemFor(choice, index, `zz${String(index).padStart(2, '0')}`, '');
          item.kind = vscode.CompletionItemKind.Snippet;
          item.range = range;
          item.insertText = new vscode.SnippetString(`==${marker}$1==`);
          item.detail = `==${marker}…==`;
          return item;
        });
      },
    },
    '='
  );

  // 选择颜色（命令面板 / 代码操作共用）：列出 7 种配色
  async function pickHighlightColor() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "markdown") {
      return;
    }

    const cursor = editor.document.offsetAt(editor.selection.active);
    const current = collectHighlightSpans(editor.document, editor.document.getText())
      .find((span) => cursor >= span.start && cursor <= span.end);

    const items: Array<vscode.QuickPickItem & { colorName: string | null }> = highlightChoices().map((choice) => ({
      label: choice.emoji ? `${choice.emoji} ${choice.label}` : `$(circle-filled) ${choice.label}`,
      description: current?.color === choice.name ? vscode.l10n.t("Current") : undefined,
      colorName: choice.name,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      title: vscode.l10n.t("Highlight Color"),
      placeHolder: vscode.l10n.t("Pick a color for the markdown highlight at the cursor"),
    });
    if (picked) {
      await applyHighlightColor(picked.colorName);
    }
  }

  // 光标/选区在高亮内时提供灯泡操作
  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    { language: 'markdown' },
    {
      provideCodeActions(document, range) {
        const startOffset = document.offsetAt(range.start);
        const endOffset = document.offsetAt(range.end);
        const span = collectHighlightSpans(document, document.getText())
          .find((item) => startOffset >= item.start && endOffset <= item.end);
        if (!span) {
          return [];
        }

        const pickTitle = vscode.l10n.t("Change highlight color...");
        const pickAction = new vscode.CodeAction(pickTitle, vscode.CodeActionKind.QuickFix);
        pickAction.isPreferred = true;
        pickAction.command = { command: 'markdown-highlight.pickColor', title: pickTitle };
        const actions = [pickAction];

        if (span.color) {
          const defaultTitle = vscode.l10n.t("Use default color");
          const defaultAction = new vscode.CodeAction(defaultTitle, vscode.CodeActionKind.QuickFix);
          defaultAction.command = { command: 'markdown-highlight.setColorDefault', title: defaultTitle };
          actions.push(defaultAction);
        }

        const removeTitle = vscode.l10n.t("Remove Highlight");
        const removeAction = new vscode.CodeAction(removeTitle, vscode.CodeActionKind.QuickFix);
        removeAction.command = { command: 'markdown-highlight.removeHighlight', title: removeTitle };
        actions.push(removeAction);

        return actions;
      },
    },
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
  );

  // 初始更新
  updateDecorations();

  // 监听文档变化和编辑器切换
  const disposables = [
    codeActionProvider,
    completionProvider,
    ...Object.entries(colorCommands).map(([commandId, color]) =>
      vscode.commands.registerCommand(commandId, () => applyHighlightColor(color))
    ),
    vscode.commands.registerCommand('markdown-highlight.pickColor', () => pickHighlightColor()),
    vscode.commands.registerCommand('markdown-highlight.removeHighlight', () => removeHighlight()),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        // 支持 markdown 文件和 notebook 中的 markdown cells
        if (editor.document.languageId === "markdown" || 
            vscode.window.activeNotebookEditor !== undefined) {
          updateDecorations();
        }
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        // 支持 markdown 文件和 notebook 中的 markdown cells
        if ((event.document === activeEditor.document && 
             activeEditor.document.languageId === "markdown") ||
            vscode.window.activeNotebookEditor !== undefined) {
          updateDecorations();
        }
      }
    }),
    // 监听 notebook 的编辑事件
    vscode.workspace.onDidChangeNotebookDocument?.((event) => {
      // 当 notebook 内容改变时，更新活动编辑器的装饰
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor && activeEditor.document.languageId === "markdown" && 
          vscode.window.activeNotebookEditor !== undefined) {
        updateDecorations();
      }
    }) || null,
  ].filter((item): item is vscode.Disposable => item !== null);

  // 注册命令到context.subscriptions
  context.subscriptions.push(...disposables);

  return {
    extendMarkdownIt(md: MarkdownIt) {
      return highlightPlugin(md);
    }
  };
}

export function deactivate() {
  highlightDecorationType.dispose();
  for (const decorationType of Object.values(highlightDecorationTypes)) {
    decorationType.dispose();
  }
}
