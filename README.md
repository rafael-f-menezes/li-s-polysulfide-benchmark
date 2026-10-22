# Li–S Polysulfide Benchmark: interactive companion dataset

Interactive, self-contained dataset accompanying the paper

> **Lithium Polysulfide Speciation in Lithium–Sulfur Batteries: A First-Principles Benchmark of
> Thermodynamics, Bonding, and Solvent Control**
> R. Ferreira de Menezes, T. Cassiano, L. Meyer, J. Porter, F. O. Sanches-Neto, B. Diehl,
> J. Maratos, T. Schiess, J. Landetta Espinoza, A. Costa, A. Colclasure, R. Gargano\*, K. G. Sprenger\*

A first-principles coupled-cluster benchmark of the full Li<sub>y</sub>S<sub>x</sub><sup>q</sup>
matrix (*n*<sub>Li</sub> = 0, 1, 2; *q* = 0, −1, −2; *x* = 1–8) in gas phase, TEGDME, and DMSO:
248 M06-2X/def2-TZVPPD/SMD thermochemistries, 132 of them refined by single-point CCSD in a composite
Gibbs scheme, QTAIM on the CCSD densities (777 bond critical points), NBO, and the harmonic IR and Raman
spectra of every species. Every numeric column in `data/` carries its unit in the column name (`_Ha`,
`_eV`, `_kcal_mol`, `_Ang`, `_au`, `_e`, `_cm1`, `_km_mol`, `_A4_amu`); see
[`data/DATA_DICTIONARY.md`](data/DATA_DICTIONARY.md) for the full column-by-column reference. Watch for
`data_all.csv`, which mixes unit systems by column: every energy there is in Hartree except `HOMO_eV`.

This repository lets a reader browse and download every computed dataset underlying the paper:
optimized geometries, M06-2X and composite-CCSD energies, QTAIM and NBO bonding descriptors, and the
complete harmonic normal-mode table behind an interactive spectrum viewer. The measured infrared and
Raman spectra are available from the corresponding authors on request.

## Viewing the site

The site is a single static page with **no server and no network dependencies**: all data is
embedded and the 3D molecular viewer ([3Dmol.js](https://3dmol.org)) is vendored locally. Every plot
on the page is drawn in the browser from the embedded data; no plot images are shipped (the only
binary files are the 15 SI figure PDFs under `data/si_extra_figures/`).

- **Locally (works today, offline):** clone or download this repository and open `index.html` in
  any modern browser. Everything works from `file://`, downloads included.
- **Live on the web:** <https://rafael-f-menezes.github.io/li-s-polysulfide-benchmark/>, served by
  GitHub Pages from the `main` branch (root) once the repository is public.

## What's here

| Tab | Contents |
|-----|----------|
| **Introduction** | Paper abstract, the Li<sub>y</sub>S<sub>x</sub><sup>q</sup> matrix, level of theory, flagged entries |
| **Optimized Geometries** | 3D viewer + downloadable XYZ for every species, in both solvents |
| **Energies & Thermodynamics** | Sortable/filterable formation-energy table (M06-2X vs CCSD), discharge voltages in both reference frames |
| **Bonding & Topology** | QTAIM bond-critical-point table with a click-to-highlight 3D view, NBO channel summary |
| **Vibrational Spectra** | Interactive per-species IR/Raman viewer (every normal mode, both solvents, either frequency convention, adjustable broadening, CSV and SVG export), dominant-band and reference-band tables |
| **Data & Citation** | Downloads for every data file, the extra SI figures, citation, license |

The interactive viewer: pick a species
(←/→ steps through them), overlay DMSO and TEGDME, switch between the paper's two-domain frequency
convention (polysulfides unscaled, solvents and TFSI⁻ ×0.96) and either single factor, set the
Lorentzian half-width and the range, hover any stick for its frequency in both conventions, activity
and symmetry label, and download the modes as CSV or the figure as SVG.

## Repository layout

```
index.html                 # the interactive site (open this)
assets/                     # css, vendored 3Dmol.js, app logic, generated JS data modules
data/                       # raw, downloadable canonical data files
  geometries/{DMSO,TEGDME}/ # optimized XYZ, one file per species (61 + 61)
  energies/                 # data_all.csv (248 rows), formation-energy summary, solvation
  qtaim/                    # bond critical points (777), atomic charges, summaries
  nbo/                      # NBO second-order perturbation energies (601 rows)
  vibrational/              # modes_all.csv (977 normal modes) + dominant / fingerprint / reference / Raman-solution tables
  si_extra_figures/         # the 15 SI figure PDFs the SI text deposits with the data (Li2Sx frequency benchmarks and APR heatmaps)
  DATA_DICTIONARY.md       # every column, its unit, and its provenance
  all_data.zip             # one-click bundle of data/
build_data.py               # regenerates data/ and assets/js/data/ from ../data_analysis
```

## The build script

`build_data.py` is the maintainers' build script. It regenerates every data file and embedded JS
module from the canonical exports of the paper's analysis tree (`../data_analysis`, which is not part
of this repository), imports the paper's own `lis_energetics` (reference frame, voltages) and
`lis_vibmodes` (normal modes, scale factor) so that nothing is retyped, and asserts the counts the
paper prints (248 / 202 / 132 thermochemistry rows, 777 BCPs, 131 charge systems, 601 NBO rows,
977 modes). It is included for transparency and does not run from a clone of this repository alone;
the analysis code is available from the corresponding authors on request.

## Provenance

- Geometries & harmonic frequencies: **M06-2X/def2-TZVPPD/SMD** (Gaussian 16); the neutral S₈
  reference is the D<sub>4d</sub> crown
- Refined electronic energies: **composite CCSD** (single-point CCSD/def2-TZVPPD on the DFT geometries in the same SMD continuum)
- Topology: **QTAIM** on the CCSD densities (Multiwfn 3.8) and **NBO 3.1** second-order analysis of the
  M06-2X wavefunctions
- Three entries carry a flag (the caveats section of the paper's Methods and Supplementary Note 12);
  they are marked wherever they appear on the site and listed in `data/DATA_DICTIONARY.md`: neutral LiS₃• in DMSO (a first-order
  saddle point, 60i cm⁻¹), Li₂S₃²⁻ in DMSO (suspect energy, excluded from the redox-ladder figure and
  statistics) and LiS₅⁻ in TEGDME (monodentate coordination).

## Citation

The paper is posted as a preprint on ChemRxiv (https://doi.org/10.26434/chemrxiv.15010681/v1); a BibTeX
entry is on the site's *Data & Citation* tab. Please cite the paper when using these data. The data files of
release v1.0.0 are archived at Zenodo: https://doi.org/10.5281/zenodo.23421308.

## License

- **Data** (everything in `data/`): [CC-BY-4.0](LICENSE).
- **Site code** (`index.html`, `assets/css/`, `assets/js/app.js`, `build_data.py`): MIT. The vendored
  [3Dmol.js](https://3dmol.org) library (`assets/js/3Dmol-min.js`) keeps its own BSD-3-Clause license
  (`assets/js/3Dmol-min.js.LICENSE.txt`).

## Contact

Corresponding authors: **Ricardo Gargano** and **Kayla G. Sprenger**.
