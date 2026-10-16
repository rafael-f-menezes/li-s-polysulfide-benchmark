#!/usr/bin/env python3
"""
build_data.py - regenerate the data layer of the Li-S polysulfide benchmark
interactive repository from the canonical exports under ../data_analysis/.

It (1) copies the raw, downloadable data files into data/ with unit-bearing
column names, (2) converts the NBO spreadsheet to CSV, (3) exports the complete
harmonic normal-mode table behind the interactive spectrum viewer, (4) computes
the discharge-voltage table with the paper's own `lis_energetics` code instead
of retyping it, (5) copies the extra SI figures that the SI text deposits with
the data, (6) emits the embedded JavaScript data modules under assets/js/data/
that the static site reads with no network access (so the page works from
file:// and from GitHub Pages identically), and (7) bundles data/ into
data/all_data.zip.

Nothing here is hand-transcribed; every value traces to ../data_analysis/.
The counts the paper prints (248 thermochemistries, 202 analysed, 132 CCSD
rows, 777 bond critical points, 601 NBO rows, 977 normal modes) are asserted,
so a silent drift between the paper and this repository fails the build.
Run from the repository root:  python3 build_data.py
"""

import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

# ----------------------------------------------------------------------------
# Paths
# ----------------------------------------------------------------------------
REPO = Path(__file__).resolve().parent
DA = (REPO / ".." / "data_analysis").resolve()
FE = DA / "free_energies"
QT = DA / "qtaim"
VIBDIR = DA / "vibrational_modes"
VIB = VIBDIR / "tables"
NBO = DA / "NBO"
PAPER_FIGS = (REPO / ".." / "paper_drafts" / "figs").resolve()

DATA = REPO / "data"
JSDATA = REPO / "assets" / "js" / "data"

SOLVENTS = ["DMSO", "TEGDME"]

# The paper's own analysis code is the single source of the reference frame,
# the voltage definitions and the frequency-scaling constants.
sys.path.insert(0, str(FE))
sys.path.insert(0, str(VIBDIR))
import lis_energetics as lis  # noqa: E402
import lis_vibmodes as vib  # noqa: E402

#: Scale factor of the solvent and TFSI- modes (the polysulfide bands are
#: reported unscaled). Read from the pipeline, never retyped.
VIB_SOLVENT_SCALE = vib.SOLVENT_SCALE

# ----------------------------------------------------------------------------
# Counts the manuscript prints. A mismatch means the canonical exports moved
# under the paper (or the paper under them); fix the source, not the assert.
# ----------------------------------------------------------------------------
EXPECTED = {
    "data_all_rows": 248,          # M06-2X/def2-TZVPPD/SMD thermochemistries
    "analysed_rows": 202,          # rows entering the analysis (x <= 8, no duplicate rows, no electrolyte rows outside their own medium)
    "ccsd_rows": 132,              # composite-CCSD Gibbs energies
    "bcps": 777,                   # QTAIM bond critical points, both solvents (DMSO LiS3 rows since 2026-09-16)
    "bcps_by_solvent": {"DMSO": 383, "TEGDME": 394},
    "charge_systems": 131,         # QTAIM charge systems (66 DMSO + 65 TEGDME, the DMSO LiS3 saddle point included)
    "nbo_rows": 601,               # NBO donor->acceptor interactions incl. TFSI- (S8 = D4d-crown rows in both solvents: TEGDME 2026-09-22, DMSO 2026-09-23)
    "modes": 977,                  # harmonic normal modes, 39 species x 2 solvents
    "vib_species_per_solvent": 39,
}

