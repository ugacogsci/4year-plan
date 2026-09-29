import json, re, collections, sys
sys.path.insert(0,'.')
from college import COLLEGE
P='/Users/michaelcrews/THE ADVISOR/planner/public/illinois/'
idx=json.load(open(P+'index.json'))
codes={c['code']:c for c in idx}
f26={c['code'] for c in json.load(open(P+'sections.json'))['courses']}
T={'current':1,'older':2,'archived':3,'partial':4,'login':5,'none':6}
best={}; why={}; src=collections.defaultdict(set)
def put(code,tier,s):
    if code not in codes: return
    src[code].add(s)
    if code not in best or T[tier]<T[best[code]]: best[code]=tier
def yr(s):
    m=re.findall(r'(20\d\d)',s or ''); return max(map(int,m)) if m else None
# engineering
e=json.load(open('eng/labels.json'))
for k,v in e.items():
    if v['label']=='found':
        tiers=[]
        for name,u in v['sources']:
            if name.startswith('grainger-syllabus-repo') or name in('course-website','google-doc'): tiers.append('current')
            else:
                y=yr(u); tiers.append('current' if (y and y>=2023) or name=='canvas-public-syllabus' and y is None else ('older' if y else 'current'))
        t=min(tiers,key=lambda x:T[x]); put(k,t,'eng:'+v['sources'][0][0])
    elif v['label']=='master-syllabus-only': put(k,'partial','eng:master')
    else: put(k,'none','eng:'+v['label'])
# sciences
s=json.load(open('las_sci/coverage.json'))
partners={}
for k,v in s.items():
    if v['status']=='found':
        tiers=[]
        for x in v['sources']:
            so=x.get('source'); y=yr(x.get('term',''))
            if so=='math-course-topics': tiers.append('partial')
            elif so in('app.mcb','app.sib'): tiers.append('current' if (y is None or y>=2023) else 'older')
            elif y is None: tiers.append('older')
            else: tiers.append('current' if y>=2023 else 'older')
        put(k,min(tiers,key=lambda x:T[x]),'sci:'+v['sources'][0].get('source'))
    elif v['status']=='found-via-crosslist': partners[k]=v.get('partner')
    else: put(k,'none','sci:not-public')
# humanities
h=json.load(open('las-hum/coverage.json'))
m={'found-current':'current','found-older':'older','archived-only':'archived','description-only':'partial','exists-login-only':'login','unverified':'login','not-found':'none'}
econbox_only=set()
for v in h:
    t=m[v['status']]
    if t=='current' and v['sources']==['econ-box:public'] or (t=='current' and set(v['sources'])<= {'econ-box:public','wayback:public-archived'} ):
        econbox_only.add(v['code'])
    put(v['code'],t,'hum:'+(v['sources'][0] if v['sources'] else v['status']))
# professional
p=json.load(open('coverage-professional.json'))
for k,v in p.items():
    L=v['label']
    if L=='found-live':
        ys=[yr(x.get('term','')) for x in v['hits']]; ys=[y for y in ys if y]
        put(k,'current' if ys and max(ys)>=2023 else 'older','prof:'+v['hits'][0]['source'])
    elif L=='found-archived-only': put(k,'archived','prof:wayback')
    elif L=='partial-only': put(k,'partial','prof:partial')
    else: put(k,'none','prof:none')
# canvas live public
for cid,title,n,files,cc,term in json.load(open('lms-archives/canvas_live_public.json')):
    y=yr(term)
    for c in cc:
        if n>2000 or files: put(c,'current' if y and y>=2023 else 'older','canvas-public')
# crosslist partners from sci and index twins: inherit
for k,pn in partners.items():
    pt=best.get(pn) if pn else None
    put(k, pt or 'current','sci:crosslist')
# twins: a course whose twin has a syllabus gets the same tier (cross-listed = same syllabus)
twin_gain=0
for c in idx:
    for t in c.get('twins',[]) or []:
        if t in best and (c['code'] not in best or T[best[t]]<T[best[c['code']]]) and best[t] in('current','older','archived'):
            if c['code'] not in best or best[c['code']] in ('none','partial','login'): twin_gain+=1
            best[c['code']]=best[t]; src[c['code']].add('twin:'+t)
unswept=[c for c in codes if c not in best]
for c in unswept: best[c]='none'
print('total',len(codes),'unswept by any sweep',len(unswept), collections.Counter(c.split()[0] for c in unswept).most_common(30))
print('twin gains',twin_gain)
def tab(sel,label):
    cnt=collections.Counter(best[c] for c in sel)
    print(label,len(sel),{k:cnt.get(k,0) for k in T})
tab(list(codes),'ALL')
tab([c for c in codes if c in f26],'FALL2026')
for lvl in (100,200,300,400): tab([c for c in codes if codes[c]['level']==lvl],'L%d'%lvl)
cols=collections.defaultdict(list)
for c in codes: cols[COLLEGE.get(c.split()[0],'other')].append(c)
for col,cs in sorted(cols.items(), key=lambda x:-len(x[1])): tab(cs,col)
tab([c for c in codes if c in econbox_only],'ECON box-only current')
print(sorted(econbox_only))
json.dump({c:{'tier':best[c],'src':sorted(src[c])} for c in codes},open('design/merged_coverage.json','w'))
