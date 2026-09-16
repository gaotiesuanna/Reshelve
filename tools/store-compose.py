#!/usr/bin/env python3
"""把竖长的侧栏截图合成为商店要求的 1280×800。

用法：
    python3 tools/store-compose.py 面板截图.png 输出.png \
        --headline "You pick the scope" \
        --subline "Unchecked folders are never read and never modified."

**为什么合成而不是裁剪**：侧栏截图的宽高比约 0.44，而商店要求 1.60。
硬裁只能取一条很窄的横带，再放大近 2 倍才够 1280 宽——截图里全是文字，
放大必糊，而商店页上文字能不能看清直接决定转化。

改为把整块面板等比**缩小**到画布高度（缩小不失真），放在右侧，
左侧留出的空间放一句话说明。这也是应用商店截图的通行做法。
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

from PIL import Image, ImageDraw, ImageFont

CANVAS = (1280, 800)
# 取自扩展侧栏顶栏的实际颜色，让画布和产品本身是一套配色
BG = (184, 225, 228)
INK = (18, 51, 46)
MUTED = (58, 92, 87)

FONT_BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
FONT_REGULAR = '/System/Library/Fonts/Supplemental/Arial.ttf'

# Arial 没有中文字形，中文文案套上去每个字都是方框（tofu）。这一份是本机自带的
# 黑体，W6/W3 两个字重分别顶 Arial Bold/Regular 的位置。index 见字体内部的
# 子字体表：0 = W3（常规），2 = W6（较粗，比真正的 Bold 略轻，但这个字重家族
# 没有更粗的可选，够用）。选它不选系统里同样有的 STHeiti：西文数字与符号的
# 字面更接近 Arial 的比例，中英文案混排（比如后续要是加了品牌词）不会一半宽一半窄。
FONT_BOLD_CJK = '/System/Library/Fonts/Hiragino Sans GB.ttc'
FONT_BOLD_CJK_INDEX = 2
FONT_REGULAR_CJK = '/System/Library/Fonts/Hiragino Sans GB.ttc'
FONT_REGULAR_CJK_INDEX = 0

MARGIN = 48
GAP = 56

CJK_RE = re.compile(r'[一-鿿]')


def is_cjk(text: str) -> bool:
    return CJK_RE.search(text) is not None


def load_font(bold: bool, size: int, cjk: bool) -> ImageFont.FreeTypeFont:
    if cjk:
        path, index = (FONT_BOLD_CJK, FONT_BOLD_CJK_INDEX) if bold else (FONT_REGULAR_CJK, FONT_REGULAR_CJK_INDEX)
        return ImageFont.truetype(path, size, index=index)
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REGULAR, size)



# 中文排版禁则：这些字符不能挂在一行的开头——句末点号跟在它收尾的那句话后面，
# 单独领起下一行时，视觉上就是一个孤零零的符号飘在行首（句号在部分字体里画成
# 一个空心圆，缺乏上下文时看着像个错误的项目符号，而不是标点）。
CJK_NO_LEAD = set('。，、；：！？」』）】》〉”’,.!?;:)')

# 中文文案里常常夹着英文词（GitHub、Chrome……）。逐字符断行对纯中文是对的，
# 但直接 `list(text)` 会把这些词也拆成单字符，断点可能落在词中间——
# 第一版就是这么把 "Chrome" 断成了 "Chro" / "me" 两截。
# 三选一分组：单个汉字自成一个断行单元；连续的非空白非汉字（西文词、数字、
# 标点游）粘成一个不可再分的单元；空白独立成一个单元，用来在两个西文词之间
# 找断点，但不会被留在新行开头（见下方 wrap 里的丢弃逻辑）。
MIXED_UNIT_RE = re.compile(r'[一-鿿]|[^\s一-鿿]+|\s+')


def wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, width: int) -> list[str]:
    """按像素宽度折行。

    英文按词断——按字符数估会在单词中间断开。中文没有空格分词，`text.split()`
    会把整句当成一个"词"，宽度超限时既不断行也不缩小，径直把一整句挤成一行
    甚至溢出画布；改为逐字符断，中文里每个字本来就是断行的合法位置——但夹在
    中文里的英文词要整个保留（见 MIXED_UNIT_RE），不能跟着一起拆成单字符。

    断点还不能落在句末点号前面：那样点号会单独起一行，等于用标点开头——中文
    排版禁则明确不允许。遇到这种字符时不真的另起一行，而是宁可让上一行略微
    超宽也要把它粘在行尾（悬挂标点是通行做法，这里画布右侧本来就留了余量，
    一个字符的超宽不会顶到面板截图上）。
    """
    lines: list[str] = []
    line = ''
    cjk = is_cjk(text)
    units = MIXED_UNIT_RE.findall(text) if cjk else text.split()
    sep = '' if cjk else ' '
    for unit in units:
        # 空白本来只是隔开上一行最后一个词与下一个词，被吞成新行的开头没有意义，
        # 留着只会在换行处露出一个多余的前导空格
        if cjk and unit.isspace() and line == '':
            continue
        probe = f'{line}{sep}{unit}'.strip() if sep else line + unit
        if draw.textlength(probe, font=font) <= width:
            line = probe
            continue
        if cjk and unit in CJK_NO_LEAD and line:
            line = line + unit
            continue
        if line:
            lines.append(line)
        line = '' if (cjk and unit.isspace()) else unit
    if line:
        lines.append(line)
    return lines


def shadowed(panel: Image.Image) -> Image.Image:
    """给面板加一圈淡阴影，让它从背景里浮起来。"""
    pad = 18
    layer = Image.new('RGBA', (panel.width + pad * 2, panel.height + pad * 2), (0, 0, 0, 0))
    shadow = Image.new('RGBA', panel.size, (0, 0, 0, 60))
    layer.paste(shadow, (pad, pad + 6), shadow)
    from PIL import ImageFilter
    layer = layer.filter(ImageFilter.GaussianBlur(10))
    layer.paste(panel.convert('RGBA'), (pad, pad))
    return layer


def main() -> None:
    parser = argparse.ArgumentParser(description='合成 1280×800 商店截图')
    parser.add_argument('source', type=pathlib.Path)
    parser.add_argument('output', type=pathlib.Path)
    parser.add_argument('--headline', required=True)
    parser.add_argument('--subline', default='')
    parser.add_argument(
        '--keep', type=float, default=1.0,
        help='先保留面板纵向的这个比例再缩放（0.65 表示只留 65%%）。'
             '面板越矮，缩到满高后就越宽、字越大——商店页上字号很关键',
    )
    parser.add_argument(
        '--from', dest='anchor', choices=['top', 'center', 'bottom'], default='top',
        help='--keep 从哪一端保留（默认 top）',
    )
    args = parser.parse_args()

    if not 0 < args.keep <= 1:
        print('✗ --keep 要在 (0, 1] 之间', file=sys.stderr)
        sys.exit(1)

    if not args.source.exists():
        print(f'✗ 找不到 {args.source}', file=sys.stderr)
        sys.exit(1)

    panel = Image.open(args.source).convert('RGB')

    if args.keep < 1:
        kept = round(panel.height * args.keep)
        if args.anchor == 'top':
            top = 0
        elif args.anchor == 'bottom':
            top = panel.height - kept
        else:
            top = (panel.height - kept) // 2
        panel = panel.crop((0, top, panel.width, top + kept))

    # 等比缩小到画布高度减去上下留白——只缩不放，保证文字清晰
    target_h = CANVAS[1] - MARGIN * 2
    scale = target_h / panel.height
    if scale > 1:
        print('⚠ 原图比画布还矮，放大会让文字发虚，建议重截一张更高的', file=sys.stderr)
    panel = panel.resize((round(panel.width * scale), target_h), Image.LANCZOS)

    canvas = Image.new('RGB', CANVAS, BG)
    framed = shadowed(panel)
    panel_x = CANVAS[0] - framed.width - MARGIN + 18
    canvas.paste(framed, (panel_x, MARGIN - 18), framed)

    draw = ImageDraw.Draw(canvas)
    text_width = panel_x - MARGIN - GAP

    # 两行任一句是中文就整块换成中文字体——两行各自判断会在中英文各占一行时
    # 撞出字重都对不上的混排，而这两行本来就是同一份 listing 的同一种语言。
    cjk = is_cjk(args.headline) or is_cjk(args.subline)
    headline_font = load_font(bold=True, size=58, cjk=cjk)
    sub_font = load_font(bold=False, size=27, cjk=cjk)

    headline_lines = wrap(draw, args.headline, headline_font, text_width)
    sub_lines = wrap(draw, args.subline, sub_font, text_width) if args.subline else []

    line_h, sub_h = 72, 40
    block_h = len(headline_lines) * line_h + (28 + len(sub_lines) * sub_h if sub_lines else 0)
    y = (CANVAS[1] - block_h) // 2

    for line in headline_lines:
        draw.text((MARGIN, y), line, font=headline_font, fill=INK)
        y += line_h
    if sub_lines:
        y += 28
        for line in sub_lines:
            draw.text((MARGIN, y), line, font=sub_font, fill=MUTED)
            y += sub_h

    canvas.save(args.output, 'PNG')
    print(f'✓ {args.output}  {CANVAS[0]}×{CANVAS[1]}')


if __name__ == '__main__':
    main()