# ----------------------------------------------------------------------------
# Units on the downloadable files
# ----------------------------------------------------------------------------
# The canonical exports under ../data_analysis/ carry bare column names, and
# several files mix unit systems in adjacent columns: in data_all.csv every
# energy is in Hartree except HOMO, which is in eV, and in the thermodynamics
# summary the Hartree totals sit beside eV formation energies. Anyone opening
# the downloaded CSV has no way to tell. The canonical files keep their names
# (the analysis code reads them), so the unit suffixes are
# applied here, on the way into data/, and documented in data/DATA_DICTIONARY.md.
#
# Columns absent from a mapping are passed through unchanged: identifiers,
# integer counts, formal charges, and the genuinely dimensionless QTAIM
# descriptors (ELF, LOL, ellipticity, |V|/G, lambda1/lambda3).
UNIT_RENAMES = {
    "data_all.csv": {
        "SCF": "SCF_Ha", "E0+ZPVE": "E0+ZPVE_Ha", "Eint": "Eint_Ha",
        "E0+ENTHALPY": "E0+ENTHALPY_Ha", "E0+GIBBS": "E0+GIBBS_Ha",
        "HOMO": "HOMO_eV", "CCSD_SCF": "CCSD_SCF_Ha", "CCSD_GIBB": "CCSD_GIBB_Ha",
    },
    "polysulfide_thermodynamics_summary.csv": {
        "E0+GIBBS": "E0+GIBBS_Ha", "CCSD_GIBB": "CCSD_GIBB_Ha", "HOMO": "HOMO_eV",
        "dG_form": "dG_form_eV", "dG_form_per_atom": "dG_form_per_atom_eV",
        "dG_form_per_S": "dG_form_per_S_eV", "dG_form_ccsd": "dG_form_ccsd_eV",
        "dG_form_ccsd_per_atom": "dG_form_ccsd_per_atom_eV",
        "dG_form_ccsd_per_S": "dG_form_ccsd_per_S_eV",
        "dG_ccsd_minus_dft": "dG_ccsd_minus_dft_eV",
    },
    "qtaim_bcp_final.csv": {
        "d": "d_Ang", "rho": "rho_au", "lap": "lap_au", "H": "H_au",
        "EHB": "EHB_kcal_mol",
    },
    "qtaim_charges_final.csv": {"Charge": "Charge_e", "q_NNA": "q_NNA_e"},
    "qtaim_charge_summary_final.csv": {
        "q_sum": "q_sum_e", "q_mean": "q_mean_e",
        "q_min": "q_min_e", "q_max": "q_max_e",
    },
    "qtaim_ss_summary_final.csv": {
        "d_mean": "d_mean_Ang", "d_std": "d_std_Ang",
        "rho_mean": "rho_mean_au", "rho_std": "rho_std_au",
        "H_mean": "H_mean_au", "EHB_mean": "EHB_mean_kcal_mol",
    },
    # Raman activities are A^4/amu, IR activities km/mol, so the fingerprint
    # files take different suffixes for the same bare column names.
    "_fingerprint_raman": {
        "f1": "f1_cm1", "f2": "f2_cm1", "f3": "f3_cm1",
        "a1": "a1_A4_amu", "a2": "a2_A4_amu", "a3": "a3_A4_amu",
    },
    "_fingerprint_ir": {
        "f1": "f1_cm1", "f2": "f2_cm1", "f3": "f3_cm1",
        "a1": "a1_km_mol", "a2": "a2_km_mol", "a3": "a3_km_mol",
    },
    "_nbo": {"E2": "E2_kcal_mol"},
}


def _rename_key(name):
    if name.startswith("fingerprint_raman"):
        return "_fingerprint_raman"
    if name.startswith("fingerprint_ir"):
        return "_fingerprint_ir"
    if name.startswith("nbo_") or name.startswith("data_") and "full" in name:
        return "_nbo"
    return name


def copy_with_units(src, dest_dir, name=None):
    """Copy a CSV into data/ with unit-bearing column names."""
    name = name or Path(src).name
    mapping = UNIT_RENAMES.get(_rename_key(name), {})
    df = pd.read_csv(src)
    unknown = set(mapping) - set(df.columns)
    if unknown:
        raise KeyError(f"{name}: unit mapping names missing columns {sorted(unknown)}")
    df.rename(columns=mapping).to_csv(Path(dest_dir) / name, index=False)


def write_with_units(df, dest_path):
    """Write an in-memory frame with unit-bearing column names."""
    dest_path = Path(dest_path)
    mapping = UNIT_RENAMES.get(_rename_key(dest_path.name), {})
    df.rename(columns={k: v for k, v in mapping.items()
                       if k in df.columns}).to_csv(dest_path, index=False)


# ----------------------------------------------------------------------------
# Species identity helpers
# ----------------------------------------------------------------------------
SUB = str.maketrans("0123456789", "₀₁₂₃₄₅₆₇₈₉")
CHARGE_SUP = {0: "", -1: "⁻", -2: "²⁻"}  # '', '⁻', '²⁻'


def parse_label(label):
    """Parse any of the dataset's label conventions into (n_Li, x, q).

    Handles XYZ filenames and MOL/System columns:
      Li2S6 / Li2S6- / Li2S6-1 / Li2S6-2   (n_Li=2)
      LiS6  / LiS6-  / LiS6-1              (n_Li=1)
      S6    / S6-1   / S6-2               (n_Li=0)
    A bare trailing '-' means charge -1 (DMSO convention); '-1'/'-2' are explicit.
    Returns None for non-matrix labels (Li, Li+, S8 refs handled by caller, x>8, copies).
    """
    s = label.strip()
    if "(copy)" in s or s in ("Li", "Li+", "Li-atom"):
        return None
    if s.startswith("Li2"):
        n_li, rest = 2, s[3:]
    elif s.startswith("Li"):
        n_li, rest = 1, s[2:]
    elif s.startswith("S"):
        n_li, rest = 0, s
    else:
        return None
    m = re.match(r"^S(\d*)(.*)$", rest)
    if not m:
        return None
    x = int(m.group(1)) if m.group(1) else 1  # implicit x=1 for Li2S, LiS, S
    suf = m.group(2)
    if suf == "":
        q = 0
    elif suf == "-":
        q = -1
    elif suf in ("-1",):
        q = -1
    elif suf in ("-2",):
        q = -2
    else:
        return None
    return (n_li, x, q)


