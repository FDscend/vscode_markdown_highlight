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
    onDidChangeTextDocument: disposable,
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

for (const input of ['=|', '==red=|==']) {
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
