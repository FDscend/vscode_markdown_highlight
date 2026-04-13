import type { RendererContext } from 'vscode-notebook-renderer';
import type MarkdownIt from 'markdown-it';
import { highlightPlugin } from './highlight-plugin';

// tsup 以 text loader 内联 CSS 字符串
// @ts-expect-error css imported as text by tsup
import highlightCss from '../media/highlight.css';

export async function activate(ctx: RendererContext<void>) {
  const markdownItRenderer = (await ctx.getRenderer('vscode.markdown-it-renderer')) as undefined | any;
  if (!markdownItRenderer) {
    throw new Error(`Could not load 'vscode.markdown-it-renderer'`);
  }

  // 向 notebook iframe 注入样式（必须用 <template class="markdown-style">）
  const style = document.createElement('style');
  style.textContent = highlightCss as string;
  const template = document.createElement('template');
  template.classList.add('markdown-style');
  template.content.appendChild(style);
  document.head.appendChild(template);

  markdownItRenderer.extendMarkdownIt((md: MarkdownIt) => highlightPlugin(md));

  return markdownItRenderer;
}