def canon(n_li, x, q):
    return f"{n_li}_{x}_{q}"


def formula(n_li, x):
    li = {0: "", 1: "Li", 2: "Li2"}[n_li]
    xs = "" if x == 1 else str(x)  # subscript 1 omitted by convention (Li2S, LiS, S)
    return f"{li}S{xs}"


def display_label(n_li, x, q):
    """Unicode species label with the paper's radical-dot rule: a species is
    a radical iff n_Li + |q| is odd (lis_energetics.is_radical), so S_x•⁻,
    Li2S_x•⁻ and the neutral LiS_x• carry the dot; dianions and LiS_x⁻ do not."""
    li = {0: "", 1: "Li", 2: "Li₂"}[n_li]
    xs = "" if x == 1 else str(x).translate(SUB)
    dot = "•" if lis.is_radical(n_li, q) else ""
    return f"{li}S{xs}{dot}{CHARGE_SUP[q]}"


def family_name(n_li):
    return {0: "Sₓ", 1: "LiSₓ", 2: "Li₂Sₓ"}[n_li]


def filename_label(n_li, x, q):
    """Unambiguous, filesystem-safe geometry filename (matches data_all/TEGDME style)."""
    base = formula(n_li, x)
    return base if q == 0 else f"{base}-{-q}"  # e.g. Li2S6, Li2S6-1, Li2S6-2


_INTERACTION_RE = re.compile(r"^\s*(\d+)([A-Za-z]+)--(\d+)([A-Za-z]+)\s*$")


def parse_interaction(s):
    """Parse a QTAIM Interaction string like '7S--6S' or '5S--10Li' into
    (i, elem_i, j, elem_j) with 1-based atom serials. Returns (None,)*4 on miss."""
    m = _INTERACTION_RE.match(str(s))
    if not m:
        return (None, None, None, None)
    return (int(m.group(1)), m.group(2), int(m.group(3)), m.group(4))


# ----------------------------------------------------------------------------
# Named flags and notes (paper Sec. 2.8, SI Section S12), keyed by
# (solvent, n_Li, x, q). A FLAG marks an entry the paper marks (dagger in its
# tables, red flag in the SI); a NOTE is information the paper attaches to an
# entry that is otherwise used normally.
# ----------------------------------------------------------------------------
FLAGS = {
    # Neutral LiS3 radical in DMSO (2026-09-15): retained as a FLAGGED entry.
    ("DMSO", 1, 3, 0): (
        "Flagged (dagger in the paper): not a minimum. The SMD optimization terminated "
        "normally on a C2v first-order saddle point with one imaginary mode at 60i cm-1 "
        "(IR intensity 57 km/mol, force constant 0.026 mDyn/A) and no minimum was located. "
        "Its energies are retained at both levels; the thermal corrections omit the imaginary "
        "mode, so the Gibbs energy is an upper bound, high by about 0.03 eV from that mode "
        "alone (paper Sec. 2.8, SI Section S12)."),
    ("DMSO", 2, 3, -2): (
        "Flagged suspect: its raw free energy lies above that of the monoanion Li2S3-, "
        "inverting the ordering found in TEGDME. Retained in the tables (red-flagged in the "
        "SI) and excluded from the redox-ladder figure and statistics. Its CCSD density also carries a non-nuclear "
        "attractor basin (see the QTAIM note). Paper: caveats section of the Methods, Supplementary Note 12."),
    ("TEGDME", 1, 5, -1): (
        "Flagged: monodentate lithium coordination where every comparable species is "
        "bidentate, and a formation energy 0.9 eV above its own ladder. Possibly a genuine "
        "difference in coordination rather than a failure, so its energies are retained "
        "(paper: caveats section of the Methods, Supplementary Note 12)."),
}

NNA_NOTE = (
    "QTAIM: the CCSD density of this dianion has a non-nuclear attractor, a basin with no "
    "nucleus holding 1.07 to 1.65 e (the S···NNA bond paths of the BCP table). With that basin "
    "counted the atomic charges sum to the formal charge, so it is reported as a finding on the "
    "diffuse dianion density, not as a failure (Supplementary Note 8).")
