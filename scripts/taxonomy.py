"""Weekly: pull composition classes and sizes from SsODNet's Best-Fit Table (ssoBFT,
Berthier et al. 2023, A&A 671, A151), which compiles spectra and survey colours
(Gaia DR3, SDSS, MOVIS, literature) for ~1.4 million asteroids plus comet nuclei.
Writes data/taxonomy.json with only the objects that are on the map.
"""
import json, os, sys, time, urllib.request
from datetime import datetime, timezone

DATA = os.path.join(os.path.dirname(__file__), '..', 'data')
OUT = os.path.join(DATA, 'taxonomy.json')
MAX_AGE_DAYS = 7
URL = 'https://ssp.imcce.fr/data/ssoBFT-latest_{}.parquet'


def fresh():
    try:
        g = json.load(open(OUT))['generated']
        return (time.time() - datetime.fromisoformat(g.replace('Z', '+00:00')).timestamp()) < MAX_AGE_DAYS * 86400
    except Exception:
        return False


def download(kind):
    path = f'/tmp/bft-{kind}.parquet'
    req = urllib.request.Request(URL.format(kind), headers={'User-Agent': 'astromine-data-bot'})
    with urllib.request.urlopen(req, timeout=600) as r, open(path, 'wb') as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    print(f'{kind}: {os.path.getsize(path) / 1e6:.0f} MB')
    return path


def col(names, *cands):
    low = {n.lower(): n for n in names}
    for c in cands:
        if c.lower() in low:
            return low[c.lower()]
    return None


def num(v):
    try:
        v = float(v)
        return round(v, 4) if v == v and v > 0 else None
    except Exception:
        return None


def main():
    if fresh() and '--force' not in sys.argv:
        print('taxonomy.json is fresh, skipping'); return
    import pyarrow.parquet as pq

    def keys_of(name):
        name = name.strip()
        out = [name]
        if name.startswith('(') and name.endswith(')'): out.append(name[1:-1])
        if '(' in name: out.append(name[name.index('(') + 1:name.rindex(')')])
        parts = name.split(' ', 1)
        if parts[0].isdigit(): out.append(parts[0])
        if '/' in name: out += [name.split('/', 1)[0], name.split('/', 1)[1]]
        return out

    ast = json.load(open(os.path.join(DATA, 'asteroids.json')))
    names = ast['cols']['name'] if 'cols' in ast else [r[0] for r in ast['rows']]
    want = {k for n in names for k in keys_of(n)}
    try:
        com = json.load(open(os.path.join(DATA, 'comets.json')))
        cnames = [r[0] for r in com.get('rows', [])]
    except Exception:
        cnames = []
    cwant = {k for n in cnames for k in keys_of(n)}

    out = {'ast': {}, 'com': {}}
    # ---- asteroids ----
    p = download('Asteroid')
    schema = pq.read_schema(p).names
    c_num, c_name = col(schema, 'sso_number', 'number'), col(schema, 'sso_name', 'name')
    c_cls, c_tech = col(schema, 'taxonomy.class'), col(schema, 'taxonomy.technique')
    c_d, c_alb = col(schema, 'diameter.value'), col(schema, 'albedo.value')
    print('asteroid columns:', c_num, c_name, c_cls, c_tech, c_d, c_alb)
    use = [c for c in (c_num, c_name, c_cls, c_tech, c_d, c_alb) if c]
    pf = pq.ParquetFile(p)
    for b in pf.iter_batches(columns=use, batch_size=200_000):
        d = b.to_pydict()
        for i in range(b.num_rows):
            n = d[c_num][i] if c_num else None
            nm = d[c_name][i] if c_name else None
            key = str(int(n)) if n not in (None, 0) and n == n else None
            if key not in want: key = nm if nm in want else None
            if not key: continue
            cls = d[c_cls][i] if c_cls else None
            tech = d[c_tech][i] if c_tech else None
            rec = [cls if isinstance(cls, str) and cls.strip() else None,
                   tech if isinstance(tech, str) and tech.strip() else None,
                   num(d[c_d][i]) if c_d else None, num(d[c_alb][i]) if c_alb else None]
            if any(v is not None for v in rec):
                out['ast'][key] = rec
    os.remove(p)
    # ---- comets (nucleus sizes) ----
    try:
        p = download('Comet')
        t = pq.read_table(p).to_pydict()
        cn, cd = col(t.keys(), 'sso_name', 'name'), col(t.keys(), 'diameter.value')
        print('comet columns:', cn, cd)
        for nm, dv in zip(t.get(cn, []), t.get(cd, [])):
            v = num(dv)
            if not nm or v is None: continue
            for k in keys_of(nm):
                if k in cwant: out['com'][k] = v
    except Exception as e:
        print('comets skipped:', e)

    out.update(generated=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
               source='SsODNet ssoBFT (Berthier et al. 2023, A&A 671, A151)')
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))
    cls_n = sum(1 for v in out['ast'].values() if v[0])
    print(f"taxonomy.json: {len(out['ast'])} asteroids ({cls_n} with a class), {len(out['com'])} comet keys")


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # never break the hourly build; keep the previous file
        print('taxonomy step failed, keeping previous data:', e)
