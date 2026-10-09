# Change Log

## [0.0.1] - 2025-10-21

- Initial release

## [0.0.2] - 2026-4-13

- Fix incorrect highlight positions in the code view.
- Add support for Jupyter Notebook previews.
- Add a keyboard shortcut and an editor context menu for wrapping selection with highlight.

## [0.0.3] - 2026-10-10

- Add six highlight colors: a color emoji right after the opening `==` (e.g. `==🔴Important==`) renders as `<mark data-highlight="red">Important</mark>`. The emoji is treated as a color marker only and is not rendered; anywhere else it stays normal text.
- Show colored highlights in the editor as well, using the same palette as the preview.
- Add an editor context menu submenu "Highlight Selected Text" with the default color, the six colors, and "Remove Highlight" (this replaces the previous "Wrap Selection with Highlight" item).
- Add quick fixes (lightbulb) inside a highlight: change its color, switch back to the default color, or remove the highlight.
- Add autocomplete: type `==` to pick a color, which inserts the marker and places the cursor inside the highlight. Nothing is suggested inside code blocks or inline code.
- Rebind `Ctrl + Shift + =` to highlighting with the default color; applying it to text inside an existing highlight changes that highlight instead of nesting a new one.
- Remove the `highlight` snippet, now superseded by the color autocomplete.
- Style hand-written `<mark data-highlight="...">` markup via CSS as a fallback.