NOTES = {
    # DMSO LiS3 (2026-09-17): the QTAIM rows of the saddle point joined the tables.
    ("DMSO", 1, 3, 0): (
        "QTAIM on the saddle-point CCSD density: four bond critical points, two covalent S-S at "
        "1.991 A (rho 0.173 a.u.) and two closed-shell Li-S at 2.409 A (rho 0.020 a.u.); charges "
        "Li +0.94, terminal S -0.49, central S +0.04 e, summing to the formal charge with no "
        "non-nuclear attractor. Its DMSO/TEGDME pair is an isomer pair (C2v saddle vs C1 minimum), "
        "so it is included in the cross-solvent charge parity with a dagger (paper: bonding-topology section, Supplementary Note 12)."),
    ("DMSO", 2, 1, -2): NNA_NOTE,
    ("TEGDME", 2, 1, -2): NNA_NOTE,
    ("DMSO", 2, 3, -2): NNA_NOTE,
    ("TEGDME", 1, 3, 0): (
        "A minimum, but its solvation free energy is +0.43 eV, which a dielectric cannot "
        "produce for a neutral molecule; plausibly a higher isomer, so the DMSO and TEGDME "
        "LiS3 entries are not solvent-comparable (paper: caveats section of the Methods)."),
}
# Fallback text for the geometry tab (app.js) should the DMSO LiS3 geometry ever
# be missing again; since 2026-09-17 the saddle-point CCSD deck geometry is
# exported like every other species, so this is not normally shown.
LIS3_DMSO_NOTE = ("Neutral LiS3 in DMSO is a first-order saddle point (one imaginary mode, 60i cm-1), "
                  "retained as a flagged entry; its QTAIM analysis is on the saddle-point CCSD density.")

# Labels of the non-polysulfide reference spectra (solvent molecules and the
# TFSI- counter-ion) in the vibrational tree.
REF_LABELS = {"DMSO": "DMSO", "TEGDME": "TEGDME", "TFSI-1": "TFSI⁻"}
# Display labels of the vibrational families (lis_vibmodes.FAMILY_ORDER +
# NONPOLY_FAMILIES), radical dots per the rule above.
VIB_FAMILY_LABELS = {
    "Li2Sx": "Li₂Sₓ", "Li2Sx-1": "Li₂Sₓ•⁻", "Li2Sx-2": "Li₂Sₓ²⁻",
    "LiSx": "LiSₓ•", "LiSx-": "LiSₓ⁻",
    "Sx": "Sₓ", "Sx-1": "Sₓ•⁻", "Sx-2": "Sₓ²⁻",
    "Solvent": "Solvents", "Anion-ref": "Counter-ion",
}


def js_dump(varname, obj, path):
    path.write_text(
        f"// Auto-generated by build_data.py - do not edit by hand.\n"
        f"window.{varname} = {json.dumps(obj, ensure_ascii=False, indent=0)};\n",
        encoding="utf-8",
    )


# ----------------------------------------------------------------------------
# 1. Geometries
# ----------------------------------------------------------------------------
def build_geometries():
    geom = {s: {} for s in SOLVENTS}
    for solvent in SOLVENTS:
        cps = QT / "QTAIM_final" / solvent / "cps"
        outdir = DATA / "geometries" / solvent
        outdir.mkdir(parents=True, exist_ok=True)
        for old in outdir.glob("*.xyz"):
            old.unlink()
        for xyz in sorted(cps.glob("mol_*.xyz")):
            raw = xyz.stem[len("mol_"):]
            pid = parse_label(raw)
            if pid is None:
                continue
            n_li, x, q = pid
            if x > 8:
                continue
            text = xyz.read_text()
            lines = [ln for ln in text.splitlines() if ln.strip()]
            try:
                natom = int(lines[0].strip())
            except ValueError:
                natom = len(lines) - 2
            # rebuild a clean XYZ with an informative comment line
            body = lines[2:2 + natom]
            fname = filename_label(n_li, x, q)
            comment = f"{fname}  q={q}  n_Li={n_li}  x={x}  solvent={solvent}  M06-2X/def2-TZVPPD/SMD optimised geometry"
            clean = f"{natom}\n{comment}\n" + "\n".join(body) + "\n"
            (outdir / f"{fname}.xyz").write_text(clean, encoding="utf-8")
            geom[solvent][canon(n_li, x, q)] = {
                "label": display_label(n_li, x, q),
                "formula": fname,
                "family": family_name(n_li),
                "n_Li": n_li, "x": x, "q": q, "natom": natom,
                "xyz": clean,
                "flag": FLAGS.get((solvent, n_li, x, q), ""),
                "note": NOTES.get((solvent, n_li, x, q), ""),
            }
    return geom


# ----------------------------------------------------------------------------
# 2. Energies / thermodynamics / voltages
# ----------------------------------------------------------------------------
def _num(v):
    return None if pd.isna(v) else float(v)


def load_energetics():
    """The dataset as the paper's code reads it: `read_energetics_csv` drops
    the exploratory x >= 9 rows and duplicates, `mask_suspect_ccsd` blanks
    the flagged CCSD value. Same call chain as make_si_tables.py."""
    fe = lis.read_energetics_csv(str(FE / "data_all.csv"), validate=False, deck_dir=None)
    fe = lis.mask_suspect_ccsd(fe, warn=False)
    return fe


