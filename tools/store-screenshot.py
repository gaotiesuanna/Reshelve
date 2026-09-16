#!/usr/bin/env python3
"""把任意截图裁成 Chrome 网上应用店要求的 1280×800。

用法：
    python3 tools/store-screenshot.py 原图.png 输出.png [--anchor top|center|bottom]

商店只接受 1280×800 或 640×400，尺寸不对会被拒。这个脚本按 1.6 的宽高比
裁出一条，再缩放到 1280×800——**只裁不拉伸**，因为拉伸会让文字发虚，
而商店截图里文字能不能看清直接决定转化率。

--anchor 决定纵向裁哪一段：截图往往上下都有冗余（浏览器标签栏、页面留白），
哪一段信息最多因图而异，所以留成参数而不是写死。
"""
from __future__ import annotations

import argparse
import pathlib
import sys

from PIL import Image

TARGET = (1280, 800)
RATIO = TARGET[0] / TARGET[1]


def crop_box(size: tuple[int, int], anchor: str) -> tuple[int, int, int, int]:
    """按目标宽高比算出最大的裁剪框。"""
    width, height = size

    if width / height > RATIO:
        # 原图偏宽：保住高度，横向居中裁
        new_width = round(height * RATIO)
        left = (width - new_width) // 2
        return (left, 0, left + new_width, height)

    # 原图偏高：保住宽度，纵向按 anchor 裁
    new_height = round(width / RATIO)
    if anchor == 'top':
        top = 0
    elif anchor == 'bottom':
        top = height - new_height
    else:
        top = (height - new_height) // 2
    return (0, top, width, top + new_height)


def main() -> None:
    parser = argparse.ArgumentParser(description='裁成商店要求的 1280×800')
    parser.add_argument('source', type=pathlib.Path)
    parser.add_argument('output', type=pathlib.Path)
    parser.add_argument(
        '--anchor', choices=['top', 'center', 'bottom'], default='center',
        help='原图偏高时纵向裁哪一段（默认 center）',
    )
    parser.add_argument(
        '--offset', type=int, default=0,
        help='在 anchor 基础上再上下微调多少像素（正数往下）',
    )
    args = parser.parse_args()

    if not args.source.exists():
        print(f'✗ 找不到 {args.source}', file=sys.stderr)
        sys.exit(1)

    image = Image.open(args.source).convert('RGB')
    left, top, right, bottom = crop_box(image.size, args.anchor)

    # 微调后仍要留在原图范围内，否则会裁出黑边
    shift = max(-top, min(args.offset, image.height - bottom))
    top, bottom = top + shift, bottom + shift

    cropped = image.crop((left, top, right, bottom))
    # 缩小用 LANCZOS：截图以文字为主，这个滤镜对细笔画最友好
    resized = cropped.resize(TARGET, Image.LANCZOS)
    resized.save(args.output, 'PNG')

    print(f'✓ {args.output}')
    print(f'  {image.width}×{image.height} → 裁 {cropped.width}×{cropped.height} → {TARGET[0]}×{TARGET[1]}')
    if resized.size != TARGET:
        print('✗ 输出尺寸不对，商店会拒', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
