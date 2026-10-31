#!/usr/bin/env python3
"""
Base Bambu Studio projects for the Bambu export, measured from the Bambu
Studio installed on this Mac.

A Bambu Studio project only keeps its settings (and so its mixed filaments)
when the file is a complete Bambu project, so the export starts from one that
Bambu Studio wrote itself.  For each printer this script

  1. lets the Bambu Studio CLI save a project with 2 and with 3 filaments of
     the printer's default PLA, and keeps the arrays whose length follows the
     filament count;
  2. saves one more with colours from and outside Bambu's measured flush
     table, and finds the per-nozzle minimum flush and flush data set that
     reproduce Bambu's own flush matrix (see bambuFlush.ts).

Output (rerun after a Bambu Studio update):
  src/workflows/vertex/core/bambu/projectTemplates.json
  src/workflows/vertex/core/bambu/flushTables.json

    python3 scripts/bambu_project_templates.py
"""
import colorsys, glob, json, math, os, subprocess, sys, tempfile, zipfile

APP = '/Applications/BambuStudio.app/Contents'
BIN = APP + '/MacOS/BambuStudio'
PROFILES = APP + '/Resources/profiles/BBL'
FLUSH = APP + '/Resources/flush/'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src', 'workflows', 'vertex', 'core', 'bambu')

PRINTERS = {
    'p2s': 'Bambu Lab P2S 0.4 nozzle',
    'x1c': 'Bambu Lab X1 Carbon 0.4 nozzle',
    'p1s': 'Bambu Lab P1S 0.4 nozzle',
    'a1': 'Bambu Lab A1 0.4 nozzle',
    'a1mini': 'Bambu Lab A1 mini 0.4 nozzle',
    'h2d': 'Bambu Lab H2D 0.4 nozzle',
    'h2c': 'Bambu Lab H2C 0.4 nozzle',
    'h2s': 'Bambu Lab H2S 0.4 nozzle',
}
# In and out of Bambu's measured flush table.
PROBE_COLOURS = ['#FFFFFF', '#000000', '#00AE42', '#E34A93', '#4CAF50', '#1B1889']
# Arrays that follow the filament count but stay one long in a CLI project.
SLOT_DEFAULTS = ['filament_map', 'filament_map_2', 'filament_nozzle_map', 'filament_volume_map']

CUBE = '''<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources><object id="1" type="model"><mesh><vertices>
  <vertex x="0" y="0" z="0"/><vertex x="20" y="0" z="0"/><vertex x="0" y="20" z="0"/><vertex x="20" y="20" z="0"/>
  <vertex x="0" y="0" z="20"/><vertex x="20" y="0" z="20"/><vertex x="0" y="20" z="20"/><vertex x="20" y="20" z="20"/>
 </vertices><triangles>
  <triangle v1="0" v2="2" v3="1"/><triangle v1="1" v2="2" v3="3"/><triangle v1="4" v2="5" v3="6"/><triangle v1="5" v2="7" v3="6"/>
  <triangle v1="0" v2="1" v3="4"/><triangle v1="1" v2="5" v3="4"/><triangle v1="2" v2="6" v3="3"/><triangle v1="3" v2="6" v3="7"/>
  <triangle v1="0" v2="4" v3="2"/><triangle v1="2" v2="4" v3="6"/><triangle v1="1" v2="3" v3="5"/><triangle v1="3" v2="7" v3="5"/>
 </triangles></mesh></object></resources>
 <build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 100 100 0"/></build>
</model>
'''


def load_profiles(kind):
    by = {}
    for f in glob.glob(os.path.join(PROFILES, kind, '**', '*.json'), recursive=True):
        try:
            d = json.load(open(f, encoding='utf-8'))
        except Exception:
            continue
        if d.get('name'):
            by[d['name']] = d
    return by


DB = {k: load_profiles(k) for k in ('machine', 'process', 'filament')}


def flat(kind, name):
    d = DB[kind][name]
    base = flat(kind, d['inherits']) if d.get('inherits') else {}
    r = dict(base)
    r.update(d)
    return r


def write_flat(kind, name, path, **override):
    r = flat(kind, name)
    r.pop('inherits', None)
    r['from'] = 'system'
    r['instantiation'] = 'true'
    r.update(override)
    json.dump(r, open(path, 'w'), indent=1)
    return r


def cli_project(work, machine, process, filaments, out):
    cube = os.path.join(work, 'cube.3mf')
    if not os.path.exists(cube):
        with zipfile.ZipFile(cube, 'w') as z:
            z.writestr('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')
            z.writestr('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
            z.writestr('3D/3dmodel.model', CUBE)
    subprocess.run([BIN, '--datadir', os.path.join(work, 'datadir'), '--load-settings', f'{machine};{process}',
                    '--load-filaments', ';'.join(filaments), '--export-3mf', out, cube],
                   capture_output=True, text=True, check=True)
    return json.loads(zipfile.ZipFile(out).read('Metadata/project_settings.config'))


# ---- Bambu's flush prediction (same as bambuFlush.ts) -------------------------

def rgb(h):
    return (int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16))