def build_energies():
    df = pd.read_csv(FE / "polysulfide_thermodynamics_summary.csv")
    copy_with_units(FE / "polysulfide_thermodynamics_summary.csv", DATA / "energies")
    copy_with_units(FE / "data_all.csv", DATA / "energies")
    # electrolyte_solvation.csv already ships G_GP_Ha / dG_solv_eV; the
    # suffix convention used here is taken from it.
    copy_with_units(FE / "electrolyte_solvation.csv", DATA / "energies")

    rows = []
    for _, r in df.iterrows():
        if r["set"] == "ref":
            continue
        n_li, x, q = int(r["n_Li"]), int(r["n_S"]), int(r["q"])
        if x < 1 or x > 8:
            continue
        solvent = r["SOLVENT"]
        rows.append({
            "solvent": solvent,
            "family": family_name(n_li),
            "label": display_label(n_li, x, q),
            "n_Li": n_li, "x": x, "q": q,
            "set": r["set"],
            "mult": int(r["MULTI"]) if not pd.isna(r["MULTI"]) else None,
            "dG_dft": _num(r["dG_form"]),
            "dG_dft_pa": _num(r["dG_form_per_atom"]),
            "dG_ccsd": _num(r["dG_form_ccsd"]),
            "dG_ccsd_pa": _num(r["dG_form_ccsd_per_atom"]),
            "dev": _num(r["dG_ccsd_minus_dft"]),
            "homo": _num(r["HOMO"]),
            "flag": FLAGS.get((solvent, n_li, x, q), ""),
            "note": NOTES.get((solvent, n_li, x, q), ""),
        })
    # solvation (electrolyte references)
    solv = pd.read_csv(FE / "electrolyte_solvation.csv")
    solv_rows = [{"species": r["MOL"], "solvent": r["SOLVENT"], "dG_solv_eV": _num(r["dG_solv_eV"])}
                 for _, r in solv.iterrows()]
    return rows, solv_rows


def build_voltages(fe):
    """Average voltage of S8 + 16 Li -> 8 Li2S (paper Table 2), computed with
    the paper's `average_discharge_voltage` in both reference frames and at
    both levels of theory. No CCSD reference rows exist in the gas phase."""
    rows = []
    for solvent, label in (("DMSO", "DMSO"), ("TEGDME", "TEGDME"), ("GP", "Gas phase")):
        row = {"solvent": label}
        for tag, col in (("ccsd", "CCSD_GIBB"), ("dft", "E0+GIBBS")):
            if solvent == "GP" and col == "CCSD_GIBB":
                row[f"bulk_{tag}"] = row[f"atomic_{tag}"] = None
                continue
            refs = lis.compute_references(fe, solvent, energy_col=col)
            glk = lis.build_g_lookup(fe, solvent, energy_col=col)
            for frame in ("bulk", "atomic"):
                v = lis.average_discharge_voltage(refs, glk, reference=frame)
                row[f"{frame}_{tag}"] = None if v is None else round(float(v), 3)
        rows.append(row)
    return {"avg": rows, "experiment": lis.LI_S_AVG_DISCHARGE_V_EXP,
            "frame_offset_V": round(float(lis.compute_references(fe, "DMSO", "CCSD_GIBB").frame_offset_eV), 3)}


# ----------------------------------------------------------------------------
# 3. QTAIM + NBO
# ----------------------------------------------------------------------------
def build_qtaim():
    for name in ["qtaim_bcp_final.csv", "qtaim_charges_final.csv",
                 "qtaim_charge_summary_final.csv", "qtaim_ss_summary_final.csv"]:
        copy_with_units(QT / name, DATA / "qtaim")

    bcp = pd.read_csv(QT / "qtaim_bcp_final.csv")
    bcp_rows = []
    for _, r in bcp.iterrows():
        i, elem_i, j, elem_j = parse_interaction(r["Interaction"])
        bcp_rows.append({
            "solvent": r["Solvent"], "system": r["System"], "scope": r["Scope"],
            "bond": r["BondType"], "covalent": bool(r["Covalent"]),
            # atom pair: 1-based Multiwfn serials that index the geometry XYZ in
            # atom order (verified against geometries.js). "atoms" is the display
            # form (e.g. "S7–S6"); i/j drive the interactive bond highlight.
            "i": i, "j": j, "atoms": f"{elem_i}{i}–{elem_j}{j}" if i else "",
            "d": _num(r["d"]), "rho": _num(r["rho"]), "lap": _num(r["lap"]),
            "H": _num(r["H"]), "EHB": _num(r["EHB"]), "cls": r["Class"],
        })

    # charge summary by element (compact)
    cs = pd.read_csv(QT / "qtaim_charge_summary_final.csv")
    charge_rows = []
    for _, r in cs.iterrows():
        charge_rows.append({
            "solvent": r["Solvent"], "system": r["System"], "scope": r["Scope"],
            "element": r["Element"], "n": int(r["n"]),
            "q_mean": _num(r["q_mean"]), "q_min": _num(r["q_min"]), "q_max": _num(r["q_max"]),
        })
    by_solvent = bcp.groupby("Solvent").size().to_dict()
    return bcp_rows, charge_rows, by_solvent


