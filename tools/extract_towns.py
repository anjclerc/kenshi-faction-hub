# Extrait les positions des villes depuis les fichiers du jeu : python3 extract_towns.py "<Kenshi>/data"
import struct, sys, json, re
import os; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from fcs import read_mod
D=sys.argv[1].rstrip('/')+'/'  # dossier Kenshi/data
towns={}  # sid -> dict(name, ttype)
for m in ['gamedata.base','Newwworld.mod']:
    for rec in read_mod(D+m):
        if rec['type']==13:
            t=towns.setdefault(rec['sid'],{'name':rec['name'],'ttype':None})
            if rec['name']: t['name']=rec['name']
            if 'type' in rec['ints']: t['ttype']=rec['ints']['type']
# v17 : scan type-13 record headers: int len, int 13, int id, str name, str sid
for m in ['Dialogue.mod','rebirth.mod']:
    b=open(D+m,'rb').read()
    for mt in re.finditer(rb'\x0d\x00\x00\x00(....)(....)', b, re.S):
        o=mt.start()+8
        try:
            n=struct.unpack_from('<i',b,o)[0]
            if not (0<=n<80): continue
            name=b[o+4:o+4+n].decode('utf-8')
            o2=o+4+n; n2=struct.unpack_from('<i',b,o2)[0]
            if not (3<n2<60): continue
            sid=b[o2+4:o2+4+n2].decode('utf-8')
            if not re.fullmatch(r'\d+-[^\x00]+\.(mod|base)', sid): continue
        except Exception: continue
        t=towns.setdefault(sid,{'name':name,'ttype':None})
        if name: t['name']=name
        # look for 'type' int key nearby (within record)
        k=b.find(b'\x04\x00\x00\x00type', o2, o2+2000)
        if k>0: t['ttype']=struct.unpack_from('<i',b,k+8)[0]
print('towns', len(towns))
inst={}
for lv in ['Newwworld','Dialogue','rebirth']:
    b=open(D+f'newland/leveldata/{lv}/leveldata.level','rb').read()
    for sid in towns:
        sb=sid.encode(); pat=struct.pack('<i',len(sb))+sb
        for mm in re.finditer(re.escape(pat), b):
            x,y,z=struct.unpack_from('<3f',b,mm.end())
            k=mm.start(); iid=None
            for L in range(1,60):
                if k-L-4>=0 and struct.unpack_from('<i',b,k-L-4)[0]==L:
                    iid=b[k-L:k].decode('latin1'); break
            if abs(x)<300000 and abs(z)<300000 and abs(y)<20000:
                inst[iid or f'{sid}@{lv}@{k}']=dict(sid=sid,wx=x,wy=y,wz=z,src=lv)
out=[dict(name=towns[v['sid']]['name'], ttype=towns[v['sid']]['ttype'], **v) for v in inst.values()]
json.dump(out,open('towns_all.json','w'),indent=1)  # coordonnées monde ; pixel = (w + 147456) / 36
from collections import Counter
print(len(out), Counter(o['ttype'] for o in out))
for o in sorted(out,key=lambda o:(str(o['ttype']),o['name'])):
    if o['ttype'] not in (8,): print(o['ttype'], o['name'], round(o['wx']), round(o['wz']), o['src'])
