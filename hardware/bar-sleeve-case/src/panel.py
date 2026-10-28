"""Panel profiles for the bar sleeve case. Pick one with the PANEL environment variable (default p3):
    PANEL=p25 python3 case2.py ../stl-p25
Everything panel-specific lives here; case.py, case2.py, plate3.py, diffuser.py and plinth.py derive the rest.
Panel frame: x right seen from the front, z up from the panel centre (ZC). Units mm.
Positions the case keeps relative to the P3 build move by DX (bore half width vs P3) and DZ (bore half height vs P3);
both are exactly 0 for P3, so its STLs don't change."""
import os

PROFILES = {
    'p3': dict(                          # Waveshare RGB-Matrix-P3-64x32, SKU 20117 (the current build)
        name='Waveshare P3 64x32',
        w=192.0, h=96.0, t=14.5,         # outline, thickness (measured)
        pitch=3.0, rib=0.6,              # diffuser grid: LED pitch, rib width (0.4 nozzle)
        # brass M3 inserts on the panel back (x, z - ZC), photo estimates checked with the insert template;
        # (-88, -26) is under the S3
        inserts=((-88.0, 31.0), (88.0, 31.0), (-88.0, -26.0), (88.0, -26.0), (-14.0, 38.0), (7.0, -36.0)),
        standoffs=((-88.0, 31.0), (88.0, 31.0), (88.0, -26.0), (7.0, -36.0)),   # plate v3 bolts to these
        tie_bridge=(-17.0, 17.0, 63.0, 78.0),   # plate v3 tie-down bridge: x0, x1, z0, z1 (z in the P3 case, moves by DZ)
        hooks=(-22.5, 22.5),             # ribbon hooks on the plate (x), on bars between the louvers / pills
        posts=((-75, 43), (75, 43), (-60, -43), (60, -43)),   # plate v2 only: foam hold-downs (x, z - ZC)
        assumed=(),
    ),
    'p25': dict(                         # Waveshare RGB-Matrix-P2.5-64x32, SKU 23707 (standard) / 33839 (GOB)
        name='Waveshare P2.5 64x32',
        w=160.0, h=80.0, t=14.5,         # outline from Waveshare's spec table; thickness ASSUMED (= P3), measure
        pitch=2.5, rib=0.45,             # 0.45 rib = two lines from a 0.2 nozzle; too thin for a 0.4
        # inserts ASSUMED: the P3 layout kept at the same distances from the panel edges. Print the insert template
        # (plate3.py) on the real panel and correct these before printing the plate. (-72, -18) is under the S3.
        inserts=((-72.0, 23.0), (72.0, 23.0), (-72.0, -18.0), (72.0, -18.0), (-14.0, 30.0), (7.0, -28.0)),
        standoffs=((-72.0, 23.0), (72.0, 23.0), (72.0, -18.0), (7.0, -28.0)),
        tie_bridge=(-9.0, 17.0, 59.0, 74.0),   # narrowed (moved ribbon hook) and lowered 4 mm (clears the top louver band)
        hooks=(-13.5, 22.5),             # left hook moved clear of the S3's IDC plug
        posts=((-60, 35), (60, 35), (-14, -36), (60, -36)),   # plate v2 only (placeholders)
        assumed=('thickness', 'inserts', 'PI IN and power socket positions (ribbon and cable routes)'),
    ),
}

KEY = os.environ.get('PANEL', 'p3').lower()
if KEY not in PROFILES:
    raise SystemExit(f'PANEL={KEY!r}: use one of {", ".join(PROFILES)}')
P = PROFILES[KEY]
COLS, ROWS = 64, 32                      # pixels (all profiles)

# case opening (bore): the same borders past the panel edge for every panel
BORE_PAD_X, BORE_PAD_Z, BORE_R = 10.0, 4.65, 11.5
BORE_HX = P['w'] / 2 + BORE_PAD_X        # P3: 106
BORE_HZ = P['h'] / 2 + BORE_PAD_Z        # P3: 52.65
DX = BORE_HX - (192.0 / 2 + BORE_PAD_X)  # 0 for P3
DZ = BORE_HZ - (96.0 / 2 + BORE_PAD_Z)   # 0 for P3
