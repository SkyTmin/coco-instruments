# Сундуки: 1024 → 512 со сглаживанием, тёмная обводка по силуэту (сундук
# обязан читаться и на пергаменте, и на тёмном дереве), WebP.
import os, sys
from PIL import Image, ImageFilter
src = sys.argv[1]; dst = sys.argv[2]
os.makedirs(dst, exist_ok=True)
for t in ['common', 'rare', 'epic', 'legend']:
    for s in ['closed', 'open']:
        im = Image.open(os.path.join(src, f'raw_{t}-{s}.png')).convert('RGBA')
        a = im.split()[3]
        ring = a.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(1.2))
        out = Image.new('RGBA', im.size, (22, 14, 10, 0))
        out.putalpha(ring.point(lambda v: int(v * 0.9)))
        out.alpha_composite(im)
        out = out.resize((512, 512), Image.LANCZOS)
        out.save(os.path.join(dst, f'{t}-{s}.webp'), 'WEBP', quality=86, method=6)
# Сундук-загадка: неподвижный кадр (посадка) и лента вращения (полёт).
im = Image.open(os.path.join(src, 'raw_mystery-closed.png')).convert('RGBA')
im.resize((512, 512), Image.LANCZOS).save(os.path.join(dst, 'mystery-closed.webp'), 'WEBP', quality=86, method=6)
strip = Image.open(os.path.join(src, 'raw_mystery-spin.png')).convert('RGBA')
strip.save(os.path.join(dst, 'mystery-spin.webp'), 'WEBP', quality=80, method=6)
print('ok', sum(os.path.getsize(os.path.join(dst, f)) for f in os.listdir(dst)) // 1024, 'KB')
