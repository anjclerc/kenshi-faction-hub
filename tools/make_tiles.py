# Découpe une image carrée (ex. GUI_Map.dds) en tuiles Leaflet : make_tiles.py <image> <dossier> <zoom_max>
import os, sys
from PIL import Image
src, out, maxz = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert('RGB')
T = 256
for z in range(maxz + 1):
    size = T * 2 ** z
    lvl = im if size == im.width else im.resize((size, size), Image.LANCZOS)
    for x in range(2 ** z):
        os.makedirs(f'{out}/{z}/{x}', exist_ok=True)
        for y in range(2 ** z):
            lvl.crop((x*T, y*T, (x+1)*T, (y+1)*T)).save(f'{out}/{z}/{x}/{y}.jpg', quality=78, optimize=True)
