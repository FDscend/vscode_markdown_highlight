# markdown-highlight-mark

| [English version](https://github.com/FDscend/vscode_markdown_highlight/blob/main/README.md) | [中文版本](https://github.com/FDscend/vscode_markdown_highlight/blob/main/README.zh.md) |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |

Support for highlight syntax `==...==` in Markdown previews, including Jupyter Notebook previews.

## Demo

<figure>
  <img src="https://raw.githubusercontent.com/FDscend/vscode_markdown_highlight/refs/heads/main/example/test_md.png" alt="Markdown preview example">
  <figcaption align="center">Markdown preview example</figcaption>
</figure>

<figure>
  <img src="https://raw.githubusercontent.com/FDscend/vscode_markdown_highlight/refs/heads/main/example/test_ipynb.png" alt="Jupyter Notebook preview example">
  <figcaption align="center">Jupyter Notebook preview example</figcaption>
</figure>

## Usage

### Basic

Basic: `==this is highlighted==`

Nested: `==**bold highlighted**==`

### Keybinding

| Shortcut           | Action                                |
| ------------------ | ------------------------------------- |
| `Ctrl + Shift + =` | Wrap the selected text with `==...==` |

> Note: The keybinding may conflict with other extensions or VS Code features. Adjust in settings if needed.

### Context menu

- Use the editor context menu item "Wrap Selection with Highlight" to wrap selected text.
