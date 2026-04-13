import type MarkdownIt from "markdown-it";

export const defaultColor = "rgba(255, 208, 0, 0.4)";
export const defaultRadius = "5px";

/**
 * markdown-it plugin: parse ==...== as <mark> highlight.
 * Pure function, no vscode dependency — safe for both extension host and notebook renderer.
 *
 * Uses open/close token pairs so inner content is parsed by the normal inline pipeline,
 * enabling nested markup like ==**bold**== or **==highlight==** to work correctly.
 */
export function highlightPlugin(md: MarkdownIt): MarkdownIt {
  md.inline.ruler.push('highlight', (state: any, silent: boolean) => {
    // 当前字符不是 = 则提前退出
    if (state.src.charCodeAt(state.pos) !== 0x3D /* = */) return false;
    if (state.src.charCodeAt(state.pos + 1) !== 0x3D) return false;

    // 检查当前位置是否在行内代码（backtick）内
    const backtickRegex = /`[^`]*`/g;
    let match;
    const backtickRanges: Array<{ start: number; end: number }> = [];
    while ((match = backtickRegex.exec(state.src))) {
      backtickRanges.push({ start: match.index, end: match.index + match[0].length });
    }
    for (const range of backtickRanges) {
      if (state.pos >= range.start && state.pos < range.end) {
        return false;
      }
    }

    // 查找结束 ==
    let pos = state.pos + 2;
    const max = state.posMax;

    while (pos < max) {
      if (state.src.charCodeAt(pos) === 0x3D && state.src.charCodeAt(pos + 1) === 0x3D) {
        // 范围内奇数个 backtick 说明有未闭合行内代码，继续搜索
        let backtickCount = 0;
        for (let i = state.pos + 2; i < pos; i++) {
          if (state.src.charCodeAt(i) === 0x60) backtickCount++;
        }
        if (backtickCount % 2 === 1) {
          pos++;
          continue;
        }

        if (silent) return true;

        const closingPos = pos;
        const innerStart = state.pos + 2;
        const oldMax = state.posMax;

        // 推入开始 token（mark 标签 + 内联样式）
        const openToken = state.push('highlight_open', 'mark', 1);
        openToken.markup = '==';
        openToken.attrSet('style', `background-color: ${defaultColor}; border-radius: ${defaultRadius}`);

        // 递归解析内层内容（让 **bold** 等嵌套语法正常工作）
        state.pos = innerStart;
        state.posMax = closingPos;
        state.md.inline.tokenize(state);

        // 推入结束 token
        state.push('highlight_close', 'mark', -1).markup = '==';

        // 跳过结束 == 并恢复 posMax
        state.pos = closingPos + 2;
        state.posMax = oldMax;

        return true;
      }
      pos++;
    }

    return false;
  });

  // 不需要自定义 renderer rule：markdown-it 默认的 renderToken
  // 会将 highlight_open/highlight_close 直接输出为 <mark ...> / </mark>

  return md;
}

