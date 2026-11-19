"""生成「小肥鱼」应用图标（线条手绘极简版：圆胖鲸鱼）。

刻意和官方 DeepSeek 鲸鱼区分：朝左、近圆、粗线稿、纸底、腮红、横尾叶；
官方是右向、蓝色渐变、带速度感的鲸鱼剪影。

用法：python scripts/make-icon.py
输出：official/assets/icons/{icon.svg,icon-192.png,icon-512.png,apple-touch-icon.png}
      public/icons/ 同步一份
"""
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = [ROOT / 'official/assets/icons', ROOT / 'public/icons']

S = 1024
PAPER = (255, 251, 242)
BODY_FILL = (255, 244, 227)
INK = (44, 40, 38)
ORANGE = (255, 138, 91)

# 鲸鱼轮廓锚点（1024 坐标系，朝左、大头向右收窄）
ANCHORS = [
    (252, 596),
    (268, 516),
    (300, 462),
    (362, 432),
    (440, 424),
    (522, 436),
    (600, 464),
    (676, 500),
    (738, 536),
    (750, 566),
    (738, 602),
    (672, 638),
    (590, 676),
    (496, 706),
    (400, 716),
    (318, 696),
    (266, 650),
]

BELLY = [
    (252, 646),
    (318, 696),
    (400, 716),
    (500, 706),
    (590, 676),
    (672, 638),
    (700, 618),
    (660, 606),
    (560, 628),
    (450, 652),
    (352, 668),
    (278, 660),
]


def chaikin(points, iterations=3):
    pts = list(points)
    for _ in range(iterations):
        out = []
        for i in range(len(pts)):
            x0, y0 = pts[i]
            x1, y1 = pts[(i + 1) % len(pts)]
            out.append((0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1))
            out.append((0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1))
        pts = out
    return pts


def rounded_mask(size, radius_ratio=0.226):
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=round(size * radius_ratio), fill=255)
    return mask


def paper_background():
    image = Image.new('RGBA', (S, S), PAPER + (255,))
    draw = ImageDraw.Draw(image)
    rnd = random.Random(7)
    for _ in range(1400):
        x = rnd.randrange(40, S - 40)
        y = rnd.randrange(40, S - 40)
        draw.point((x, y), fill=(120, 100, 80, rnd.randrange(4, 12)))
    inset, radius = 52, 176
    draw.rounded_rectangle(
        [inset, inset, S - inset, S - inset], radius=radius, outline=INK, width=15
    )
    draw.rounded_rectangle(
        [inset + 4, inset - 2, S - inset - 2, S - inset + 3],
        radius=radius,
        outline=(44, 40, 38, 95),
        width=4,
    )
    return image


def draw_whale_layer(scale=1.0):
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    k = scale

    def p(x, y):
        return (round(x * k), round(y * k))

    def line(points, color, width):
        draw.line([p(x, y) for x, y in points], fill=color, width=round(width * k), joint='curve')

    def ellipse(box, color, width, fill=None):
        draw.ellipse(
            [p(box[0], box[1]), p(box[2], box[3])],
            outline=color if color else None,
            fill=fill,
            width=round(width * k) if width else 0,
        )

    def arc(box, start, end, color, width):
        draw.arc(
            [p(box[0], box[1]), p(box[2], box[3])],
            start=start,
            end=end,
            fill=color,
            width=round(width * k),
        )

    W = 13

    # 扇形水花（两条外扩曲线 + 实心水滴）
    line([(396, 430), (386, 390), (360, 352), (332, 338)], INK, 7)
    line([(406, 430), (418, 390), (446, 354), (470, 342)], INK, 7)
    ellipse((316, 318, 342, 344), None, 0, fill=INK)
    ellipse((378, 282, 408, 312), None, 0, fill=INK)
    ellipse((458, 326, 484, 352), None, 0, fill=INK)

    # 横向尾叶
    line([(740, 552), (852, 540), (902, 532)], INK, W - 1)
    line([(902, 532), (922, 552), (922, 572), (902, 592)], INK, W - 1)
    line([(902, 592), (852, 586), (740, 580)], INK, W - 1)

    # 身体
    smooth = chaikin(ANCHORS, 4)
    outline = [p(x, y) for x, y in smooth]
    draw.polygon(outline, fill=BODY_FILL + (255,))
    draw.polygon([p(x, y) for x, y in chaikin(BELLY, 3)], fill=(255, 255, 255, 130))
    draw.line(outline + [outline[0]], fill=INK, width=round(W * k), joint='curve')
    inner = chaikin([(x + 4, y - 3) for x, y in ANCHORS], 4)
    draw.line(
        [p(x, y) for x, y in inner] + [p(*inner[0])],
        fill=(44, 40, 38, 70),
        width=round(max(2, W - 9) * k),
        joint='curve',
    )

    # 小背鳍
    line([(486, 438), (520, 402), (556, 410), (570, 440)], INK, W - 2)
    # 下颌线
    line([(258, 606), (306, 648), (368, 668), (430, 664)], INK, W - 2)
    # 腹部褶皱
    arc((300, 678, 520, 790), 200, 330, INK, 7)
    arc((336, 690, 506, 776), 205, 325, INK, 6)
    arc((372, 702, 496, 762), 210, 320, INK, 5)

    # 眼睛（低、靠近嘴角）
    draw.ellipse([p(296, 564), p(324, 592)], fill=INK)
    draw.ellipse([p(306, 572), p(316, 582)], fill=(255, 255, 255, 210))
    # 腮红
    blush = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(blush)
    bd.ellipse([p(300, 604), p(380, 644)], fill=ORANGE + (85,))
    layer.alpha_composite(blush.filter(ImageFilter.GaussianBlur(14 * k)))

    # 气泡
    ellipse((820, 372, 884, 436), INK, 8)
    ellipse((852, 300, 894, 342), INK, 7)
    # 橙色星光
    star = [(250, 200), (258, 226), (284, 234), (258, 242), (250, 268), (242, 242), (216, 234), (242, 226)]
    draw.line([p(x, y) for x, y in star] + [p(250, 200)], fill=ORANGE, width=round(10 * k), joint='curve')
    return layer


