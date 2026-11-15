import re,sys
ddl=open("db/esquema.sql").read()
doc=open("docs/modelo-relacional.md").read()
mer=re.search(r"```mermaid\n(.*?)```",doc,re.S).group(1)
# DDL: tablas y columnas
tablas={}
for m in re.finditer(r"CREATE TABLE (\w+) \((.*?)\n\) STRICT",ddl,re.S):
    cols=[]
    for line in m.group(2).splitlines():
        line=line.strip()
        mm=re.match(r"(\w+)\s+(INTEGER|TEXT|REAL)",line)
        if mm and mm.group(1).upper() not in ("PRIMARY","FOREIGN","CHECK","UNIQUE"): cols.append(mm.group(1))
    tablas[m.group(1)]=cols
# DDL: FKs (tabla destino por columna) incluida la compuesta
fks=set()
for m in re.finditer(r"CREATE TABLE (\w+) \((.*?)\n\) STRICT",ddl,re.S):
    t=m.group(1)
    for ref in re.finditer(r"REFERENCES (\w+)",m.group(2)): fks.add((ref.group(1),t))
# mermaid: entidades y columnas
ment={}
for m in re.finditer(r"^\s{4}(\w+) \{\n(.*?)\n\s{4}\}",mer,re.S|re.M):
    ment[m.group(1)]=[l.split()[1] for l in m.group(2).strip().splitlines()]
mrel=set()
for m in re.finditer(r"^\s+(\w+)\s+[|o}{]+--[|o}{]+\s+(\w+)\s+:",mer,re.M):
    mrel.add((m.group(1),m.group(2)))
ok=True
for t,cols in tablas.items():
    if t not in ment: print("FALTA entidad en mermaid:",t); ok=False; continue
    if cols!=ment[t]: print("COLUMNAS difieren en",t,"\n  ddl:",cols,"\n  mer:",ment[t]); ok=False
for e in ment:
    if e not in tablas: print("entidad en mermaid sin tabla:",e); ok=False
for fk in sorted(fks-mrel): print("FK en DDL sin relacion en mermaid:",fk); ok=False
for r in sorted(mrel-fks): print("relacion en mermaid sin FK en DDL:",r); ok=False
print("tablas DDL:",len(tablas),"entidades mermaid:",len(ment),"FKs DDL:",len(fks),"relaciones mermaid:",len(mrel))
print("COTEJO OK" if ok else "COTEJO CON DIFERENCIAS")
