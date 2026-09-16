#!/usr/bin/env python3
"""把中英两份隐私权政策合成可公开托管的双语页面。

用法：
    python3 tools/build-privacy-page.py

产出两份，因为两种托管方式吃的格式不同：

- `docs/privacy-policy.html` —— 放 **GitHub Pages**（或任何静态托管）。
  自包含，没有外链 CSS/JS/字体，拷一个文件就能跑。
- `docs/privacy-policy.gist.md` —— 放 **Gist**。Gist 会渲染 Markdown，
  但**不会渲染 HTML**（.html 传上去只显示源码），所以给 Gist 单独出一份。

**为什么不手写 HTML**：政策正文以 `docs/privacy-policy.md` 与 `.en.md` 为准，
手写一份 HTML 就会有第三个副本，改政策时必然漏改。这里从 md 生成，保证同源。

只支持这两份文档实际用到的 Markdown 子集：标题、段落、无序列表、表格、
`**粗体**`、`` `行内代码` ``。遇到没见过的语法会当普通段落处理，不会静默丢内容。
"""
from __future__ import annotations

import html
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ZH = ROOT / 'docs' / 'privacy-policy.md'
EN = ROOT / 'docs' / 'privacy-policy.en.md'
OUT_HTML = ROOT / 'docs' / 'privacy-policy.html'
OUT_GIST = ROOT / 'docs' / 'privacy-policy.gist.md'

# 与商店截图、宣传图块同一套配色，取自扩展侧栏顶栏
BG = '#b8e1e4'
INK = '#12332e'
MUTED = '#3a5c57'


def inline(text: str) -> str:
    """行内标记。先转义再替换，正文里的 < & 不会破坏结构。"""
    out = html.escape(text)
    out = re.sub(r'`([^`]+)`', r'<code>\1</code>', out)
    out = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', out)
    return out


def render_table(rows: list[str]) -> str:
    """Markdown 表格。第二行是 |---|---| 分隔线，跳过。"""
    cells = [[c.strip() for c in r.strip().strip('|').split('|')] for r in rows]
    head, body = cells[0], cells[2:]
    thead = ''.join(f'<th>{inline(c)}</th>' for c in head)
    tbody = ''.join(
        '<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in row) + '</tr>' for row in body
    )
    return f'<table><thead><tr>{thead}</tr></thead><tbody>{tbody}</tbody></table>'


def to_html(markdown: str) -> str:
    blocks: list[str] = []
    for raw in re.split(r'\n\s*\n', markdown.strip()):
        lines = [ln for ln in raw.strip().split('\n') if ln.strip()]
        if not lines:
            continue

        heading = re.match(r'^(#{1,3})\s+(.*)$', lines[0])
        if heading and len(lines) == 1:
            level = len(heading.group(1))
            blocks.append(f'<h{level}>{inline(heading.group(2))}</h{level}>')
            continue

        if all(ln.lstrip().startswith('|') for ln in lines) and len(lines) >= 2:
            blocks.append(render_table(lines))
            continue

        if all(ln.lstrip().startswith('- ') for ln in lines):
            items = ''.join(f'<li>{inline(ln.lstrip()[2:])}</li>' for ln in lines)
            blocks.append(f'<ul>{items}</ul>')
            continue

        blocks.append(f'<p>{inline(" ".join(lines))}</p>')
    return '\n'.join(blocks)


