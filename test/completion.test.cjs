const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }

  translate(lineDelta, characterDelta) {
    return new Position(this.line + lineDelta, this.character + characterDelta);
  }
}

class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

const disposable = () => ({ dispose() {} });
const vscode = {
  Position,
  Range,
  CompletionTriggerKind: { Invoke: 0, TriggerCharacter: 1, TriggerForIncompleteCompletions: 2 },
  CompletionItemKind: { Color: 15, Snippet: 14 },
  CompletionItem: class {
    constructor(label, kind) {
      this.label = label;
      this.kind = kind;
    }
  },
  SnippetString: class {
    constructor(value) {
      this.value = value;
    }
  },
  TextEdit: { replace: (range, newText) => ({ range, newText }) },
  CodeActionKind: { QuickFix: 'quickfix' },
  l10n: { t: (message) => message },
  window: {
    createTextEditorDecorationType: disposable,
    onDidChangeActiveTextEditor: disposable,
  },
  workspace: {
    onDidChangeTextDocument(listener) {
      this.documentChangeListener = listener;
      return disposable();
    },
    onDidChangeNotebookDocument: disposable,
  },
  commands: { registerCommand: disposable },
  languages: {
    registerCompletionItemProvider(_selector, provider, ...triggers) {
      this.provider = provider;
      this.triggers = triggers;
      return disposable();
    },
    registerCodeActionsProvider: disposable,
  },
};

const extensionPath = path.join(__dirname, '../out/extension.js');
const extensionRequire = createRequire(extensionPath);
const { collectHighlightSpans } = extensionRequire('./markdown-scan');
const extension = {};
vm.runInNewContext(readFileSync(extensionPath, 'utf8'), {
  exports: extension,
  require: (name) => name === 'vscode' ? vscode : extensionRequire(name),
  console: { log() {} },
}, { filename: extensionPath });
extension.activate({ subscriptions: [] });

function complete(input, triggerKind = vscode.CompletionTriggerKind.Invoke) {
  const offset = input.indexOf('|');
  assert.notEqual(offset, -1);
  const text = input.slice(0, offset) + input.slice(offset + 1);
  const lines = text.split('\n');
  const document = {
    languageId: 'markdown',
    getText(range) {
      return range ? text.slice(this.offsetAt(range.start), this.offsetAt(range.end)) : text;
    },
    lineAt(line) {
      return { text: lines[line] };
    },
    offsetAt(position) {
      return lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character;
    },
    positionAt(value) {
      const prefix = text.slice(0, value).split('\n');
      return new Position(prefix.length - 1, prefix.at(-1).length);
    },
  };
  vscode.window.activeTextEditor = { document, selections: [{}] };
  return {
    items: vscode.languages.provider.provideCompletionItems(document, document.positionAt(offset), {}, {
      triggerKind,
      triggerCharacter: triggerKind === vscode.CompletionTriggerKind.TriggerCharacter ? '=' : undefined,
    }),
    document,
  };
}

for (const input of ['red\nr|', 'heading|', '|', '=|', '==red r|==', '==🔴red r|==', '==red== r|']) {
  test(`normal suggestions have no highlight items: ${input}`, () => {
    assert.equal(complete(input).items.length, 0);
  });
}

for (const input of ['=|', 'plain=|text', '==old== plain=|text']) {
  test(`one equals sign has no highlight items: ${input}`, () => {
    assert.equal(complete(input, vscode.CompletionTriggerKind.TriggerCharacter).items.length, 0);
  });
}

for (const triggerKind of Object.values(vscode.CompletionTriggerKind)) {
  test(`double equals inserts seven snippets for trigger kind ${triggerKind}`, () => {
    const { items, document } = complete('prefix ==|suffix', triggerKind);
    assert.equal(items.length, 7);
    assert.equal(items[0].insertText.value, '==$1==');
    assert.equal(items[1].insertText.value, '==🔴$1==');
    for (const item of items) {
      assert.equal(item.kind, vscode.CompletionItemKind.Snippet);
      assert.equal(document.getText(item.range), '==');
      assert.equal(item.filterText, '==');
    }
  });
}

for (const triggerKind of Object.values(vscode.CompletionTriggerKind)) {
  for (const input of ['== |', 'prefix == |suffix', '==ab== |c d==']) {
    test(`space dismisses highlight items for trigger kind ${triggerKind}: ${input}`, () => {
      assert.equal(complete(input, triggerKind).items.length, 0);
    });
  }
}

test('cached recolor items cannot match whitespace after the cursor', () => {
  const { items } = complete('==a b==|c d==', vscode.CompletionTriggerKind.TriggerCharacter);
  assert.equal(items.length, 7);
  for (const item of items) {
    assert.equal(item.filterText, '==a b==');
  }
});

for (const input of ['`==|`', '```\n==|\n```', '```markdown\n==|\n```', '> ```\n> ==|\n> ```', '    ==|']) {
  test(`code has no highlight items: ${input}`, () => {
    assert.equal(complete(input, vscode.CompletionTriggerKind.TriggerCharacter).items.length, 0);
  });
}