def read_table(name):
    lines = open(FLUSH + name).read().splitlines()
    colours = lines[1].split()
    pairs = [line.split() for line in lines[3:] if len(line.split()) == 3]
    return {'colours': colours, 'pairs': [[a, b, int(float(v))] for a, b, v in pairs]}


TABLES = [read_table('flush_data_standard.txt'), read_table('flush_data_dual_standard.txt'), read_table('flush_data_dual_highflow.txt')]


def lab(c):
    def g(x):
        return ((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92
    R, G, B = [g(v / 255.0) * 100 for v in c]
    x = 0.412453 * R + 0.357580 * G + 0.180423 * B
    y = 0.212671 * R + 0.715160 * G + 0.072169 * B
    z = 0.019334 * R + 0.119193 * G + 0.950227 * B

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 0.137931
    xn, yn, zn = f(x / 95.0489), f(y / 100), f(z / 108.8840)
    return (116 * yn - 16, 500 * (xn - yn), 200 * (yn - zn))


def de00(l1, l2):
    p25 = 25 ** 7
    C1 = math.hypot(l1[1], l1[2]); C2 = math.hypot(l2[1], l2[2]); Cm = (C1 + C2) / 2
    G = 0.5 * (1 - math.sqrt(Cm ** 7 / (Cm ** 7 + p25)))
    a1 = (1 + G) * l1[1]; a2 = (1 + G) * l2[1]; b1, b2 = l1[2], l2[2]
    c1 = math.hypot(a1, b1); c2 = math.hypot(a2, b2)
    h1 = 0 if (a1 == 0 and b1 == 0) else (math.atan2(b1, a1) % (2 * math.pi))
    h2 = 0 if (a2 == 0 and b2 == 0) else (math.atan2(b2, a2) % (2 * math.pi))
    dL = l2[0] - l1[0]; dC = c2 - c1
    if c1 * c2 == 0:
        dH = 0
    else:
        dh = h2 - h1
        if dh < -math.pi: dh += 2 * math.pi
        elif dh > math.pi: dh -= 2 * math.pi
        dH = 2 * math.sqrt(c1 * c2) * math.sin(dh / 2)
    Lm = (l1[0] + l2[0]) / 2; Cp = (c1 + c2) / 2; Hs = h1 + h2
    if c1 * c2 == 0: Hm = Hs
    elif abs(h1 - h2) <= math.pi: Hm = Hs / 2
    else: Hm = (Hs + 2 * math.pi) / 2 if Hs < 2 * math.pi else (Hs - 2 * math.pi) / 2
    r = math.radians
    T = 1 - 0.17 * math.cos(Hm - r(30)) + 0.24 * math.cos(2 * Hm) + 0.32 * math.cos(3 * Hm + r(6)) - 0.2 * math.cos(4 * Hm - r(63))
    dth = r(30) * math.exp(-((Hm - r(275)) / r(25)) ** 2)
    RC = 2 * math.sqrt(Cp ** 7 / (Cp ** 7 + p25))
    SL = 1 + 0.015 * (Lm - 50) ** 2 / math.sqrt(20 + (Lm - 50) ** 2); SC = 1 + 0.045 * Cp; SH = 1 + 0.015 * Cp * T
    RT = -math.sin(2 * dth) * RC
    return math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH))


def table(ds, a, b):
    t = TABLES[ds]
    fa = next((c for c in t['colours'] if de00(lab(rgb(c)), lab(a)) <= 5.0), None)
    fb = next((c for c in t['colours'] if de00(lab(rgb(c)), lab(b)) <= 5.0), None)
    if fa is None or fb is None:
        return None
    return next((v for x, y, v in t['pairs'] if x == fa and y == fb), None)


def formula(a, b):
    sr, sg, sb = [x / 255 for x in a]; dr, dg, db = [x / 255 for x in b]
    h1, s1, v1 = colorsys.rgb_to_hsv(sr, sg, sb); h2, s2, v2 = colorsys.rgb_to_hsv(dr, dg, db)
    h1 *= 360; h2 *= 360
    dx = math.cos(math.radians(h1)) * s1 * v1 - math.cos(math.radians(h2)) * s2 * v2
    dy = math.sin(math.radians(h1)) * s1 * v1 - math.sin(math.radians(h2)) * s2 * v2
    hs = min(1.2, math.hypot(dx, dy))
    fl = sr * 0.3 + sg * 0.59 + sb * 0.11; tl = dr * 0.3 + dg * 0.59 + db * 0.11
    if tl >= fl:
        lf = (tl - fl) ** 0.7 * 560
    else:
        lf = (fl - tl) * 80; hs = min(0.67 * v2 + 0.33 * v1, hs)
    hf = 230 * hs
    return max(math.sqrt(hf * hf + lf * lf - 2 * hf * lf * math.cos(math.radians(120))), 60)


