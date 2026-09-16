#!/usr/bin/env python3
"""生成商店的顶部宣传图块（1400×560，Chrome 网上应用店的 Marquee promo tile）。

用法：
    python3 tools/store-marquee.py release/store-assets/marquee-1400x560.png \
        --tagline "Reorganize your bookmarks with AI."

跟 store-tile.py 是同一套素材、同一套配色，区别只在画布比例：440×280 接近
方形，图标 + 名称 + 一句话摞成一竖条居中最自然；1400×560 是 2.5:1 的宽幅，
摞成一竖条会在左右各留一大片空白，改成图标在左、文字在右的横向布局，
整块内容再作为一个整体在画布上居中。

同样先在 4 倍画布上画字再缩回，边缘更平滑；同样不放界面截图——商店官方
指引对宣传图块的建议是少放文字、别用截图，跟小图块保持一致的克制。
"""
from __future__ import annotations

import argparse
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

CANVAS = (1400, 560)
SCALE = 4  # 超采样倍数

# 与 store-tile.py / store-compose.py 同一套配色，取自扩展侧栏顶栏
BG = (184, 225, 228)
INK = (18, 51, 46)
MUTED = (58, 92, 87)

FONT_BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
FONT_REGULAR = '/System/Library/Fonts/Supplemental/Arial.ttf'

ICON = pathlib.Path('public/icons/icon-128.png')

# 以下都是 1 倍下的尺寸，绘制时统一乘 SCALE
ICON_SIZE = 200
GAP_ICON_TEXT = 56  # 图标与文字块之间的横向间距
NAME_SIZE = 76
GAP_NAME = 20
TAGLINE_SIZE = 30


def main() -> None:
    parser = argparse.ArgumentParser(description='生成 1400×560 商店顶部宣传图块')
    parser.add_argument('output', type=pathlib.Path)
    parser.add_argument('--name', default='Reshelve')
    parser.add_argument('--tagline', default='Reorganize your bookmarks with AI.')
    parser.add_argument('--icon', type=pathlib.Path, default=ICON)
    args = parser.parse_args()

    if not args.icon.exists():
        print(f'✗ 找不到图标 {args.icon}', file=sys.stderr)
        sys.exit(1)

    canvas = Image.new('RGB', (CANVAS[0] * SCALE, CANVAS[1] * SCALE), BG)
    draw = ImageDraw.Draw(canvas)

    name_font = ImageFont.truetype(FONT_BOLD, NAME_SIZE * SCALE)
    tag_font = ImageFont.truetype(FONT_REGULAR, TAGLINE_SIZE * SCALE)

    # 用实际字形高度/宽度算版心，不用字号——字号含行距，居中会偏
    name_box = draw.textbbox((0, 0), args.name, font=name_font)
    tag_box = draw.textbbox((0, 0), args.tagline, font=tag_font)
    name_w, name_h = name_box[2] - name_box[0], name_box[3] - name_box[1]
    tag_w, tag_h = tag_box[2] - tag_box[0], tag_box[3] - tag_box[1]

    icon_px = ICON_SIZE * SCALE
    gap_px = GAP_ICON_TEXT * SCALE
    text_w = max(name_w, tag_w)
    text_block_h = name_h + GAP_NAME * SCALE + tag_h

    # 图标竖直居中于自己的高度，文字块竖直居中于自己的高度；
    # 两者作为一个整体（宽度 = 图标 + 间距 + 文字块最宽的一行）在画布上居中
    group_w = icon_px + gap_px + text_w
    group_x = (CANVAS[0] * SCALE - group_w) // 2

    icon = Image.open(args.icon).convert('RGBA').resize((icon_px, icon_px), Image.LANCZOS)
    icon_y = (CANVAS[1] * SCALE - icon_px) // 2
    canvas.paste(icon, (group_x, icon_y), icon)

    text_x = group_x + icon_px + gap_px
    text_y = (CANVAS[1] * SCALE - text_block_h) // 2

    draw.text((text_x - name_box[0], text_y - name_box[1]), args.name, font=name_font, fill=INK)
    text_y += name_h + GAP_NAME * SCALE
    draw.text((text_x - tag_box[0], text_y - tag_box[1]), args.tagline, font=tag_font, fill=MUTED)

    canvas.resize(CANVAS, Image.LANCZOS).save(args.output, 'PNG')
    print(f'✓ {args.output}  {CANVAS[0]}×{CANVAS[1]}')


if __name__ == '__main__':
    main()