def build_nbo():
    df = pd.read_excel(NBO / "data_all_full.xlsx")
    write_with_units(df, DATA / "nbo" / "nbo_all_full.csv")
    for split in ["LiLi", "LiS", "SLi", "SS"]:
        for solvent in ["DMSO", "TEGDME"]:
            f = NBO / f"data_{solvent}_{split}.xlsx"
            if f.exists():
                write_with_units(pd.read_excel(f),
                                 DATA / "nbo" / f"nbo_{solvent}_{split}.csv")

    # Channel statistics follow make_si_tables.py exactly (SI Table S34): the
    # TFSI- reference rows are excluded, and an orbital that involves lithium at
    # all (a BD(Li-S) donor, a BD*(S-Li) acceptor) counts as lithium.
    def elem(species):
        return "Li" if "Li" in str(species) else "S"

    poly = df[df["MOL"].astype(str).str.strip() != "TFSI-"].copy()
    poly["donor_e"] = poly["Donor Species"].map(elem)
    poly["acc_e"] = poly["Acceptor Species"].map(elem)
    poly["channel"] = poly["donor_e"] + "→" + poly["acc_e"]
    chan_rows = []
    for (solvent, ch), g in poly.groupby(["SOLVENT", "channel"]):
        chan_rows.append({
            "solvent": solvent, "channel": ch, "n": int(len(g)),
            "median": round(float(g["E2"].median()), 2),
            "p5": round(float(g["E2"].quantile(0.05)), 2),
            "p95": round(float(g["E2"].quantile(0.95)), 2),
            "max": round(float(g["E2"].max()), 2),
        })
    chan_rows.sort(key=lambda r: (r["solvent"], r["channel"]))
    counts = {"rows": int(len(df)), "poly_rows": int(len(poly)),
              "poly_species": int(poly["MOL"].nunique())}
    return chan_rows, counts


# ----------------------------------------------------------------------------
# 4. Vibrational: dominant-band table, reference bands, complete mode table
# ----------------------------------------------------------------------------
def build_vibrational():
    for f in VIB.glob("*.csv"):
        copy_with_units(f, DATA / "vibrational")

    # dominant_summary.csv stores frequencies already multiplied by 0.96. The
    # manuscript reports polysulfide bands UNSCALED and the solvents at 0.96
    # (see lis_vibmodes.SOLVENT_SCALE / POLYSULFIDE_SCALE), so both conventions
    # are exported and each column says which one it is. Do not collapse them
    # back to a single unlabelled number: a 4 % ambiguity in a fingerprint band
    # is larger than the composition-driven shift the measurements resolve.
    dom = pd.read_csv(VIB / "dominant_summary.csv")
    dom_rows = []
    for _, r in dom.iterrows():
        n_li, x, q = int(r["n_Li"]), int(r["n_S"]), int(r["q"])
        row = {
            "label": display_label(n_li, x, q), "family": family_name(n_li),
            "n_Li": n_li, "x": x, "q": q,
        }
        for key, col in (("raman_dmso", "raman_DMSO_cm1"),
                         ("raman_tegdme", "raman_TEGDME_cm1"),
                         ("ir_dmso", "ir_DMSO_cm1"),
                         ("ir_tegdme", "ir_TEGDME_cm1")):
            scaled = _num(r[col])
            row[f"{key}_scaled"] = scaled
            row[f"{key}_harm"] = (None if scaled is None
                                  else round(scaled / VIB_SOLVENT_SCALE, 3))
        dom_rows.append(row)
    dom_rows.sort(key=lambda r: (r["n_Li"], r["x"], r["q"]))

    ref = pd.read_csv(VIB / "reference_band_peaks.csv")
    ref_rows = ref.fillna("").to_dict(orient="records")
    return dom_rows, ref_rows


