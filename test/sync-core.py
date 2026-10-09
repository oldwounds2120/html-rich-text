#!/usr/bin/env python3
"""
sync-core.py - 逻辑层副本同步 / 一致性校验

项目约定：htmlrichtext/src/main/ets/core/*.ets 是唯一真源，
test/*.ts 是它们给 Node 逻辑层单测用的副本（仅 import 路径与行尾不同）。

用法（在仓库根目录执行）：
    python test/sync-core.py           # 把 core/*.ets 同步到 test/*.ts
    python test/sync-core.py --check   # 只校验两边是否一致（CI / 提交前）
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORE = os.path.join(ROOT, 'htmlrichtext', 'src', 'main', 'ets', 'core')
TEST = os.path.join(ROOT, 'test')
PATTERN = re.compile(r"from '\./([A-Za-z]+)'")


def to_lf(text: str) -> str:
    return text.replace('\r\n', '\n')


def normalize_for_test(ets_text: str) -> str:
    """core/*.ets -> test/*.ts：import 补 .ts 后缀，行尾统一 LF。"""
    return PATTERN.sub(r"from './\1.ts'", to_lf(ets_text))


def read(path: str) -> str:
    return io.open(path, encoding='utf-8', newline='').read()


def main() -> int:
    check_only = '--check' in sys.argv
    names = sorted(f[:-4] for f in os.listdir(CORE) if f.endswith('.ets'))
    if not names:
        print('core 目录下没有 .ets 文件:', CORE)
        return 1

    bad = 0
    for name in names:
        ets_path = os.path.join(CORE, name + '.ets')
        ts_path = os.path.join(TEST, name + '.ts')
        expected = normalize_for_test(read(ets_path))

        if check_only:
            if not os.path.exists(ts_path):
                print('  [缺失] %-24s 副本不存在' % name)
                bad += 1
                continue
            if to_lf(read(ts_path)) == expected:
                print('  [一致] %-24s' % name)
            else:
                print('  [不一致] %-24s  → 执行 python test/sync-core.py 修复' % name)
                bad += 1
            continue

        # 同步：.ets 统一 CRLF（与工程内其他 .ets 一致），副本统一 LF
        ets_text = read(ets_path)
        crlf = ets_text.replace('\r\n', '\n').replace('\n', '\r\n')
        if crlf != ets_text:
            io.open(ets_path, 'w', encoding='utf-8', newline='').write(crlf)
        io.open(ts_path, 'w', encoding='utf-8', newline='').write(expected)
        print('  [同步] %-24s ets(CRLF) -> ts(LF)' % name)

    if check_only and bad:
        print('\n%d 个副本不一致。' % bad)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
