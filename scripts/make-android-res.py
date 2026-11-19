"""把官方图标/启动图替换成小肥鱼鲸鱼图标（Android res）。"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / 'android/app/src/main/res'
SOURCE = ROOT / 'official/assets/icons/icon-512.png'
PAPER = (255, 251, 242)

icon = Image.open(SOURCE).convert('RGBA')

# 启动器图标尺寸（mdpi 基准 48dp）
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}


def circular(image):
    size = image.width
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse([0, 0, size - 1, size - 1], fill=255)
    result = image.copy()
    result.putalpha(mask)
    return result


def foreground(image, size):
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    inner = int(size * 0.72)
    scaled = image.resize((inner, inner), Image.LANCZOS)
    canvas.alpha_composite(scaled, ((size - inner) // 2, (size - inner) // 2))
    return canvas


def splash(width, height):
    canvas = Image.new('RGBA', (width, height), PAPER + (255,))
    inner = int(min(width, height) * 0.34)
    scaled = icon.resize((inner, inner), Image.LANCZOS)
    canvas.alpha_composite(scaled, ((width - inner) // 2, (height - inner) // 2))
    return canvas.convert('RGB')


for name, ratio in DENSITIES.items():
    folder = RES / f'mipmap-{name}'
    folder.mkdir(parents=True, exist_ok=True)
    size = int(48 * ratio)
    icon.resize((size, size), Image.LANCZOS).save(folder / 'ic_launcher.png')
    circular(icon.resize((size, size), Image.LANCZOS)).save(folder / 'ic_launcher_round.png')
    foreground(icon, int(108 * ratio)).save(folder / 'ic_launcher_foreground.png')

for path in RES.rglob('splash.png'):
    image = Image.open(path)
    splash(image.width, image.height).save(path)

(RES / 'values/ic_launcher_background.xml').write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
    '    <color name="ic_launcher_background">#FFFBF2</color>\n</resources>\n',
    encoding='utf-8',
)
print('android res updated')