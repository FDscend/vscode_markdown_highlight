import type MarkdownIt from "markdown-it";

export const defaultColor = "rgba(255, 208, 0, 0.4)";
export const defaultRadius = "5px";

const VARIATION_SELECTOR = "\uFE0F";

/**
 * 颜色标记：必须紧跟在起始 == 之后的表情，只用于指定颜色，本身不渲染（键为表情，值为颜色名）。
 * 出现在其他位置的表情（例如 ==text🔴==）按普通文本渲染。
 */
export const colorMarkers: Record<string, string> = {
  "🔴": "red",
  "🟠": "orange",
  "🟡": "yellow",
  "🟢": "green",
  "🔵": "blue",
  "🟣": "purple",
};

/** 颜色名 → 高亮背景色 */
export const highlightColors: Record<string, string> = {
  red: "color-mix(in oklch, rgb(221, 44, 56) 30%, transparent)",
  orange: "color-mix(in oklch, rgb(222, 116, 23) 30%, transparent)",
  yellow: "color-mix(in oklch, rgb(192, 156, 12) 30%, transparent)",
  green: "color-mix(in oklch, rgb(29, 165, 29) 30%, transparent)",
  blue: "color-mix(in oklch, rgb(23, 117, 217) 30%, transparent)",
  purple: "color-mix(in oklch, rgb(143, 71, 225) 30%, transparent)",
};

/** 读取 str[pos] 处的颜色标记表情，返回颜色名与标记长度（含可选的变体选择符） */
export function readColorMarker(str: string, pos: number): { name: string; length: number } | undefined {
  for (const [emoji, name] of Object.entries(colorMarkers)) {
    if (str.startsWith(emoji, pos)) {
      const length = str.startsWith(emoji + VARIATION_SELECTOR, pos) ? emoji.length + 1 : emoji.length;
      return { name, length };
    }
  }
  return undefined;
}

/**
 * markdown-it plugin: parse ==...== as <mark> highlight.
 * Pure function, no vscode dependency — safe for both extension host and notebook renderer.
 *
 * Uses open/close token pairs so inner content is parsed by the normal inline pipeline,
 * enabling nested markup like ==**bold**== or **==highlight==** to work correctly.
 *
 * 「== + 颜色表情 + 内容==」输出 <mark data-highlight="<color>">，表情被当作颜色标记而省略。
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

    // 颜色标记只识别紧跟 == 之后的表情
    const colorMarker = readColorMarker(state.src, state.pos + 2);

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

        // 标记后没有内容时退化为普通高亮（表情按文本渲染）
        const color = colorMarker && innerStart + colorMarker.length < closingPos ? colorMarker : undefined;
        const contentStart = color ? innerStart + color.length : innerStart;

        // 推入开始 token（mark 标签 + 内联样式）
        const openToken = state.push('highlight_open', 'mark', 1);
        openToken.markup = '==';
        if (color) {
          openToken.attrSet('data-highlight', color.name);
          openToken.attrSet('style', `background-color: ${highlightColors[color.name]}; border-radius: ${defaultRadius}`);
        } else {
          openToken.attrSet('style', `background-color: ${defaultColor}; border-radius: ${defaultRadius}`);
        }

        // 递归解析内层内容（让 **bold** 等嵌套语法正常工作）
        state.pos = contentStart;
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

