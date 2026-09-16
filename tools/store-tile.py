#!/usr/bin/env python3
"""生成商店的小型宣传图块（440×280）。

用法：
    python3 tools/store-tile.py release/store-assets/tile-440x280.png \
        --tagline "Reorganize your bookmarks with AI."

**为什么不放截图**：440×280 上任何界面截图缩到这个尺寸都认不出字，
商店官方指引也明确要求宣传图块少放文字、别用截图。所以这里只做品牌
标识锁定：图标 + 名称 + 一句话，配色与 store-compose.py 的截图画布
保持同一套，五张截图和图块摆在一起才像一个产品。

**为什么先放大再缩小**：PIL 直接在 440×280 上画 40px 的字，边缘会有
明显锯齿。改为在 4 倍画布上绘制再 LANCZOS 缩回，等价于 4×4 超采样，
文字边缘平滑得多。
"""
from __future__ import annotations

import argparse
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

TILE = (440, 280)
SCALE = 4  # 超采样倍数

# 与 store-compose.py 同一套配色，取自扩展侧栏顶栏
BG = (184, 225, 228)
INK = (18, 51, 46)
MUTED = (58, 92, 87)

FONT_BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
FONT_REGULAR = '/System/Library/Fonts/Supplemental/Arial.ttf'

ICON = pathlib.Path('public/icons/icon-128.png')

# 以下都是 1 倍下的尺寸，绘制时统一乘 SCALE
ICON_SIZE = 72
GAP_ICON = 20
NAME_SIZE = 42
GAP_NAME = 12
TAGLINE_SIZE = 17


def main() -> None:
    parser = argparse.ArgumentParser(description='生成 440×280 商店宣传图块')
    parser.add_argument('output', type=pathlib.Path)
    parser.add_argument('--name', default='Reshelve')
    parser.add_argument('--tagline', default='Reorganize your bookmarks with AI.')
    parser.add_argument('--icon', type=pathlib.Path, default=ICON)
    args = parser.parse_args()

    if not args.icon.exists():
        print(f'✗ 找不到图标 {args.icon}', file=sys.stderr)
        sys.exit(1)

    canvas = Image.new('RGB', (TILE[0] * SCALE, TILE[1] * SCALE), BG)
    draw = ImageDraw.Draw(canvas)

    name_font = ImageFont.truetype(FONT_BOLD, NAME_SIZE * SCALE)
    tag_font = ImageFont.truetype(FONT_REGULAR, TAGLINE_SIZE * SCALE)

    # 用实际字形高度算版心，不用字号——字号含行距，居中会偏上
    name_box = draw.textbbox((0, 0), args.name, font=name_font)
    tag_box = draw.textbbox((0, 0), args.tagline, font=tag_font)
    name_h, tag_h = name_box[3] - name_box[1], tag_box[3] - tag_box[1]

    block_h = ICON_SIZE * SCALE + GAP_ICON * SCALE + name_h + GAP_NAME * SCALE + tag_h
    y = (TILE[1] * SCALE - block_h) // 2

    icon = Image.open(args.icon).convert('RGBA').resize(
        (ICON_SIZE * SCALE, ICON_SIZE * SCALE), Image.LANCZOS
    )
    canvas.paste(icon, ((TILE[0] * SCALE - icon.width) // 2, y), icon)
    y += icon.height + GAP_ICON * SCALE

    draw.text(((TILE[0] * SCALE - (name_box[2] - name_box[0])) // 2, y - name_box[1]),
              args.name, font=name_font, fill=INK)
    y += name_h + GAP_NAME * SCALE

    draw.text(((TILE[0] * SCALE - (tag_box[2] - tag_box[0])) // 2, y - tag_box[1]),
              args.tagline, font=tag_font, fill=MUTED)

    canvas.resize(TILE, Image.LANCZOS).save(args.output, 'PNG')
    print(f'✓ {args.output}  {TILE[0]}×{TILE[1]}')


if __name__ == '__main__':
    main()
