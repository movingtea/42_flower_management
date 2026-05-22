import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'miniprogram', 'images', 'tabbar')
os.makedirs(OUT, exist_ok=True)
SIZE = 81


def save_icon(name, draw_fn, color):
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    draw_fn(d, color)
    img.save(os.path.join(OUT, name), 'PNG')


def home(draw, c):
    draw.polygon([(40, 18), (62, 34), (62, 58), (18, 58), (18, 34)], outline=c, width=4)
    draw.rectangle([32, 42, 48, 58], outline=c, width=3)


def category(draw, c):
    for i in range(3):
        for j in range(3):
            x, y = 20 + i * 18, 20 + j * 18
            draw.rounded_rectangle([x, y, x + 12, y + 12], radius=2, outline=c, width=3)


def mine(draw, c):
    draw.ellipse([28, 16, 52, 40], outline=c, width=4)
    draw.arc([18, 38, 62, 70], 20, 160, fill=c, width=4)


icons = [
    ('home.png', home, '#777777'),
    ('home-active.png', home, '#8fa89b'),
    ('category.png', category, '#777777'),
    ('category-active.png', category, '#8fa89b'),
    ('mine.png', mine, '#777777'),
    ('mine-active.png', mine, '#8fa89b'),
]

for fname, fn, col in icons:
    save_icon(fname, fn, col)
    print('created', fname)
