# markdown-highlight-mark

| [English version](https://github.com/FDscend/vscode_markdown_highlight/blob/main/README.md) | [中文版本](https://github.com/FDscend/vscode_markdown_highlight/blob/main/README.zh.md) |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |

Support for highlight syntax `==...==` in Markdown previews, including Jupyter Notebook previews.

## Demo

![](https://raw.githubusercontent.com/FDscend/vscode_markdown_highlight/refs/heads/main/example/test_md.png)

<p align="center">Markdown preview example</p>

![](https://raw.githubusercontent.com/FDscend/vscode_markdown_highlight/refs/heads/main/example/test_ipynb.png)

<p align="center">Jupyter Notebook preview example</p>

## Usage

### Basic

Basic: `==this is highlighted==`

Nested: `==**bold highlighted**==` or `**==bold highlighted==**`

### Keybinding

| Shortcut           | Action                                |
| ------------------ | ------------------------------------- |
| `Ctrl + Shift + =` | Wrap the selected text with `==...==` |

> Note: The keybinding may conflict with other extensions or VS Code features. Adjust in settings if needed.

### Context menu

- Use the editor context menu item "Wrap Selection with Highlight" to wrap selected text.

## Installation

- You can install the extension from the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=FDscend.markdown-highlight-mark) or by searching for "markdown highlight mark" in the Extensions view in VS Code.
- Alternatively, you can download the extension from the [Releases](https://github.com/FDscend/vscode_markdown_highlight/releases/latest) page on GitHub.
