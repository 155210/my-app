"""下载自动打码要用的识别模型和运行库，放进 src/main/assets/www/依赖/打码/（这个目录不进 git，Actions 打包前跑一次）。

  动漫.onnx / 动漫.json   deepghs/anime_censor_detection（YOLOv8，MIT）：乳头、男性下体、女性下体，专认二次元图
                         https://huggingface.co/deepghs/anime_censor_detection
  写实.onnx / 写实.json   NudeNet 3.4 自带的 320n.onnx（YOLOv8，MIT）：多认肛门、臀部、露出的胸部，偏写实的图更准
                         https://pypi.org/project/nudenet/
  ort.js / ort.wasm       onnxruntime-web 1.18.0（MIT，要 ≥1.18 才认 IR 10 的模型）的纯 WASM 单线程版，在 WebView 里跑模型

json 里是 { imgsz: [宽, 高], labels: [...], pad: 补成正方形再缩（NudeNet 的做法）/ 否则直接拉伸（deepghs 的做法） }，
imgsz / labels 从模型自带的元数据（ultralytics 导出时写的 imgsz、names）读，读不到用默认值。

用法：python3 下载打码模型.py [--skip-missing]   （--skip-missing：哪个下不到就跳过，本地测试用）
"""
import io
import json
import os
import sys
import tarfile
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src', 'main', 'assets', 'www', '依赖', '打码')

HF = 'https://huggingface.co'
ANIME_REPO = 'deepghs/anime_censor_detection'
ANIME_WANT = ['censor_detect_v1.0_s', 'censor_detect_v1.0_n']  # 先要 s（准一点），没有再要 n
ORT_VER = '1.18.0'
NUDENET_VER = '3.4.2'


def get(url):
    print('下载', url, flush=True)
    req = urllib.request.Request(url, headers={'User-Agent': 'nlimage-build'})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def varint(b, i):
    n = s = 0
    while True:
        c = b[i]
        i += 1
        n |= (c & 0x7f) << s
        s += 7
        if c < 0x80:
            return n, i


def fields(b):
    """protobuf 一层：[(字段号, 类型, 值)]，长度型的值是 bytes"""
    i, out = 0, []
    while i < len(b):
        key, i = varint(b, i)
        f, t = key >> 3, key & 7
        if t == 0:
            v, i = varint(b, i)
        elif t == 1:
            v, i = b[i:i + 8], i + 8
        elif t == 2:
            n, i = varint(b, i)
            v, i = b[i:i + n], i + n
        elif t == 5:
            v, i = b[i:i + 4], i + 4
        else:
            raise ValueError('不认识的 protobuf 类型 %d' % t)
        out.append((f, t, v))
    return out


def onnx_meta(model):
    """ModelProto.metadata_props（字段 14）→ dict"""
    meta = {}
    for f, t, v in fields(model):
        if f == 14 and t == 2:
            kv = {ff: vv for ff, tt, vv in fields(v) if tt == 2}
            meta[kv.get(1, b'').decode()] = kv.get(2, b'').decode()
    return meta


def labels_of(meta, fallback):
    names = meta.get('names')
    if not names:
        return fallback
    # ultralytics 写的是 Python dict 的字面量：{0: 'nipple_f', 1: 'penis'}
    import ast
    d = ast.literal_eval(names)
    return [d[i] for i in range(len(d))]


def imgsz_of(meta, fallback):
    s = meta.get('imgsz')
    if not s:
        return fallback
    v = json.loads(s)
    return [v[1], v[0]] if len(v) == 2 else [v[0], v[0]]  # ultralytics 是 [高, 宽]


def save(name, data):
    p = os.path.join(OUT, name)
    with open(p, 'wb') as f:
        f.write(data)
    print('  →', name, '%.1f MB' % (len(data) / 1048576), flush=True)


def save_model(name, model, info):
    meta = onnx_meta(model)
    info['imgsz'] = imgsz_of(meta, info['imgsz'])
    info['labels'] = labels_of(meta, info['labels'])
    print('  ', name, '元数据：', {k: meta[k] for k in ('imgsz', 'names') if k in meta})
    check(name, model, info)
    save(name + '.onnx', model)
    save(name + '.json', json.dumps(info, ensure_ascii=False).encode())


