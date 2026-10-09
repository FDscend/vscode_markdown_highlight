# markdown-highlight-mark

| [English version](https://github.com/FDscend/vscode_markdown_highlight/blob/main/README.md) | [中文版本](https://github.com/FDscend/vscode_markdown_highlight/blob/main/README.zh.md) |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |

为 Obsidian 的高亮语法 `==...==` 提供支持，包括 markdown 文件和 Jupyter Notebook 的预览，并可选用六种颜色。

## 效果展示

![](https://raw.githubusercontent.com/FDscend/vscode_markdown_highlight/refs/heads/main/example/test_md.png)

<p align="center">Markdown 预览效果示例</p>

![](https://raw.githubusercontent.com/FDscend/vscode_markdown_highlight/refs/heads/main/example/test_ipynb.png)

<p align="center">Jupyter Notebook 预览效果示例</p>

## 使用方法

### 基本使用

基本: `==这是高亮==`

嵌套: `==**粗体高亮**==` 或者 `**==粗体高亮==**`

### 颜色

在起始 `==` 之后紧跟一个颜色表情即可指定颜色：

| 颜色 | 语法             | 预览           |
| ---- | ---------------- | -------------- |
| 红色 | `==🔴重要==`     | ==🔴重要==     |
| 橙色 | `==🟠待跟进==`   | ==🟠待跟进==   |
| 黄色 | `==🟡记住这点==` | ==🟡记住这点== |
| 绿色 | `==🟢已完成==`   | ==🟢已完成==   |
| 蓝色 | `==🔵参考资料==` | ==🔵参考资料== |
| 紫色 | `==🟣想法==`     | ==🟣想法==     |

表情只作为颜色标记：`==🔴重要==` 会渲染成 `<mark data-highlight="red">重要</mark>`，表情本身不显示。它必须紧跟在起始 `==` 之后；写在别处（例如 `==重要🔴==`）会当作普通文本，高亮使用默认颜色。

### 不用手敲表情的三种方式

**自动补全** —— 在 markdown 编辑器里键入 `==`，在补全列表中选择颜色：

![](https://raw.githubusercontent.com/FDscend/vscode_markdown_highlight/refs/heads/main/example/complete.gif)

**右键菜单** —— 选中文本后右键选择 "高亮选中文本"，再选颜色：

![](https://raw.githubusercontent.com/FDscend/vscode_markdown_highlight/refs/heads/main/example/menu.gif)

**快速修复** —— 光标停在高亮内，点灯泡即可修改颜色、改回默认颜色或移除高亮：

![](https://raw.githubusercontent.com/FDscend/vscode_markdown_highlight/refs/heads/main/example/quick_fix.gif)

以上方式对已有高亮同样有效：给已经在 `==...==` 内的文本指定颜色只会改颜色，不会嵌套出新的标记；"移除高亮" 会删掉两侧 `==` 并保留文字。

### 快捷键

| 快捷键             | 功能                                                     |
| ------------------ | -------------------------------------------------------- |
| `Ctrl + Shift + =` | 用默认颜色高亮选中文本（未选中时在光标处开始一个新高亮） |

> 注意：快捷键可能会与其他扩展或 vscode 功能冲突，请根据需要调整快捷键设置。

### 手写 HTML

直接写 HTML 时，`data-highlight` 属性同样会被预览着色（不需要表情）：

```html
<mark data-highlight="red">重要</mark>
```

## 安装方法

- 你可以从 [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=FDscend.markdown-highlight-mark) 安装此扩展，或者在 VS Code 的扩展视图中搜索 "markdown highlight mark"。
- 另外，你也可以从 GitHub 的 [Releases](https://github.com/FDscend/vscode_markdown_highlight/releases/latest) 页面下载此扩展。
