# -*- coding: utf-8 -*-
"""设备图清洗：洗白底色 → 吞掉棚拍水印 → 按主体裁边。

为什么必须做三件事：
1) 底色。页面上图片用 mix-blend-mode: multiply 压在纸色底上；底色若不是纯白，
   就会在纸上留一块比纸张略暗的方块——一眼看去像"贴上去的照片"，和整套规格表
   "印在纸上"的意图打架。
2) 水印。样册图的四角/两翼有浅灰的文字水印（品牌名 + "立式/分体式"之类）。
   它的亮度在 232–250 之间、饱和度接近 0，和背景只差几个灰阶，比机器暗、
   比底色亮。单靠"白到多少就给白"的白平衡洗不掉，必须按连通性一起吞。
3) 裁边。样册图四周留白占三到四成，18 张留白还不一样；页面按高度对齐后，
   机器本体大小就会忽大忽小。裁到主体 + 一圈定宽余量，图上大小才可比。

做法（只动"从边上能走到"的像素，机器本体里不连通的白高光不会被洗掉）：
  · 从图像四边泛洪，凡是"最暗通道 ≥ 232"的连通区 → 纯白。
    水印笔画本身也 ≥232，所以会被一起刷掉，不会留下灰边。
  · 再扫一遍剩余的小块：凡是"面积 < 5% 且与主体外包框之间还有空隙"的连通块，
    整块刷白。这一步清的是页面标注——样册每张图右侧都有一个细线框的竖排标签
    （「卧式｜多转子」之类），字是纯黑的，跟机器只差几像素的空隙，泛洪走不到、
    靠亮度也判不出来，只能按"是不是和机器连着"来判。
  · 按非白外包框裁边，四边各留 3% 余量。

用法：python tools/white-bg.py   （改完后必须跑 node tools/build-machine-images.js）
源图：data/machine-images.raw.json（不随仓库发布，见 .gitignore）
"""
import base64
import io
import json
import os
import sys
from collections import deque

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data', 'machine-images.raw.json')
OUT = os.path.join(ROOT, 'data', 'machine-images.json')

FLOOD_MIN = 232       # 泛洪：最暗通道下限。232 能吃掉水印(≈240)，吃不掉机器的浅灰边(≈215)
LABEL_MAX = 0.05      # 页面标注块（竖排机型标签）的面积上限（占全图）
GAP = 4               # 与主体外包框的最小空隙：有缝才算"另一个东西"，贴身的可能是机器零件
PAD = 0.03            # 裁边后保留的余量
MAX_H = 320           # 输出高度上限（页面按 160px 高显示，2x 屏正好）
QUALITY = 86


def flood_white(im):
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(1, h - 1):
        q.append((0, y))
        q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        i = y * w + x
        if seen[i]:
            continue
        r, g, b = px[x, y]
        if min(r, g, b) < FLOOD_MIN:
            continue
        seen[i] = 1
        px[x, y] = (255, 255, 255)
        if x:
            q.append((x - 1, y))
        if y:
            q.append((x, y - 1))
        if x + 1 < w:
            q.append((x + 1, y))
        if y + 1 < h:
            q.append((x, y + 1))
    return im


def components(im):
    """8 连通标记非白像素。返回 [(size, bbox, pixels)]，按面积降序。"""
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    out = []
    for sy in range(h):
        for sx in range(w):
            i = sy * w + sx
            if seen[i]:
                continue
            r, g, b = px[sx, sy]
            if r > 248 and g > 248 and b > 248:
                seen[i] = 1
                continue
            q = deque([(sx, sy)])
            seen[i] = 1
            n = 0
            x0 = x1 = sx
            y0 = y1 = sy
            pixels = []
            while q:
                x, y = q.popleft()
                n += 1
                pixels.append((x, y))
                x0 = min(x0, x)
                x1 = max(x1, x)
                y0 = min(y0, y)
                y1 = max(y1, y)
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1),
                               (1, 1), (1, -1), (-1, 1), (-1, -1)):
                    a, b2 = x + dx, y + dy
                    if 0 <= a < w and 0 <= b2 < h and not seen[b2 * w + a]:
                        seen[b2 * w + a] = 1
                        p = px[a, b2]
                        if p[0] > 248 and p[1] > 248 and p[2] > 248:
                            continue
                        q.append((a, b2))
            out.append((n, (x0, y0, x1, y1), pixels))
    out.sort(key=lambda c: -c[0])
    return out


def clean(img, tag=''):
    im = img.copy().convert('RGB')
    w, h = im.size
    flood_white(im)
    comps = components(im)
    if not comps:
        return im
    main = comps[0][1]
    px = im.load()
    limit = LABEL_MAX * w * h
    dropped = 0
    for n, (x0, y0, x1, y1), pixels in comps[1:]:
        if n > limit:
            continue
        # 与主体外包框之间有空隙 → 它和机器根本不连，是页面标注（竖排机型标签/水印字），整块擦掉。
        # 这里不能只看亮度：样册的竖排标签是纯黑字（L 低到 44），靠"白到多少就给白"永远洗不掉。
        gapx = max(x0 - (main[2] + GAP), main[0] - GAP - x1, 0)
        gapy = max(y0 - (main[3] + GAP), main[1] - GAP - y1, 0)
        if gapx == 0 and gapy == 0:
            continue
        for x, y in pixels:
            px[x, y] = (255, 255, 255)
        dropped += 1
    # 裁到非白外包框
    bb = im.convert('L').point(lambda v: 0 if v > 248 else 255).getbbox()
    if bb:
        x0, y0, x1, y1 = bb
        pad = int(round(max(x1 - x0, y1 - y0) * PAD)) + 1
        im = im.crop((max(0, x0 - pad), max(0, y0 - pad),
                      min(w, x1 + pad), min(h, y1 + pad)))
    if im.size[1] > MAX_H:
        nh = MAX_H
        im = im.resize((max(1, round(im.size[0] * nh / im.size[1])), nh), Image.LANCZOS)
    if tag:
        print('%-24s %s -> %s  (清残片 %d/%d)' %
              (tag, '%dx%d' % (w, h), '%dx%d' % im.size, dropped, len(comps) - 1))
    return im


def main():
    src = RAW if os.path.exists(RAW) else OUT
    raw = json.load(open(src, encoding='utf-8'))
    before = os.path.getsize(src)
    out = {}
    for slug, data_uri in raw.items():
        head, b64 = data_uri.split(',', 1)
        im = clean(Image.open(io.BytesIO(base64.b64decode(b64))), slug)
        buf = io.BytesIO()
        im.save(buf, 'JPEG', quality=QUALITY, optimize=True)
        out[slug] = head + ',' + base64.b64encode(buf.getvalue()).decode('ascii')
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
    print('%d 张，json %d -> %d bytes（源 %s）' %
          (len(out), before, os.path.getsize(OUT), os.path.basename(src)))


if __name__ == '__main__':
    main()
