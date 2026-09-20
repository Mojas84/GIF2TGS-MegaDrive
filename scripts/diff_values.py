#!/usr/bin/env python3
import gzip, json, sys

def load(p):
    with gzip.open(p, 'rb') as f: return json.loads(f.read())

def walk(a,b,path='root'):
    diffs=[]
    if type(a) != type(b): return [(path, type(a).__name__, type(b).__name__, a, b)]
    if isinstance(a, dict):
        for k in sorted(set(a)|set(b)):
            if k not in a: diffs.append((path+'.'+k,'missing-ref','current',None,b[k]))
            elif k not in b: diffs.append((path+'.'+k,'reference','missing-cur',a[k],None))
            else: diffs += walk(a[k],b[k],path+'.'+k)
    elif isinstance(a,list):
        if len(a)!=len(b): diffs.append((path,'list-len',len(a),len(b),None))
        for i,(x,y) in enumerate(zip(a,b)): diffs += walk(x,y,f'{path}[{i}]')
    elif a != b: diffs.append((path,'value','value',a,b))
    return diffs
r=load(sys.argv[1]); c=load(sys.argv[2]); d=walk(r,c)
print('diff_count',len(d))
for row in d[:100]: print(row)