def build_png(size):
    canvas = paper_background()
    whale = draw_whale_layer(1)
    whale = whale.rotate(-3, resample=Image.BICUBIC, center=(S / 2, S / 2))
    canvas.alpha_composite(whale)
    canvas.putalpha(rounded_mask(S))
    return canvas.resize((size, size), Image.LANCZOS)


def svg_path(points, scale=0.5, close=True):
    pts = [(x * scale, y * scale) for x, y in points]
    d = f'M {pts[0][0]:.1f} {pts[0][1]:.1f} ' + ' '.join(
        f'L {x:.1f} {y:.1f}' for x, y in pts[1:]
    )
    return d + (' Z' if close else '')


def svg_source():
    body = svg_path(chaikin(ANCHORS, 3))
    belly = svg_path(chaikin(BELLY, 3))
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="小肥鱼">
  <rect width="512" height="512" rx="116" fill="#fffbf2"/>
  <rect x="26" y="26" width="460" height="460" rx="96" fill="none" stroke="#2c2826" stroke-width="7"/>
  <rect x="29" y="24" width="452" height="456" rx="94" fill="none" stroke="#2c2826" stroke-width="2" opacity=".4"/>
  <g transform="rotate(-3 256 290)">
    <path d="{body}" fill="#fff4e3" stroke="#2c2826" stroke-width="6.5" stroke-linejoin="round"/>
    <path d="{belly}" fill="#ffffff" opacity=".5"/>
  </g>
  <g fill="none" stroke="#2c2826" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M 198 215 C 193 195 180 176 166 169"/>
    <path d="M 203 215 C 209 195 223 177 235 171"/>
    <path d="M 158 159 m -9 0 a 9 9 0 1 0 18 0 a 9 9 0 1 0 -18 0" fill="#2c2826" stroke="none"/>
    <path d="M 193 139 m -11 0 a 11 11 0 1 0 22 0 a 11 11 0 1 0 -22 0" fill="#2c2826" stroke="none"/>
    <path d="M 232 163 m -9 0 a 9 9 0 1 0 18 0 a 9 9 0 1 0 -18 0" fill="#2c2826" stroke="none"/>
    <path d="M 370 276 L 426 270 L 451 266"/>
    <path d="M 451 266 L 461 276 L 461 286 L 451 296"/>
    <path d="M 451 296 L 426 293 L 370 290"/>
    <path d="M 243 219 C 250 204 260 202 266 210"/>
    <path d="M 129 303 C 153 322 184 330 215 330"/>
    <path d="M 150 339 C 172 350 196 352 216 350" stroke-width="3.5"/>
    <path d="M 164 350 C 184 359 204 360 220 356" stroke-width="3"/>
    <path d="M 178 358 C 196 365 212 366 224 362" stroke-width="2.5"/>
    <circle cx="148" cy="282" r="7" fill="#2c2826" stroke="none"/>
    <ellipse cx="170" cy="312" rx="20" ry="10" fill="#ff8a5b" stroke="none" opacity=".45"/>
    <circle cx="410" cy="186" r="15"/>
    <circle cx="426" cy="150" r="9"/>
  </g>
  <path d="M 125 105l6 13 13 6-13 6-6 13-6-13-13-6 13-6z" fill="none" stroke="#ff8a5b" stroke-width="5" stroke-linejoin="round"/>
</svg>
"""


def main():
    pngs = {512: build_png(512), 192: build_png(192), 180: build_png(180)}
    for directory in OUT:
        directory.mkdir(parents=True, exist_ok=True)
        pngs[512].save(directory / 'icon-512.png')
        pngs[192].save(directory / 'icon-192.png')
        pngs[180].save(directory / 'apple-touch-icon.png')
        (directory / 'icon.svg').write_text(svg_source(), encoding='utf-8')
    pngs[512].save(ROOT / '.tmp/icon-preview-512.png')
    print('icons written')


if __name__ == '__main__':
    main()