for (const input of ['`==ab=|cd==`', '```\n==ab=|cd==\n```', '```markdown\n==ab=|cd==\n```', '> ```\n> ==ab=|cd==\n> ```', '    ==ab=|cd==']) {
  test(`single equals in code has no highlight items: ${input}`, () => {
    assert.equal(complete(input, vscode.CompletionTriggerKind.TriggerCharacter).items.length, 0);
  });
}

for (const triggerKind of Object.values(vscode.CompletionTriggerKind)) {
  for (const [input, content] of [
    ['==This i=|s highlighted text==', 'This is highlighted text'],
    ['==🔴This i=|s highlighted text==', 'This is highlighted text'],
    ['==🔴\uFE0FThis i=|s highlighted text==', 'This is highlighted text'],
    ['===|text==', 'text'],
    ['==text=|==', 'text'],
    ['==a=b c=|d==', 'a=b cd'],
    ['before\n==ab=|cd== after', 'abcd'],
  ]) {
    test(`single equals recolors without nesting for trigger kind ${triggerKind}: ${input}`, () => {
      const { items, document } = complete(input, triggerKind);
      assert.equal(items.length, 7);
      assert.equal(items[0].textEdit.newText, `==${content}==`);
      assert.equal(items[1].textEdit.newText, `==🔴${content}==`);
      for (const item of items) {
        assert.equal(item.kind, vscode.CompletionItemKind.Color);
        assert.equal(item.insertText, undefined);
      }
      const edit = items[1].textEdit;
      const text = document.getText();
      const result = text.slice(0, document.offsetAt(edit.range.start)) + edit.newText +
        text.slice(document.offsetAt(edit.range.end));
      assert.equal(result, input.replace('=|', '').replace(/==(?:🔴\uFE0F?)?/, '==🔴'));
      assert.equal(items[1].detail, input.includes('🔴') ? 'Current' : undefined);
      assert.equal(items[1].filterText, input.slice(document.offsetAt(edit.range.start), input.indexOf('|')));
    });
  }
}

test('double equals recolors a highlight while preserving existing single equals', () => {
  const { items } = complete('==a=b c==|d==', vscode.CompletionTriggerKind.TriggerCharacter);
  assert.equal(items.length, 7);
  assert.equal(items[1].textEdit.newText, '==🔴a=b cd==');
});

test('double equals inside a highlight changes color without nesting', () => {
  const { items, document } = complete('==ab==|cd==', vscode.CompletionTriggerKind.TriggerCharacter);
  assert.equal(items.length, 7);
  assert.equal(items[0].textEdit.newText, '==abcd==');
  assert.equal(items[1].textEdit.newText, '==🔴abcd==');
  assert.equal(document.getText(items[1].textEdit.range), '==ab==cd==');
});

test('double equals after a highlight inserts a new highlight', () => {
  const { items, document } = complete('==old====|', vscode.CompletionTriggerKind.TriggerCharacter);
  assert.equal(items.length, 7);
  assert.equal(items[0].insertText.value, '==$1==');
  assert.equal(document.getText(items[0].range), '==');
});

test('completion provider registers the equals trigger', () => {
  assert.deepEqual(vscode.languages.triggers, ['=']);
});

for (const text of ['==This i=s highlighted text==', '==🔴This i=s highlighted text==', '==🔴\uFE0Fx=y=z==']) {
  test(`editor scanning preserves highlight with single equals: ${text}`, () => {
    const spans = collectHighlightSpans(text);
    assert.equal(spans.length, 1);
    assert.equal(spans[0].start, 0);
    assert.equal(spans[0].end, text.length);
    assert.equal(spans[0].color, text.includes('🔴') ? 'red' : null);
    assert.equal(text.slice(spans[0].contentStart, spans[0].contentEnd),
      text.slice(2, -2).replace(/^🔴\uFE0F?/, ''));
  });
}

for (const input of ['==This i=|s highlighted text==', '==🔴This i=|s highlighted text==']) {
  test(`document changes retain the editor highlight: ${input}`, () => {
    const { document } = complete(input);
    const decorations = [];
    vscode.window.activeTextEditor.setDecorations = (_type, ranges) => decorations.push(...ranges);
    vscode.workspace.documentChangeListener({ document });
    assert.equal(decorations.length, 1);
    assert.equal(document.getText(decorations[0].range), input.replace('|', ''));
  });
}

test('editor scanning keeps adjacent highlights separate at double equals', () => {
  const text = '==a=b====c=d==';
  assert.deepEqual(collectHighlightSpans(text).map((span) => text.slice(span.contentStart, span.contentEnd)),
    ['a=b', 'c=d']);
});

for (const text of ['==a=b\nc==', '==a=b\rc==', '==a=b|c==', '`==a=b==`', '```\n==a=b==\n```']) {
  test(`editor scanning still excludes invalid or code highlights: ${text}`, () => {
    assert.equal(collectHighlightSpans(text).length, 0);
  });
}

test('syntax grammar allows single equals and stops at the first closing delimiter', () => {
  const grammar = JSON.parse(readFileSync(path.join(__dirname, '../syntaxes/highlight.json'), 'utf8'));
  const regex = new RegExp(grammar.patterns[0].match, 'gu');
  assert.deepEqual(Array.from('==This i=s highlighted text== ==🔴x=y=='.matchAll(regex), (match) => match[1]),
    ['This i=s highlighted text', '🔴x=y']);
  assert.equal(regex.test('==a=b\nc=='), false);
});
