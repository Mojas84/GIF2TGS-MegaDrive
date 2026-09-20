#!/usr/bin/env python3
import gzip,json,sys
from collections import defaultdict,Counter

def load(p):
 with gzip.open(p,'rb') as f:return json.loads(f.read())
def collect(x, counts, path='root'):
 if isinstance(x,dict):
  ty=x.get('ty')
  if ty:
   counts.setdefault(ty,Counter())
   for k in x: counts[ty][k]+=1
  for k,v in x.items(): collect(v,counts,path+'.'+k)
 if isinstance(x,list):
  for v in x: collect(v,counts,path)
r=load(sys.argv[1]);c=load(sys.argv[2]); rr={};cc={};collect(r,rr);collect(c,cc)
for ty in sorted(set(rr)|set(cc), key=str):
 print(ty,'ref',rr.get(ty), 'cur',cc.get(ty))