def build_vibrational_modes():
    """Every harmonic normal mode of every species (the 37 solution species,
    the two solvent molecules and TFSI-) in both solvents, straight from the
    Gaussian frequency output as cleaned by the vibrational pipeline. The
    viewer applies the frequency convention at display time; the values here
    are the unscaled harmonics, plus a `freq_paper_cm1` column with the
    paper's convention already applied (x0.96 for the solvents and TFSI-,
    unscaled for the polysulfides)."""
    df = vib.load_all_spectra(scale=None)
    is_ref = df["family"].isin(vib.NONPOLY_FAMILIES)
    df["freq_paper_cm1"] = df["freq_cm1"] * np.where(is_ref, VIB_SOLVENT_SCALE, 1.0)
    cols = ["solvent", "species", "family", "n_Li", "n_S", "q", "mode_index",
            "mode_label", "freq_cm1", "freq_paper_cm1", "ir_act_km_mol", "raman_act_A4_amu"]
    out = df[cols].copy()
    out["freq_paper_cm1"] = out["freq_paper_cm1"].round(4)
    out.to_csv(DATA / "vibrational" / "modes_all.csv", index=False)

    order = vib.species_in_order(df)
    modes = {s: {} for s in SOLVENTS}
    for (sol, sp), g in df.groupby(["solvent", "species"], sort=False):
        fam = g["family"].iloc[0]
        n_li, n_s, q = int(g["n_Li"].iloc[0]), int(g["n_S"].iloc[0]), int(g["q"].iloc[0])
        electrolyte = fam in vib.NONPOLY_FAMILIES
        label = REF_LABELS[sp] if electrolyte else display_label(n_li, n_s, q)
        g = g.sort_values("mode_index")
        modes[sol][sp] = {
            "label": label, "family": fam, "n_Li": n_li, "x": n_s, "q": q,
            "electrolyte": electrolyte,
            "modes": [[round(float(f), 3), round(float(ir), 4), round(float(ra), 4), str(sym)]
                      for f, ir, ra, sym in zip(g["freq_cm1"], g["ir_act_km_mol"],
                                                g["raman_act_A4_amu"], g["mode_label"])],
        }
    families = [{"key": f, "label": VIB_FAMILY_LABELS[f], "color": vib.FAMILY_COLORS[f]}
                for f in list(vib.FAMILY_ORDER) + list(vib.NONPOLY_FAMILIES)
                if f in set(df["family"])]
    meta = {"order": order, "families": families, "solvent_scale": VIB_SOLVENT_SCALE,
            "n_modes": int(len(df)),
            "species_per_solvent": {s: int(df[df.solvent == s]["species"].nunique()) for s in SOLVENTS}}
    return modes, meta


# ----------------------------------------------------------------------------
# 5. Extra SI figures deposited with the data
# ----------------------------------------------------------------------------
# The SI wires one chain length of each series into its text (Li2S8 in both
# cases) and says the other chain lengths are deposited with the data. They
# are PDF-only collaborator figures with no source in ../data_analysis/.
def copy_extra_figures():
    dest = DATA / "si_extra_figures"
    dest.mkdir(parents=True, exist_ok=True)
    for old in dest.glob("*.pdf"):
        old.unlink()
    items = []
    series = (
        ("si_freqbench_", "freqbench",
         "Gas-phase harmonic frequencies of {lab} across six functional/basis-set combinations (the SI shows Li₂S₈)."),
        ("si_freqheat_", "freqheat",
         "Atomic participation ratio heatmap of the normal modes of {lab} in TEGDME (the SI shows Li₂S₈)."),
    )
    for prefix, key, caption in series:
        found = []
        for pdf in PAPER_FIGS.glob(prefix + "*.pdf"):
            sp = pdf.stem[len(prefix):]
            pid = parse_label(sp)
            if pid is None:
                continue
            found.append((pid, pdf, sp))
        for pid, pdf, sp in sorted(found):
            shutil.copy(pdf, dest / pdf.name)
            lab = display_label(*pid)
            items.append({"file": pdf.name, "series": key, "label": lab,
                          "caption": caption.format(lab=lab)})
    return items


# ----------------------------------------------------------------------------
# 6. Zip bundle (data/ only; the site's figures are drawn from the data)
# ----------------------------------------------------------------------------
def make_zip():
    zpath = DATA / "all_data.zip"
    if zpath.exists():
        zpath.unlink()
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(DATA.rglob("*")):
            if p.is_file() and p.name != "all_data.zip":
                z.write(p, p.relative_to(REPO))
    return zpath.stat().st_size


# ----------------------------------------------------------------------------
def _check(name, got, want):
    if got != want:
        raise AssertionError(f"{name}: got {got}, the paper prints {want}. "
                             "The canonical exports and the manuscript disagree; fix the source.")


