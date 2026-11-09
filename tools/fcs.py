import struct, sys
class R:
    def __init__(s,b,o=0): s.b=b; s.o=o
    def i(s): v=struct.unpack_from('<i',s.b,s.o)[0]; s.o+=4; return v
    def f(s): v=struct.unpack_from('<f',s.b,s.o)[0]; s.o+=4; return v
    def bo(s): v=s.b[s.o]; s.o+=1; return bool(v)
    def s(s):
        n=s.i(); v=s.b[s.o:s.o+n].decode('utf-8','replace'); s.o+=n; return v
def read_mod(path):
    r=R(open(path,'rb').read())
    t=r.i(); assert t in (16,17), t
    r.i(); hdr=[r.s() for _ in range(4)]; r.i()  # version, author, desc, deps, refs, flags
    n=r.i(); recs=[]
    for _ in range(n):
        rec={}
        r.i(); rec['type']=r.i(); r.i(); rec['name']=r.s(); rec['sid']=r.s(); r.i()
        rec['bools']={r.s():r.bo() for _ in range(r.i())}
        rec['floats']={r.s():r.f() for _ in range(r.i())}
        rec['ints']={r.s():r.i() for _ in range(r.i())}
        rec['vec3']={r.s():(r.f(),r.f(),r.f()) for _ in range(r.i())}
        rec['vec4']={r.s():(r.f(),r.f(),r.f(),r.f()) for _ in range(r.i())}
        rec['strings']={r.s():r.s() for _ in range(r.i())}
        rec['files']={r.s():r.s() for _ in range(r.i())}
        refs={}
        for _ in range(r.i()):
            cat=r.s(); refs[cat]=[(r.s(),r.i(),r.i(),r.i()) for _ in range(r.i())]
        rec['refs']=refs
        inst=[]
        for _ in range(r.i()):
            iid=r.s(); tgt=r.s(); pos=(r.f(),r.f(),r.f()); rot=(r.f(),r.f(),r.f(),r.f())
            states=[r.s() for _ in range(r.i())]
            inst.append((iid,tgt,pos,rot,states))
        rec['inst']=inst
        recs.append(rec)
    assert r.o==len(r.b), (r.o,len(r.b))
    return recs
