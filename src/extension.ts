import * as vscode from "vscode";
import MarkdownIt from "markdown-it";
import { highlightPlugin, defaultColor, defaultRadius, colorEmoji, highlightColors, highlightPalette } from "./highlight-plugin";
import { computeColorEdits, computeRemoveEdits, type ColorEdit } from "./color-edits";
import { collectHighlightSpans, getCodeBlockRanges, getInlineCodeRanges, isInRange } from "./markdown-scan";

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

    for (const span of collectHighlightSpans(editor.document.getText())) {
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
      collectHighlightSpans(adapter.text),
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
      collectHighlightSpans(adapter.text),
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
        const codeBlockRanges = getCodeBlockRanges(text);
        if (isInRange(offset, codeBlockRanges) ||
            isInRange(offset, getInlineCodeRanges(text, codeBlockRanges))) {
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
        const baseSpan = collectHighlightSpans(baseText).find(
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
    const current = collectHighlightSpans(editor.document.getText())
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
        const span = collectHighlightSpans(document.getText())
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
