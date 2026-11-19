"""生成 PWA 图标：把界面里那只鲸鱼按 SVG 路径栅格化成 512/192 PNG（需要 Pillow）。"""
import math
import re
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

SS = 4  # 超采样倍数
SIZE = 512
SPRITE = 48  # SVG viewBox
SCALE = (SIZE / SPRITE)  # 8
TRANSLATE = 0.0  # 图标背景铺满，鲸鱼直接铺满 viewBox


def cubic(p0, p1, p2, p3, n=24):
    pts = []
    for i in range(1, n + 1):
        t = i / n
        mt = 1 - t
        x = mt**3 * p0[0] + 3 * mt**2 * t * p1[0] + 3 * mt * t**2 * p2[0] + t**3 * p3[0]
        y = mt**3 * p0[1] + 3 * mt**2 * t * p1[1] + 3 * mt * t**2 * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def parse_path(d):
    """解析 M / c / C / Z（本图标只用这四种命令），返回点列。"""
    tokens = re.findall(r"[MCZz]|-?\d+(?:\.\d+)?", d)
    pts = []
    cur = (0.0, 0.0)
    cmd = None
    i = 0

    def nums(k):
        nonlocal i
        out = [float(tokens[i + j]) for j in range(k)]
        i += k
        return out

    while i < len(tokens):
        tok = tokens[i]
        if re.fullmatch(r"[MCZz]", tok):
            cmd = tok
            i += 1
            if cmd in "Zz":
                continue
        if cmd == "M":
            x, y = nums(2)
            cur = (x, y)
            pts.append(cur)
            cmd = "c"  # 后续隐式相对曲线
        elif cmd == "c":
            dx1, dy1, dx2, dy2, dx, dy = nums(6)
            p0 = cur
            p1 = (cur[0] + dx1, cur[1] + dy1)
            p2 = (cur[0] + dx2, cur[1] + dy2)
            p3 = (cur[0] + dx, cur[1] + dy)
            pts += cubic(p0, p1, p2, p3)
            cur = p3
        elif cmd == "C":
            x1, y1, x2, y2, x, y = nums(6)
            p0 = cur
            p3 = (x, y)
            pts += cubic(p0, (x1, y1), (x2, y2), p3)
            cur = p3
        else:
            i += 1
    return pts


BODY_PATH = (
    "M6 26c0-8 6.6-14 15-14 7.4 0 12.6 4 14.6 9.2 1.2 3.2 2.6 4.4 5.4 4.8"
    "-1.9 2.4-4.4 3.5-7.4 3.2C30.9 35.4 26.6 38 21 38c-8.5 0-15-5-15-12Z"
)


def rounded_mask(size, radius, ss):
    img = Image.new("L", (size * ss, size * ss), 0)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size * ss - 1, size * ss - 1], radius=radius * ss, fill=255)
    return img.resize((size, size), Image.LANCZOS)


def gradient(size, c0, c1):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x / size + y / size) / 2
            px[x, y] = tuple(int(c0[k] + (c1[k] - c0[k]) * t) for k in range(3))
    return img


def build_icon() -> Image.Image:
    size = SIZE
    base = gradient(size, (0x5B, 0x78, 0xFF), (0x3B, 0x58, 0xE8)).convert("RGBA")
    base.putalpha(rounded_mask(size, 112, 1))

    # 4 倍超采样绘制鲸鱼
    big = size * SS
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    def to_px(p):
        return (p[0] * SCALE * SS, p[1] * SCALE * SS)

    pts = [to_px(p) for p in parse_path(BODY_PATH)]
    d.polygon(pts, fill=(255, 255, 255, 246))

    # 眼睛（挖出背景色）
    ex, ey = to_px((20, 22))
    r = 1.9 * SCALE * SS
    d.ellipse([ex - r, ey - r, ex + r, ey + r], fill=(0x3B, 0x58, 0xE8, 255))

    # 头顶喷水的小弧线
    spout = cubic(to_px((14, 6.5)), to_px((16.5, 7.6)), to_px((17.9, 9.6)), to_px((17.9, 12)), n=24)
    d.line(spout, fill=(255, 255, 255, 235), width=int(2.6 * SCALE * SS * 0.55), joint="curve")

    layer = layer.resize((size, size), Image.LANCZOS)
    out = Image.alpha_composite(base, layer)

    # 底部浪花弧
    wave = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    dw = ImageDraw.Draw(wave)
    wpts = cubic(to_px((30, 30)), to_px((33.4, 31.5)), to_px((36.3, 31.3)), to_px((38.9, 29.4)), n=24)
    dw.line(wpts, fill=(0x3B, 0x58, 0xE8, 130), width=int(1.6 * SCALE * 0.9))
    wave = wave.resize((size, size), Image.LANCZOS)
    out = Image.alpha_composite(out, wave)
    return out


def main():
    icon = build_icon()
    icon.save(OUT / "icon-512.png")
    icon.resize((192, 192), Image.LANCZOS).save(OUT / "icon-192.png")
    # 180×180 供 iOS 添加到主屏幕
    icon.resize((180, 180), Image.LANCZOS).save(OUT / "apple-touch-icon.png")
    print("已生成：", *(p.name for p in sorted(OUT.glob("*.png"))))


if __name__ == "__main__":
    main()