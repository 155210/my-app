"""生成 src/main/assets/www/依赖/标签说明.json（标签 Wiki 说明的英文原文，App 里用 AI 翻成中文再显示）。

数据源：NAIWeaver 的 Tags/wiki-descriptions.json（Danbooru wiki，CC-BY-SA-4.0，"Tag descriptions (c) Danbooru contributors"）
  https://github.com/155210/NAIWeaver

用法：python3 做标签说明.py <wiki-descriptions.json>

只收标签库里有的标签（画师不收），正文只留开头的说明（去掉「See also」之后的部分和链接语法），
通用/元数据最多 600 字，角色/作品最多 300 字；「See also」里标签库认识的标签留最多 8 个当「相关标签」。
输出：{"v":1, "d":{"标签":["说明", ["相关标签", ...]], ...}}
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WWW = os.path.join(HERE, '..', 'src', 'main', 'assets', 'www', '依赖')


def norm(s):
    return re.sub(r'\s+', ' ', s.strip().lower().replace('_', ' '))


def summary(s, cap):
    s = s.split('#### See also')[0]
    s = re.split(r'\n#{1,4} ', s)[0]
    s = re.sub(r'\[\[([^|\]]+)\|([^\]]+)\]\]', r'\2', s)
    s = re.sub(r'\[\[([^\]]+)\]\]', r'\1', s)
    s = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', s)
    s = re.sub(r'[*_`]{1,3}([^*_`]+)[*_`]{1,3}', r'\1', s)
    s = re.sub(r'\n{2,}', '\n', s).strip()
    if len(s) > cap:
        cut = s[:cap]
        p = max(cut.rfind('. '), cut.rfind('.\n'))
        s = cut[:p + 1] if p > cap // 2 else cut + '…'
    return s


def related(s, lib):
    if '#### See also' not in s:
        return []
    out = []
    for m in re.finditer(r'\[\[([^|\]]+)(?:\|[^\]]+)?\]\]', s.split('#### See also', 1)[1]):
        t = norm(m.group(1))
        if t in lib and t not in out:
            out.append(t)
        if len(out) >= 8:
            break
    return out


def main(src):
    lib = {t[0]: t[3] for t in json.load(open(os.path.join(WWW, '标签.json'), encoding='utf-8'))['tags']}
    out = {}
    for x in json.load(open(src, encoding='utf-8')):
        t = norm(x['t'])
        cat = lib.get(t)
        if cat is None or cat == 1:
            continue
        s = summary(x['d'], 600 if cat in (0, 5) else 300)
        if len(s) < 15:
            continue
        out[t] = [s, related(x['d'], lib)]
    path = os.path.join(WWW, '标签说明.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({'v': 1, 'd': out}, f, ensure_ascii=False, separators=(',', ':'))
    print('说明', len(out), '大小', os.path.getsize(path))


if __name__ == '__main__':
    main(sys.argv[1])
