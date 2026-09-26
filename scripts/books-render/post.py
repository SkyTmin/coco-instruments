# Обложки: 1024 → 512 со сглаживанием, тёмная обводка по силуэту (книга
# обязана читаться и на пергаменте, и на тёмном дереве), WebP.
import os, sys
from PIL import Image, ImageFilter
src = sys.argv[1]; dst = sys.argv[2]
os.makedirs(dst, exist_ok=True)
for t in ['simple', 'rare', 'epic', 'legend']:
    im = Image.open(os.path.join(src, f'raw_{t}.png')).convert('RGBA')
    a = im.split()[3]
    ring = a.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(1.2))
    out = Image.new('RGBA', im.size, (22, 14, 10, 0))
    out.putalpha(ring.point(lambda v: int(v * 0.9)))
    out.alpha_composite(im)
    out = out.resize((512, 512), Image.LANCZOS)
    out.save(os.path.join(dst, f'{t}.webp'), 'WEBP', quality=88, method=6)
print('ok', sum(os.path.getsize(os.path.join(dst, f)) for f in os.listdir(dst)) // 1024, 'KB')
