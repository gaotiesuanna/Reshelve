#!/usr/bin/env python3
"""打包成可上传到 Chrome 网上应用店的 zip。

用法：npm run package

做三件事：干净重建 → 校验产物 → 打包。

校验这一步不是走形式：manifest 里写了路径不等于文件真的被打包进去，
这类问题上传后要等审核退回才会发现，本地几毫秒就能查出来。
"""
from __future__ import annotations

import json
import pathlib
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
OUT_DIR = ROOT / 'release'

# 这些文件不该进商店包：macOS 元数据、源码映射、编辑器残留
EXCLUDE_NAMES = {'.DS_Store', 'Thumbs.db'}
EXCLUDE_SUFFIXES = {'.map'}


def fail(message: str) -> None:
    print(f'✗ {message}', file=sys.stderr)
    sys.exit(1)


def build() -> None:
    """从零重建，避免上一次构建的残留文件混进包里。"""
    if DIST.exists():
        shutil.rmtree(DIST)
    print('→ 构建中…')
    result = subprocess.run(['npm', 'run', 'build'], cwd=ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stdout, file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        fail('构建失败')


def referenced_paths(manifest: dict) -> set[str]:
    """收集 manifest 里所有指向文件的相对路径。

    只覆盖本项目实际用到的字段——与其写一个假装通用、实则漏项的遍历，
    不如明确列出，将来加了新字段就在这里补一行。
    """
    paths: set[str] = set()

    for size_map in (manifest.get('icons'), manifest.get('action', {}).get('default_icon')):
        if isinstance(size_map, dict):
            paths.update(size_map.values())

    worker = manifest.get('background', {}).get('service_worker')
    if worker:
        paths.add(worker)

    panel = manifest.get('side_panel', {}).get('default_path')
    if panel:
        paths.add(panel)

    for resource in manifest.get('web_accessible_resources', []):
        paths.update(resource.get('resources', []))

    return paths


def verify() -> dict:
    manifest_path = DIST / 'manifest.json'
    if not manifest_path.exists():
        fail('dist/manifest.json 不存在，构建没有产出 manifest')

    manifest = json.loads(manifest_path.read_text())

    for field in ('manifest_version', 'name', 'version', 'description'):
        if not manifest.get(field):
            fail(f'manifest 缺少必填字段：{field}')

    if manifest['manifest_version'] != 3:
        fail(f'manifest_version 是 {manifest["manifest_version"]}，商店已只接受 3')

    # 商店要求 128×128 图标，缺了会在提交时被拦下
    if '128' not in (manifest.get('icons') or {}):
        fail('manifest.icons 缺少 128 尺寸，商店要求必须有')

    missing = [p for p in referenced_paths(manifest) if not (DIST / p).exists()]
    if missing:
        fail('manifest 引用了以下文件，但它们不在 dist 里：\n  ' + '\n  '.join(sorted(missing)))

    verify_locales(manifest)
    return manifest


def verify_locales(manifest: dict) -> None:
    """商店对 _locales 的要求在上传时才报错，本地几毫秒就能查出来。"""
    default = manifest.get('default_locale')
    if not default:
        # 没有 default_locale 就不是多语言扩展，不必检查
        return

    locales_dir = DIST / '_locales'
    if not locales_dir.is_dir():
        fail(f'manifest 声明了 default_locale={default}，但 dist 里没有 _locales 目录')

    catalogs = {}
    for entry in sorted(locales_dir.iterdir()):
        path = entry / 'messages.json'
        if not path.exists():
            fail(f'_locales/{entry.name} 下没有 messages.json')
        catalogs[entry.name] = json.loads(path.read_text())

    if default not in catalogs:
        fail(f'default_locale 是 {default}，但 _locales 下没有这个语言')

    # 键集合必须一致，否则某种语言下会出现空白文案
    reference = set(catalogs[default])
    for name, catalog in catalogs.items():
        missing = reference - set(catalog)
        extra = set(catalog) - reference
        if missing:
            fail(f'_locales/{name} 相比 {default} 缺少词条：' + ', '.join(sorted(missing)))
        if extra:
            fail(f'_locales/{name} 比 {default} 多出词条：' + ', '.join(sorted(extra)))

    # manifest 里引用的 __MSG_xxx__ 必须都能找到
    referenced = set(re.findall(r'__MSG_([A-Za-z0-9_@]+)__', json.dumps(manifest)))
    unresolved = referenced - reference
    if unresolved:
        fail('manifest 引用了不存在的词条：' + ', '.join(sorted(unresolved)))


def should_skip(path: pathlib.Path) -> bool:
    if path.name in EXCLUDE_NAMES or path.suffix in EXCLUDE_SUFFIXES:
        return True
    # 隐藏文件一律不打包
    return any(part.startswith('.') for part in path.relative_to(DIST).parts)


def package(manifest: dict) -> pathlib.Path:
    OUT_DIR.mkdir(exist_ok=True)
    target = OUT_DIR / f'reshelve-{manifest["version"]}.zip'

    # manifest.json 必须在 zip 根目录，所以以 dist 为基准压缩，不要多套一层目录
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(DIST.rglob('*')):
            if path.is_dir() or should_skip(path):
                continue
            zf.write(path, path.relative_to(DIST))

    with zipfile.ZipFile(target) as zf:
        names = zf.namelist()
        if 'manifest.json' not in names:
            fail('打包后 manifest.json 不在 zip 根目录')

    return target


def display_name(manifest: dict) -> str:
    """manifest.name 在打包阶段仍是 __MSG_extName__ 字面量（要等 Chrome 加载时才解析），
    直接打印出来既难看又容易被误认为出错，所以从 default_locale 的词条里解析出真实名字。
    """
    name = manifest.get('name', '')
    match = re.fullmatch(r'__MSG_([A-Za-z0-9_@]+)__', name)
    if match is None:
        return name
    default = manifest.get('default_locale')
    catalog = json.loads((DIST / '_locales' / default / 'messages.json').read_text())
    return catalog.get(match.group(1), {}).get('message', name)


def main() -> None:
    build()
    manifest = verify()
    target = package(manifest)

    size_kb = target.stat().st_size / 1024
    print(f'\n✓ {display_name(manifest)} {manifest["version"]}')
    print(f'  {target.relative_to(ROOT)}  ({size_kb:.0f} KB)')
    with zipfile.ZipFile(target) as zf:
        print(f'  {len(zf.namelist())} 个文件')
    print('\n上传到 https://chrome.google.com/webstore/devconsole')
    print('提交前请对照 docs/publishing.md 的清单。')


if __name__ == '__main__':
    main()