def flush(ds, mn, a, b):
    if ds != 0:
        t = table(ds, a, b)
        if t is not None:
            return min(int(t), 900)
    t = table(0, a, b) if ds == 0 else None
    f = float(int(t) if t is not None else int(formula(a, b)))
    if ds != 0 and (a[0] * 0.3 + a[1] * 0.59 + a[2] * 0.11) > 180 / 255 and (b[0] * 0.3 + b[1] * 0.59 + b[2] * 0.11) < 75 / 255:
        f *= 1.3
    return min(int(f + mn), 900)


def fit_flush(cfg):
    colours = [rgb(c) for c in cfg['filament_colour']]
    n = len(colours)
    matrix = [int(float(v)) for v in cfg['flush_volumes_matrix']]
    nozzles = len(matrix) // (n * n)
    result = []
    for e in range(nozzles):
        block = matrix[e * n * n:(e + 1) * n * n]
        for ds in (0, 1, 2):
            offsets = [block[i * n + j] - flush(ds, 0, colours[i], colours[j])
                       for i in range(n) for j in range(n) if i != j and not (ds != 0 and table(ds, colours[i], colours[j]) is not None)]
            # Most common: float rounding in Bambu Studio moves a pair by one now and then.
            mn = max(set(offsets), key=offsets.count) if offsets else 0
            if all(abs(block[i * n + j] - flush(ds, mn, colours[i], colours[j])) <= 1 for i in range(n) for j in range(n) if i != j):
                result.append({'dataset': ds, 'min': mn})
                break
        else:
            sys.exit(f'flush matrix of nozzle {e + 1} not reproduced')
    return result


def main():
    os.makedirs(OUT, exist_ok=True)
    work = tempfile.mkdtemp(prefix='bambu-templates-')
    version = None
    templates = {}
    for key, machine_name in PRINTERS.items():
        m = write_flat('machine', machine_name, f'{work}/{key}_m.json')
        process = m['default_print_profile']
        filament = m['default_filament_profile'][0]
        write_flat('process', process, f'{work}/{key}_p.json')
        f = flat('filament', filament)
        paths = []
        for i, colour in enumerate(PROBE_COLOURS):
            p = f'{work}/{key}_f{i}.json'
            write_flat('filament', filament, p, filament_colour=[colour])
            paths.append(p)
        mp, pp = f'{work}/{key}_m.json', f'{work}/{key}_p.json'
        two = cli_project(work, mp, pp, paths[:2], f'{work}/{key}_2.3mf')
        three = cli_project(work, mp, pp, paths[:3], f'{work}/{key}_3.3mf')
        probe = cli_project(work, mp, pp, paths, f'{work}/{key}_probe.3mf')
        version = version or two['version']
        per = sorted(k for k, v in three.items()
                     if isinstance(v, list) and isinstance(two.get(k), list) and len(two[k]) == 2 and len(v) == 3)
        plus_two = sorted(k for k, v in three.items()
                          if isinstance(v, list) and isinstance(two.get(k), list) and len(two[k]) == 4 and len(v) == 5)
        config = {}
        for k, v in two.items():
            if k in per:
                config[k] = v[:1]
            elif k in plus_two:
                config[k] = [v[0], v[1], v[-1]]
            elif k == 'flush_volumes_matrix':
                continue
            else:
                config[k] = v
        templates[key] = {
            'machine': machine_name,
            'process': process,
            'filament': filament,
            'nozzles': len(two['nozzle_diameter']),
            'flush': fit_flush(probe),
            'perFilament': per,
            'plusTwo': plus_two,
            'config': config,
        }
        print(key, process, '|', filament, '| per-filament', len(per), '| flush', templates[key]['flush'])

    # The configs are nearly the same: keep one shared base and each printer's differences.
    base = {}
    first = templates['x1c']['config']
    for k, v in first.items():
        if all(t['config'].get(k) == v for t in templates.values()):
            base[k] = v
    for t in templates.values():
        t['config'] = {k: v for k, v in t['config'].items() if k not in base}
    out = {
        'source': 'Bambu Studio ' + version + ' (measured by scripts/bambu_project_templates.py)',
        'version': version,
        'slotDefaults': SLOT_DEFAULTS,
        'base': base,
        'printers': templates,
    }
    json.dump(out, open(os.path.join(OUT, 'projectTemplates.json'), 'w'), separators=(',', ':'))
    json.dump({'source': 'Bambu Studio ' + version + ' resources/flush', 'tables': TABLES},
              open(os.path.join(OUT, 'flushTables.json'), 'w'), separators=(',', ':'))
    print('base keys', len(base), 'bytes', os.path.getsize(os.path.join(OUT, 'projectTemplates.json')))


if __name__ == '__main__':
    main()