def check(name, model, info):
    """装了 onnxruntime 就拿全黑图跑一遍，确认输出是 App 认的 [1, 4 + 类别数, 框数]（Actions 里装了）"""
    try:
        import numpy as np
        import onnxruntime as rt
    except ImportError:
        print('   （没装 onnxruntime，跳过试跑）')
        return
    s = rt.InferenceSession(model, providers=['CPUExecutionProvider'])
    w, h = info['imgsz']
    out = s.run(None, {s.get_inputs()[0].name: np.zeros((1, 3, h, w), np.float32)})[0]
    print('   试跑输出', out.shape)
    if len(out.shape) != 3 or out.shape[1] != 4 + len(info['labels']):
        raise ValueError('%s 的输出 %s 不是 [1, 4+%d, N]，App 解析不了' % (name, out.shape, len(info['labels'])))


def anime():
    files = [s['rfilename'] for s in json.loads(get(HF + '/api/models/' + ANIME_REPO))['siblings']]
    models = sorted({f.split('/')[0] for f in files if f.endswith('/model.onnx')})
    print('  仓库里的模型：', ', '.join(models))
    pick = next((m for m in ANIME_WANT if m in models), None) or [m for m in models if m.endswith('_s')][-1]
    model = get(HF + '/' + ANIME_REPO + '/resolve/main/' + pick + '/model.onnx')
    info = {'name': pick, 'imgsz': [640, 640], 'labels': ['nipple_f', 'penis', 'pussy'], 'pad': False}
    if pick + '/threshold.json' in files:
        info['threshold'] = json.loads(get(HF + '/' + ANIME_REPO + '/resolve/main/' + pick + '/threshold.json')).get('threshold')
    save_model('动漫', model, info)


NUDENET_LABELS = [
    'FEMALE_GENITALIA_COVERED', 'FACE_FEMALE', 'BUTTOCKS_EXPOSED', 'FEMALE_BREAST_EXPOSED', 'FEMALE_GENITALIA_EXPOSED',
    'MALE_BREAST_EXPOSED', 'ANUS_EXPOSED', 'FEET_EXPOSED', 'BELLY_COVERED', 'FEET_COVERED', 'ARMPITS_COVERED',
    'ARMPITS_EXPOSED', 'FACE_MALE', 'BELLY_EXPOSED', 'MALE_GENITALIA_EXPOSED', 'ANUS_COVERED', 'FEMALE_BREAST_COVERED',
    'BUTTOCKS_COVERED',
]


def real():
    meta = json.loads(get('https://pypi.org/pypi/nudenet/' + NUDENET_VER + '/json'))
    url = next(u['url'] for u in meta['urls'] if u['filename'].endswith('.whl'))
    with zipfile.ZipFile(io.BytesIO(get(url))) as z:
        model = z.read('nudenet/320n.onnx')
    # NudeNet 的标签顺序写在它的代码里，模型元数据里的 names 是同一份；没有就用这份
    save_model('写实', model, {'name': 'nudenet-' + NUDENET_VER + '-320n', 'imgsz': [320, 320], 'labels': NUDENET_LABELS, 'pad': True})


def ort():
    tgz = get('https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-' + ORT_VER + '.tgz')
    with tarfile.open(fileobj=io.BytesIO(tgz)) as t:
        save('ort.js', t.extractfile('package/dist/ort.wasm-core.min.js').read())
        save('ort.wasm', t.extractfile('package/dist/ort-wasm-simd.wasm').read())


def main():
    skip = '--skip-missing' in sys.argv
    os.makedirs(OUT, exist_ok=True)
    bad = []
    for job in (ort, real, anime):
        try:
            job()
        except Exception as e:  # noqa: BLE001
            print('  ✗', job.__name__, e, flush=True)
            bad.append(job.__name__)
    if bad and not skip:
        sys.exit('没下全：' + ', '.join(bad))


if __name__ == '__main__':
    main()
