import * as vscode from "vscode";
import MarkdownIt from "markdown-it";
import { highlightPlugin, defaultColor, defaultRadius } from "./highlight-plugin";

// 标记高亮文本装饰器
const highlightDecorationType = vscode.window.createTextEditorDecorationType({
  backgroundColor: defaultColor,
  borderRadius: defaultRadius,
});

// 改进的正则表达式，不匹配包含 | 的内容（避免表格错误匹配）
// 并且不允许跨越换行符
const HIGHLIGHT_REGEX = /==([^=\n\r|]+)==/g;

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

    const text = editor.document.getText();
    const codeBlockRanges = getCodeBlockRanges(text, editor.document);
    const inlineCodeRanges = getInlineCodeRanges(text, editor.document, codeBlockRanges);
    const highlights: vscode.DecorationOptions[] = [];
    let match;

    // 重置全局正则的 lastIndex，避免状态污染
    HIGHLIGHT_REGEX.lastIndex = 0;
    
    while ((match = HIGHLIGHT_REGEX.exec(text))) {
      const matchStart = match.index;
      const matchEnd = match.index + match[0].length;
      
      // 检查是否在行内代码中
      if (isInInlineCode(matchStart, inlineCodeRanges) || isInInlineCode(matchEnd - 1, inlineCodeRanges)) {
        continue;
      }
      
      // 检查匹配的开始和结束位置是否都不在代码块中
      const startBlockInfo = isInCodeBlock(matchStart, codeBlockRanges);
      const endBlockInfo = isInCodeBlock(matchEnd - 1, codeBlockRanges);

      // 只有当两个标记都不在代码块中时，才高亮
      // 或者都在 markdown 代码块中时，才高亮
      let shouldHighlight = !startBlockInfo.inCodeBlock && !endBlockInfo.inCodeBlock;
      if (startBlockInfo.inCodeBlock && endBlockInfo.inCodeBlock && 
          startBlockInfo.type === endBlockInfo.type && 
          startBlockInfo.language === endBlockInfo.language) {
        shouldHighlight = startBlockInfo.type === 'fence' && startBlockInfo.language === 'markdown';
      }

      if (shouldHighlight) {
        const startPos = editor.document.positionAt(matchStart);
        const endPos = editor.document.positionAt(matchEnd);
        const decoration = {
          range: new vscode.Range(startPos, endPos),
        };
        highlights.push(decoration);
      }
    }

    editor.setDecorations(highlightDecorationType, highlights);
  }

  // 初始更新
  updateDecorations();

  // 注册命令：用高亮标记包装选中的文本
  const wrapCommand = vscode.commands.registerCommand('markdown-highlight.wrapWithHighlight', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "markdown") {
      return;
    }

    // 遍历所有选中的范围
    editor.edit((editBuilder) => {
      for (const selection of editor.selections) {
        // 检查选中范围是否在同一行
        if (selection.start.line === selection.end.line && !selection.isEmpty) {
          const selectedText = editor.document.getText(selection);
          // 用 == 包装选中的文本
          editBuilder.replace(selection, `==${selectedText}==`);
        }
      }
    });
  });

  // 快捷键 Ctrl+Shift+= 触发
  const textEditorCommand = vscode.commands.registerCommand('markdown-highlight.insertEqualsSign', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "markdown") {
      return;
    }

    const selection = editor.selection;
    
    // 如果有选中文本且在同一行
    if (!selection.isEmpty && selection.start.line === selection.end.line) {
      const selectedText = editor.document.getText(selection);
      
      editor.edit((editBuilder) => {
        // 替换选中的文本为 ==text==
        editBuilder.replace(selection, `==${selectedText}==`);
      });
    } else {
      // 没有选中，或者跨行，直接插入 ==
      editor.edit((editBuilder) => {
        editBuilder.insert(editor.selection.active, '==');
      });
    }
  });

  // 监听文档变化和编辑器切换
  const disposables = [
    wrapCommand,
    textEditorCommand,
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
}
