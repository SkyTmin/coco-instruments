# Обработка рендера: 1280 → 640 со сглаживанием, тёмная обводка по силуэту
# (кирка обязана читаться и на глине, и на тёмном дереве панелей), WebP.
import os, sys
from PIL import Image, ImageFilter
src = sys.argv[1]; dst = sys.argv[2]
os.makedirs(dst, exist_ok=True)
for i in range(17):
    im = Image.open(os.path.join(src, f'raw_{i}.png')).convert('RGBA')
    # Поля: кирку чуть уменьшаем, чтобы обводке было место.
    big = Image.new('RGBA', im.size, (0, 0, 0, 0))
    k = 0.965
    sm = im.resize((int(im.width * k), int(im.height * k)), Image.LANCZOS)
    big.alpha_composite(sm, ((im.width - sm.width) // 2, (im.height - sm.height) // 2))
    a = big.split()[3]
    ring = a.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(1.2))
    out = Image.new('RGBA', big.size, (22, 14, 10, 0))
    out.putalpha(ring.point(lambda v: int(v * 0.92)))
    out.alpha_composite(big)
    out = out.resize((640, 640), Image.LANCZOS)
    out.save(os.path.join(dst, f'p{i}.webp'), 'WEBP', quality=90, method=6)
print('ok', sum(os.path.getsize(os.path.join(dst, f)) for f in os.listdir(dst)) // 1024, 'KB')
