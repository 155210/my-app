"""生成 src/main/assets/www/依赖/标签.json（标签库数据）。平时不用跑，换数据源时才跑一次。

数据源（先下载到同一个目录，用参数传进来）：
  1. NAIWeaver 的 Tags/high-frequency-tags-list.json   英文标签、热度、类别、别名（MIT）
     https://github.com/155210/NAIWeaver
  2. byzod/a1111-sd-webui-tagcomplete-CN 的 tags/Tags-zh-full-pack.csv   人工中文翻译（MIT），优先用
  3. xhoxye/BooruTagCart 的 danbooru.csv   中文翻译 + Danbooru 英文别名（GPL-3.0，本 App 自用不发布）
  4. 同目录的 标签补译.txt   上面都没有的通用标签，手动补的中文（「英文|中文」一行一条）

用法：
  python3 做标签库.py <NAIWeaver 的 json> <byzod 的 csv> <BooruTagCart 的 danbooru.csv>

输出格式（键名短，省体积）：
  {"v":1, "tags":[[英文, 中文, 热度, 类别], ...按热度从高到低], "alias":{"别名":"标签", ...}}
  类别：0 通用  1 画师  3 作品  4 角色  5 元数据
"""
import csv
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src', 'main', 'assets', 'www', '依赖', '标签.json')
CAT = {'general': 0, 'artist': 1, 'copyright': 3, 'character': 4, 'meta': 5}
CJK = re.compile(r'[一-鿿]')
KANA = re.compile(r'[぀-ヿ]')


def norm(s):
    s = s.strip().lower().replace('_', ' ').replace('\\(', '(').replace('\\)', ')')
    return re.sub(r'\s+', ' ', s)


def clean_zh(s):
    s = (s or '').strip().replace('?', '·')
    return s.split('|')[0].strip()


def main(naiw, byzod, cart):
    manual = {}
    for line in open(os.path.join(HERE, '标签补译.txt'), encoding='utf-8'):
        if '|' in line:
            k, v = line.rstrip('\n').split('|', 1)
            manual[norm(k)] = v.strip()
    zh_by = {}
    for r in csv.reader(open(byzod, encoding='utf-8-sig')):
        if len(r) >= 2 and r[1].strip():
            zh_by[norm(r[0])] = clean_zh(r[1])
    zh_cart, alias_cart = {}, {}
    for r in csv.reader(open(cart, encoding='utf-8-sig')):
        if len(r) < 5:
            continue
        k = norm(r[0])
        if r[4].strip():
            zh_cart[k] = clean_zh(r[4])
        for a in r[3].split(','):
            if a.strip():
                alias_cart.setdefault(norm(a), k)

    src = json.load(open(naiw, encoding='utf-8'))
    tags, seen = [], set()
    for x in sorted(src, key=lambda x: -x['count']):
        t = norm(x['tag'])
        if not t or t in seen:
            continue
        seen.add(t)
        cat = CAT.get(x.get('type_name'), 0)
        aliases = [a.strip() for a in x.get('aliases') or [] if a.strip()]
        zh = ''
        if cat in (0, 5):
            zh = manual.get(t) or zh_by.get(t) or zh_cart.get(t) or ''
            if not CJK.search(zh):
                zh = next((a for a in aliases if CJK.search(a) and not KANA.search(a)), zh)
        elif cat in (3, 4):
            # 角色/作品：机翻常常只剩括号里的作品名，这种不要；没有就用别名里的中文名、日文名
            c = zh_by.get(t) or zh_cart.get(t) or ''
            good = CJK.search(c) and not c.startswith(('（', '('))
            zh = ((c if good else '')
                  or next((a for a in aliases if CJK.search(a) and not KANA.search(a)), '')
                  or next((a for a in aliases if CJK.search(a) or KANA.search(a)), ''))
        tags.append([t, zh, x['count'], cat])

    # 别名：只收「本身不是标签库里的标签」的写法，免得把新名字改回旧名字
    alias = {a: k for a, k in alias_cart.items() if k in seen and a not in seen and a != k and not a.startswith('/')}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump({'v': 1, 'tags': tags, 'alias': alias}, f, ensure_ascii=False, separators=(',', ':'))
    n0 = sum(1 for t in tags if t[3] == 0)
    z0 = sum(1 for t in tags if t[3] == 0 and t[1])
    print('标签', len(tags), '通用', n0, '其中有中文', z0, '别名', len(alias), '大小', os.path.getsize(OUT))


if __name__ == '__main__':
    main(*sys.argv[1:4])