PAGE = """<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reshelve Privacy Policy / 隐私权政策</title>
<style>
  :root {{ color-scheme: light dark; }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; padding: 0 20px 80px;
    font: 17px/1.75 -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue",
          "PingFang SC", "Microsoft YaHei", sans-serif;
    color: {ink}; background: #fff;
  }}
  main {{ max-width: 720px; margin: 0 auto; }}
  header {{
    background: {bg}; margin: 0 -20px 44px; padding: 34px 20px;
    border-bottom: 1px solid rgba(18,51,46,.12);
  }}
  header div {{ max-width: 720px; margin: 0 auto; }}
  .brand {{ font-size: 15px; font-weight: 700; letter-spacing: .04em;
            text-transform: uppercase; color: {muted}; margin: 0 0 6px; }}
  .switch {{ margin-top: 18px; }}
  .switch button {{
    font: inherit; font-size: 15px; cursor: pointer;
    padding: 7px 16px; margin-right: 8px; border-radius: 999px;
    border: 1px solid rgba(18,51,46,.25); background: transparent; color: {ink};
  }}
  .switch button[aria-pressed="true"] {{ background: {ink}; color: {bg}; border-color: {ink}; }}
  h1 {{ font-size: 30px; line-height: 1.3; margin: 0; }}
  h2 {{ font-size: 22px; margin: 44px 0 14px; padding-top: 22px;
        border-top: 1px solid rgba(18,51,46,.14); }}
  h3 {{ font-size: 18px; margin: 30px 0 10px; }}
  section > h1 {{ display: none; }}
  p, ul {{ margin: 0 0 16px; }}
  li {{ margin-bottom: 8px; }}
  code {{
    font: 15px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    background: rgba(18,51,46,.07); padding: 2px 6px; border-radius: 4px;
  }}
  .wrap {{ overflow-x: auto; }}
  table {{ border-collapse: collapse; width: 100%; margin: 0 0 20px; font-size: 15.5px; }}
  th, td {{ border: 1px solid rgba(18,51,46,.18); padding: 9px 12px;
            text-align: left; vertical-align: top; }}
  th {{ background: rgba(184,225,228,.42); font-weight: 700; }}
  @media (prefers-color-scheme: dark) {{
    body {{ background: #10201f; color: #dcecea; }}
    header {{ background: #17302e; border-bottom-color: rgba(220,236,234,.14); }}
    .brand {{ color: #8fb3ae; }}
    h2 {{ border-top-color: rgba(220,236,234,.16); }}
    .switch button {{ border-color: rgba(220,236,234,.3); color: #dcecea; }}
    .switch button[aria-pressed="true"] {{ background: {bg}; color: {ink}; border-color: {bg}; }}
    code {{ background: rgba(220,236,234,.1); }}
    th, td {{ border-color: rgba(220,236,234,.2); }}
    th {{ background: rgba(184,225,228,.12); }}
  }}
</style>

<header><div>
  <p class="brand">Reshelve</p>
  <h1 id="title">Privacy Policy</h1>
  <div class="switch" id="switch" hidden>
    <button type="button" data-lang="en" aria-pressed="true">English</button>
    <button type="button" data-lang="zh" aria-pressed="false">中文</button>
  </div>
</div></header>

<main>
<section id="en" lang="en">
{en}
</section>
<section id="zh" lang="zh-Hans">
{zh}
</section>
</main>

<script>
  // 没有 JS 时两种语言都完整显示，切换器藏起来——审核员看到的永远是全文。
  var TITLES = {{ en: 'Privacy Policy', zh: '隐私权政策' }};
  var LANGS = {{ en: 'en', zh: 'zh-Hans' }};
  var sw = document.getElementById('switch');
  sw.hidden = false;
  function show(lang) {{
    ['en', 'zh'].forEach(function (l) {{ document.getElementById(l).hidden = l !== lang; }});
    sw.querySelectorAll('button').forEach(function (b) {{
      b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    }});
    document.getElementById('title').textContent = TITLES[lang];
    document.documentElement.lang = LANGS[lang];
  }}
  sw.addEventListener('click', function (e) {{
    if (e.target.dataset.lang) show(e.target.dataset.lang);
  }});
  show(navigator.language && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en');
</script>
</html>
"""

GIST = """{en}

---

{zh}
"""


def main() -> None:
    for path in (ZH, EN):
        if not path.exists():
            print(f'✗ 找不到 {path}', file=sys.stderr)
            sys.exit(1)

    zh_md, en_md = ZH.read_text('utf-8'), EN.read_text('utf-8')

    # 表格在窄屏上会撑破版心，套一层可横向滚动的容器
    zh_html = to_html(zh_md).replace('<table>', '<div class="wrap"><table>') \
                            .replace('</table>', '</table></div>')
    en_html = to_html(en_md).replace('<table>', '<div class="wrap"><table>') \
                            .replace('</table>', '</table></div>')

    OUT_HTML.write_text(
        PAGE.format(en=en_html, zh=zh_html, bg=BG, ink=INK, muted=MUTED), 'utf-8'
    )
    OUT_GIST.write_text(GIST.format(en=en_md.strip(), zh=zh_md.strip()), 'utf-8')

    print(f'✓ {OUT_HTML.relative_to(ROOT)}   GitHub Pages / 任意静态托管')
    print(f'✓ {OUT_GIST.relative_to(ROOT)}   Gist（Gist 不渲染 HTML，只渲染 Markdown）')


if __name__ == '__main__':
    main()