def main():
    print("Building data layer from", DA)
    for sub in ("energies", "qtaim", "nbo", "vibrational"):
        (DATA / sub).mkdir(parents=True, exist_ok=True)
    JSDATA.mkdir(parents=True, exist_ok=True)

    geom = build_geometries()
    n_geo = {s: len(geom[s]) for s in SOLVENTS}
    js_dump("GEOMETRIES", geom, JSDATA / "geometries.js")
    print(f"  geometries: {sum(n_geo.values())} species ({', '.join(f'{s}={n}' for s, n in n_geo.items())})")

    raw_rows = len(pd.read_csv(FE / "data_all.csv"))
    _check("data_all.csv rows", raw_rows, EXPECTED["data_all_rows"])
    fe = load_energetics()
    _check("rows entering the analysis", len(fe), EXPECTED["analysed_rows"])
    n_ccsd = int(fe["CCSD_GIBB"].notna().sum())
    _check("composite-CCSD rows", n_ccsd, EXPECTED["ccsd_rows"])

    energies, solvation = build_energies()
    voltages = build_voltages(fe)
    js_dump("ENERGIES", energies, JSDATA / "energies.js")
    print(f"  energies: {len(energies)} species rows; {raw_rows} raw / {len(fe)} analysed / {n_ccsd} CCSD")
    for r in voltages["avg"]:
        print(f"    voltage {r['solvent']:<9s} bulk CCSD {r['bulk_ccsd']}  M06-2X {r['bulk_dft']}  "
              f"| atomic CCSD {r['atomic_ccsd']}  M06-2X {r['atomic_dft']}")

    bcp_rows, charge_rows, bcp_by_solvent = build_qtaim()
    _check("bond critical points", len(bcp_rows), EXPECTED["bcps"])
    for s, n in EXPECTED["bcps_by_solvent"].items():
        _check(f"BCPs in {s}", int(bcp_by_solvent[s]), n)
    n_charge_systems = len({(r["solvent"], r["system"]) for r in charge_rows})
    _check("QTAIM charge systems", n_charge_systems, EXPECTED["charge_systems"])
    nbo_channels, nbo_counts = build_nbo()
    _check("NBO rows", nbo_counts["rows"], EXPECTED["nbo_rows"])
    (JSDATA / "qtaim.js").write_text(
        "// Auto-generated by build_data.py\n"
        f"window.QTAIM_BCP = {json.dumps(bcp_rows, ensure_ascii=False)};\n"
        f"window.QTAIM_CHARGES = {json.dumps(charge_rows, ensure_ascii=False)};\n"
        f"window.NBO_CHANNELS = {json.dumps(nbo_channels, ensure_ascii=False)};\n",
        encoding="utf-8",
    )
    print(f"  qtaim: {len(bcp_rows)} BCPs ({bcp_by_solvent}), {len(charge_rows)} charge rows; "
          f"NBO {nbo_counts['rows']} rows ({nbo_counts['poly_rows']} polysulfide over "
          f"{nbo_counts['poly_species']} species), {len(nbo_channels)} channels")

    dom_rows, ref_rows = build_vibrational()
    modes, vib_meta = build_vibrational_modes()
    _check("harmonic normal modes", vib_meta["n_modes"], EXPECTED["modes"])
    for s in SOLVENTS:
        _check(f"vibrational species in {s}", vib_meta["species_per_solvent"][s],
               EXPECTED["vib_species_per_solvent"])
    (JSDATA / "vibrational.js").write_text(
        "// Auto-generated by build_data.py\n"
        f"window.VIB_DOMINANT = {json.dumps(dom_rows, ensure_ascii=False)};\n"
        f"window.VIB_REFERENCE = {json.dumps(ref_rows, ensure_ascii=False)};\n",
        encoding="utf-8",
    )
    (JSDATA / "vib_modes.js").write_text(
        "// Auto-generated by build_data.py - unscaled harmonic normal modes,\n"
        "// [freq_cm1, ir_km_mol, raman_A4_amu, symmetry]; the viewer applies the convention.\n"
        f"window.VIB_MODES = {json.dumps(modes, ensure_ascii=False)};\n"
        f"window.VIB_META = {json.dumps(vib_meta, ensure_ascii=False)};\n",
        encoding="utf-8",
    )
    print(f"  vibrational: {len(dom_rows)} species in the dominant-band table, {len(ref_rows)} reference bands, "
          f"{vib_meta['n_modes']} modes over {vib_meta['species_per_solvent']} species")

    extra = copy_extra_figures()
    print(f"  extra SI figures: {len(extra)} PDFs")

    meta = {
        "data_all_rows": raw_rows, "analysed_rows": int(len(fe)), "ccsd_rows": n_ccsd,
        "bcps": len(bcp_rows), "bcps_by_solvent": {k: int(v) for k, v in bcp_by_solvent.items()},
        "bcp_systems": len({(r["solvent"], r["system"]) for r in bcp_rows}),
        "charge_systems": n_charge_systems,
        "nbo_rows": nbo_counts["rows"], "nbo_poly_rows": nbo_counts["poly_rows"],
        "nbo_poly_species": nbo_counts["poly_species"],
        "modes": vib_meta["n_modes"], "vib_species": EXPECTED["vib_species_per_solvent"],
        "geometries": n_geo, "extra_figures": len(extra),
        "flagged": sorted(f"{display_label(k[1], k[2], k[3])} ({k[0]})" for k in FLAGS),
    }
    (JSDATA / "aux.js").write_text(
        "// Auto-generated by build_data.py\n"
        f"window.SOLVATION = {json.dumps(solvation, ensure_ascii=False)};\n"
        f"window.VOLTAGES = {json.dumps(voltages, ensure_ascii=False)};\n"
        f"window.NOTES = {json.dumps({'lis3_dmso': LIS3_DMSO_NOTE}, ensure_ascii=False)};\n"
        f"window.EXTRA_FIGURES = {json.dumps(extra, ensure_ascii=False)};\n"
        f"window.META = {json.dumps(meta, ensure_ascii=False)};\n",
        encoding="utf-8",
    )

    size = make_zip()
    print(f"  all_data.zip: {size/1e6:.1f} MB (data/ only)")
    print("Done.")


if __name__ == "__main__":
    main()
