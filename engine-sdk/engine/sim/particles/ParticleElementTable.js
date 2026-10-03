// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleElementTable.js - Element Property System / Periodic Table (GAP 33)
 * 
 * Data foundation for universal matter simulation. Every other physics system
 * (Lennard-Jones, Coulomb, SPH, Chemistry) reads element properties from here.
 * 
 * Provides:
 *   - Full periodic table data for 118 elements
 *   - Per-particle element buffer (GPU storage, u32 per particle)
 *   - Element lookup by atomic number or symbol
 *   - Common molecule/compound presets
 *   - LJ parameters (epsilon, sigma) per element
 *   - Integration with existing thermal material system
 * 
 * Usage:
 *   const table = createElementTable(device, maxParticles);
 *   setParticleElement(table, device, particleIndex, ELEMENTS.Fe);
 *   const iron = getElement(26); // by atomic number
 *   const gold = getElementBySymbol('Au');
 */

import { createStorageBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";

// ============================================================================
// PERIODIC TABLE DATA
// ============================================================================

/**
 * Element data: [symbol, name, atomicMass, electronegativity, atomicRadius(pm),
 *   vanDerWaalsRadius(pm), meltPoint(K), boilPoint(K), valenceElectrons,
 *   ljEpsilon(eV), ljSigma(Å), cpkColorHex, defaultCharge]
 * 
 * LJ parameters from UFF (Universal Force Field) and OPLS where available.
 * CPK colors follow the standard Corey-Pauling-Koltun convention.
 */
const ELEMENT_DATA = [
  // Z  sym   name            mass    eneg  rAtom rVdW  Tmelt  Tboil  val  ljEps   ljSig  cpkColor  charge
  [  1, 'H',  'Hydrogen',     1.008,  2.20,  25,  120,   14,    20,   1,  0.0157, 2.571, 0xFFFFFF,  0],
  [  2, 'He', 'Helium',       4.003,  0.00,  31,  140,    1,     4,   0,  0.0203, 2.104, 0xD9FFFF,  0],
  [  3, 'Li', 'Lithium',      6.941,  0.98,  145, 182,  454,  1615,   1,  0.0250, 2.184, 0xCC80FF,  1],
  [  4, 'Be', 'Beryllium',    9.012,  1.57,  105, 153,  1560, 2744,   2,  0.0420, 2.445, 0xC2FF00,  2],
  [  5, 'B',  'Boron',       10.81,   2.04,  85,  192,  2349, 4200,   3,  0.0400, 3.638, 0xFFB5B5,  3],
  [  6, 'C',  'Carbon',      12.011,  2.55,  70,  170,  3823, 4098,   4,  0.0559, 3.431, 0x909090, -4],
  [  7, 'N',  'Nitrogen',    14.007,  3.04,  65,  155,   63,    77,   5,  0.0699, 3.261, 0x3050F8, -3],
  [  8, 'O',  'Oxygen',      15.999,  3.44,  60,  152,   54,    90,   6,  0.0600, 3.118, 0xFF0D0D, -2],
  [  9, 'F',  'Fluorine',    18.998,  3.98,  50,  147,   53,    85,   7,  0.0250, 2.997, 0x90E050, -1],
  [ 10, 'Ne', 'Neon',        20.180,  0.00,  38,  154,   25,    27,   0,  0.0313, 2.789, 0xB3E3F5,  0],
  [ 11, 'Na', 'Sodium',      22.990,  0.93,  180, 227,  371,  1156,   1,  0.0300, 2.658, 0xAB5CF2,  1],
  [ 12, 'Mg', 'Magnesium',   24.305,  1.31,  150, 173,  923,  1363,   2,  0.0450, 2.691, 0x8AFF00,  2],
  [ 13, 'Al', 'Aluminium',   26.982,  1.61,  125, 184,  934,  2792,   3,  0.0510, 4.008, 0xBFA6A6,  3],
  [ 14, 'Si', 'Silicon',     28.086,  1.90,  110, 210,  1687, 3538,   4,  0.0402, 3.826, 0xF0C8A0, -4],
  [ 15, 'P',  'Phosphorus',  30.974,  2.19,  100, 180,  317,   554,   5,  0.0305, 3.695, 0xFF8000, -3],
  [ 16, 'S',  'Sulfur',      32.065,  2.58,  100, 180,  388,   718,   6,  0.0274, 3.595, 0xFFFF30, -2],
  [ 17, 'Cl', 'Chlorine',    35.453,  3.16,  100, 175,  172,   239,   7,  0.0227, 3.516, 0x1FF01F, -1],
  [ 18, 'Ar', 'Argon',       39.948,  0.00,  71,  188,   84,    87,   0,  0.0104, 3.446, 0x80D1E3,  0],
  [ 19, 'K',  'Potassium',   39.098,  0.82,  220, 275,  337,  1032,   1,  0.0350, 3.396, 0x8F40D4,  1],
  [ 20, 'Ca', 'Calcium',     40.078,  1.00,  180, 231,  1115, 1757,   2,  0.0480, 3.028, 0x3DFF00,  2],
  [ 21, 'Sc', 'Scandium',    44.956,  1.36,  160, 211,  1814, 3109,   3,  0.0190, 2.936, 0xE6E6E6,  3],
  [ 22, 'Ti', 'Titanium',    47.867,  1.54,  140, 187,  1941, 3560,   4,  0.0170, 2.829, 0xBFC2C7,  4],
  [ 23, 'V',  'Vanadium',    50.942,  1.63,  135, 179,  2183, 3680,   5,  0.0160, 2.801, 0xA6A6AB,  5],
  [ 24, 'Cr', 'Chromium',    51.996,  1.66,  140, 189,  2180, 2944,   6,  0.0150, 2.693, 0x8A99C7,  3],
  [ 25, 'Mn', 'Manganese',   54.938,  1.55,  140, 197,  1519, 2334,   7,  0.0130, 2.638, 0x9C7AC7,  2],
  [ 26, 'Fe', 'Iron',        55.845,  1.83,  140, 196,  1811, 3134,   8,  0.0130, 2.594, 0xE06633,  2],
  [ 27, 'Co', 'Cobalt',      58.933,  1.88,  135, 192,  1768, 3200,   9,  0.0140, 2.559, 0xF090A0,  2],
  [ 28, 'Ni', 'Nickel',      58.693,  1.91,  135, 163,  1728, 3186,  10,  0.0150, 2.525, 0x50D050,  2],
  [ 29, 'Cu', 'Copper',      63.546,  1.90,  135, 140,  1358, 2835,  11,  0.0050, 3.114, 0xC88033,  2],
  [ 30, 'Zn', 'Zinc',        65.380,  1.65,  135, 139,  693,  1180,  12,  0.0124, 2.462, 0x7D80B0,  2],
  [ 31, 'Ga', 'Gallium',     69.723,  1.81,  130, 187,  303,  2477,   3,  0.0415, 3.905, 0xC28F8F,  3],
  [ 32, 'Ge', 'Germanium',   72.640,  2.01,  125, 211,  1211, 3106,   4,  0.0379, 3.813, 0x668F8F,  4],
  [ 33, 'As', 'Arsenic',     74.922,  2.18,  115, 185,  1090, 887,    5,  0.0309, 3.769, 0xBD80E3, -3],
  [ 34, 'Se', 'Selenium',    78.960,  2.55,  115, 190,  494,  958,    6,  0.0291, 3.746, 0xFFA100, -2],
  [ 35, 'Br', 'Bromine',     79.904,  2.96,  115, 185,  266,  332,    7,  0.0251, 3.732, 0xA62929, -1],
  [ 36, 'Kr', 'Krypton',     83.798,  3.00,  88,  202,  116,  120,    0,  0.0171, 3.689, 0x5CB8D1,  0],
  [ 37, 'Rb', 'Rubidium',    85.468,  0.82,  235, 303,  312,  961,    1,  0.0400, 3.665, 0x702EB0,  1],
  [ 38, 'Sr', 'Strontium',   87.620,  0.95,  200, 249,  1050, 1655,   2,  0.0550, 3.244, 0x00FF00,  2],
  [ 39, 'Y',  'Yttrium',     88.906,  1.22,  180, 219,  1799, 3609,   3,  0.0360, 2.980, 0x94FFFF,  3],
  [ 40, 'Zr', 'Zirconium',   91.224,  1.33,  155, 186,  2128, 4682,   4,  0.0280, 2.783, 0x94E0E0,  4],
  [ 41, 'Nb', 'Niobium',     92.906,  1.60,  145, 207,  2750, 5017,   5,  0.0240, 2.820, 0x73C2C9,  5],
  [ 42, 'Mo', 'Molybdenum',  95.960,  2.16,  145, 209,  2896, 4912,   6,  0.0280, 2.719, 0x54B5B5,  6],
  [ 43, 'Tc', 'Technetium',  98.000,  1.90,  135, 209,  2430, 4538,   7,  0.0240, 2.671, 0x3B9E9E,  7],
  [ 44, 'Ru', 'Ruthenium',  101.070,  2.20,  130, 207,  2607, 4423,   8,  0.0240, 2.640, 0x248F8F,  3],
  [ 45, 'Rh', 'Rhodium',    102.906,  2.28,  135, 195,  2237, 3968,   9,  0.0240, 2.609, 0x0A7D8C,  3],
  [ 46, 'Pd', 'Palladium',  106.420,  2.20,  140, 202,  1828, 3236,  10,  0.0240, 2.583, 0x006985,  2],
  [ 47, 'Ag', 'Silver',     107.868,  1.93,  160, 172,  1235, 2435,  11,  0.0360, 2.805, 0xC0C0C0,  1],
  [ 48, 'Cd', 'Cadmium',    112.411,  1.69,  155, 158,  594,  1040,  12,  0.0228, 2.537, 0xFFD98F,  2],
  [ 49, 'In', 'Indium',     114.818,  1.78,  155, 193,  430,  2345,   3,  0.0510, 3.976, 0xA67573,  3],
  [ 50, 'Sn', 'Tin',        118.710,  1.96,  145, 217,  505,  2875,   4,  0.0448, 3.913, 0x668080,  4],
  [ 51, 'Sb', 'Antimony',   121.760,  2.05,  145, 206,  904,  1860,   5,  0.0399, 3.838, 0x9E63B5, -3],
  [ 52, 'Te', 'Tellurium',  127.600,  2.10,  140, 206,  723,  1261,   6,  0.0398, 3.982, 0xD47A00, -2],
  [ 53, 'I',  'Iodine',     126.904,  2.66,  140, 198,  387,   457,   7,  0.0339, 4.009, 0x940094, -1],
  [ 54, 'Xe', 'Xenon',      131.293,  2.60,  108, 216,  161,   165,   0,  0.0200, 3.924, 0x429EB0,  0],
  [ 55, 'Cs', 'Caesium',    132.905,  0.79,  260, 343,  302,   944,   1,  0.0450, 4.024, 0x57178F,  1],
  [ 56, 'Ba', 'Barium',     137.327,  0.89,  215, 268,  1000, 2170,   2,  0.0640, 3.299, 0x00C900,  2],
  // Lanthanides (57-71) — simplified with common parameters
  [ 57, 'La', 'Lanthanum',  138.905,  1.10,  195, 240,  1193, 3737,   3,  0.0170, 3.138, 0x70D4FF,  3],
  [ 58, 'Ce', 'Cerium',     140.116,  1.12,  185, 235,  1068, 3716,   4,  0.0130, 3.114, 0xFFFFC7,  3],
  [ 59, 'Pr', 'Praseodymium',140.908, 1.13,  185, 239,  1208, 3793,   4,  0.0100, 3.093, 0xD9FFC7,  3],
  [ 60, 'Nd', 'Neodymium',  144.242,  1.14,  185, 229,  1297, 3347,   4,  0.0100, 3.079, 0xC7FFC7,  3],
  [ 61, 'Pm', 'Promethium', 145.000,  1.13,  185, 236,  1315, 3273,   4,  0.0100, 3.050, 0xA3FFC7,  3],
  [ 62, 'Sm', 'Samarium',   150.360,  1.17,  185, 229,  1345, 2067,   4,  0.0100, 3.040, 0x8FFFC7,  3],
  [ 63, 'Eu', 'Europium',   151.964,  1.20,  185, 233,  1099, 1802,   4,  0.0100, 3.037, 0x61FFC7,  3],
  [ 64, 'Gd', 'Gadolinium', 157.250,  1.20,  180, 237,  1585, 3546,   4,  0.0100, 3.000, 0x45FFC7,  3],
  [ 65, 'Tb', 'Terbium',    158.925,  1.10,  175, 221,  1629, 3503,   4,  0.0100, 2.982, 0x30FFC7,  3],
  [ 66, 'Dy', 'Dysprosium', 162.500,  1.22,  175, 229,  1680, 2840,   4,  0.0100, 2.965, 0x1FFFC7,  3],
  [ 67, 'Ho', 'Holmium',    164.930,  1.23,  175, 216,  1734, 2993,   4,  0.0100, 2.945, 0x00FF9C,  3],
  [ 68, 'Er', 'Erbium',     167.259,  1.24,  175, 235,  1802, 3141,   4,  0.0100, 2.930, 0x00E675,  3],
  [ 69, 'Tm', 'Thulium',    168.934,  1.25,  175, 227,  1818, 2223,   4,  0.0100, 2.915, 0x00D452,  3],
  [ 70, 'Yb', 'Ytterbium',  173.054,  1.10,  175, 242,  1097, 1469,   4,  0.0100, 2.902, 0x00BF38,  2],
  [ 71, 'Lu', 'Lutetium',   174.967,  1.27,  175, 221,  1925, 3675,   3,  0.0100, 2.890, 0x00AB24,  3],
  // Period 6 transition metals (72-86)
  [ 72, 'Hf', 'Hafnium',    178.490,  1.30,  155, 212,  2506, 4876,   4,  0.0300, 2.798, 0x4DC2FF,  4],
  [ 73, 'Ta', 'Tantalum',   180.948,  1.50,  145, 217,  3290, 5731,   5,  0.0330, 2.824, 0x4DA6FF,  5],
  [ 74, 'W',  'Tungsten',   183.840,  2.36,  135, 210,  3695, 5828,   6,  0.0370, 2.734, 0x2194D6,  6],
  [ 75, 'Re', 'Rhenium',    186.207,  1.90,  135, 217,  3459, 5869,   7,  0.0330, 2.632, 0x267DAB,  7],
  [ 76, 'Os', 'Osmium',     190.230,  2.20,  130, 216,  3306, 5285,   8,  0.0370, 2.780, 0x266696,  4],
  [ 77, 'Ir', 'Iridium',    192.217,  2.20,  135, 202,  2719, 4701,   9,  0.0370, 2.530, 0x175487,  4],
  [ 78, 'Pt', 'Platinum',   195.084,  2.28,  135, 175,  2041, 4098,  10,  0.0800, 2.454, 0xD0D0E0,  2],
  [ 79, 'Au', 'Gold',       196.967,  2.54,  135, 166,  1337, 3129,  11,  0.0390, 2.934, 0xFFD123,  1],
  [ 80, 'Hg', 'Mercury',    200.590,  2.00,  150, 155,  234,   630,  12,  0.0385, 2.409, 0xB8B8D0,  2],
  [ 81, 'Tl', 'Thallium',   204.383,  1.62,  190, 196,  577,  1746,   3,  0.0680, 3.873, 0xA6544D,  1],
  [ 82, 'Pb', 'Lead',       207.200,  2.33,  180, 202,  601,  2022,   4,  0.0633, 3.828, 0x575961,  2],
  [ 83, 'Bi', 'Bismuth',    208.980,  2.02,  160, 207,  545,  1837,   5,  0.0518, 3.893, 0x9E4FB5,  3],
  [ 84, 'Po', 'Polonium',   209.000,  2.00,  190, 197,  527,  1235,   6,  0.0360, 4.195, 0xAB5C00,  4],
  [ 85, 'At', 'Astatine',   210.000,  2.20,  127, 202,  575,   610,   7,  0.0300, 4.232, 0x754F45, -1],
  [ 86, 'Rn', 'Radon',      222.000,  2.20,  120, 220,  202,   211,   0,  0.0240, 4.245, 0x428296,  0],
  // Period 7 (87-118) — simplified with estimated parameters
  [ 87, 'Fr', 'Francium',   223.000,  0.70,  260, 348,  300,   950,   1,  0.0500, 4.365, 0x420066,  1],
  [ 88, 'Ra', 'Radium',     226.000,  0.90,  215, 283,  973,  2010,   2,  0.0700, 3.276, 0x007D00,  2],
  [ 89, 'Ac', 'Actinium',   227.000,  1.10,  195, 260,  1323, 3471,   3,  0.0170, 3.099, 0x70ABFA,  3],
  [ 90, 'Th', 'Thorium',    232.038,  1.30,  180, 237,  2023, 5061,   4,  0.0260, 3.025, 0x00BAFF,  4],
  [ 91, 'Pa', 'Protactinium',231.036, 1.50,  180, 243,  1841, 4300,   5,  0.0220, 3.050, 0x00A1FF,  5],
  [ 92, 'U',  'Uranium',    238.029,  1.38,  175, 241,  1405, 4404,   6,  0.0220, 3.025, 0x008FFF,  6],
  [ 93, 'Np', 'Neptunium',  237.000,  1.36,  175, 239,  917,  4175,   7,  0.0190, 3.050, 0x0080FF,  5],
  [ 94, 'Pu', 'Plutonium',  244.000,  1.28,  175, 243,  913,  3501,   6,  0.0190, 3.050, 0x006BFF,  4],
  [ 95, 'Am', 'Americium',  243.000,  1.30,  175, 244,  1449, 2880,   4,  0.0140, 3.012, 0x545CF2,  3],
  [ 96, 'Cm', 'Curium',     247.000,  1.30,  176, 245,  1613, 3383,   4,  0.0140, 2.963, 0x785CE3,  3],
  [ 97, 'Bk', 'Berkelium',  247.000,  1.30,  176, 244,  1259, 2900,   4,  0.0140, 2.975, 0x8A4FE3,  3],
  [ 98, 'Cf', 'Californium',251.000,  1.30,  176, 245,  1173, 1743,   4,  0.0140, 2.952, 0xA136D4,  3],
  [ 99, 'Es', 'Einsteinium',252.000,  1.30,  176, 245,  1133, 1269,   4,  0.0140, 2.939, 0xB31FD4,  3],
  [100, 'Fm', 'Fermium',    257.000,  1.30,  176, 245,  1800, 1800,   4,  0.0140, 2.930, 0xB31FBA,  3],
  [101, 'Md', 'Mendelevium',258.000,  1.30,  176, 246,  1100, 1100,   4,  0.0140, 2.921, 0xB30DA6,  3],
  [102, 'No', 'Nobelium',   259.000,  1.30,  176, 246,  1100, 1100,   4,  0.0140, 2.910, 0xBD0D87,  2],
  [103, 'Lr', 'Lawrencium', 262.000,  1.30,  176, 246,  1900, 1900,   3,  0.0140, 2.883, 0xC70066,  3],
  [104, 'Rf', 'Rutherfordium',267.0,  1.30,  157, 246,  2400, 5800,   4,  0.0300, 2.798, 0xCC0059,  4],
  [105, 'Db', 'Dubnium',    268.000,  1.30,  149, 246,  2400, 5800,   5,  0.0300, 2.798, 0xD1004F,  5],
  [106, 'Sg', 'Seaborgium', 271.000,  1.30,  143, 246,  2400, 5800,   6,  0.0300, 2.798, 0xD90045,  6],
  [107, 'Bh', 'Bohrium',    272.000,  1.30,  141, 246,  2400, 5800,   7,  0.0300, 2.798, 0xE0003B,  7],
  [108, 'Hs', 'Hassium',    270.000,  1.30,  134, 246,  2400, 5800,   8,  0.0300, 2.798, 0xE60032,  8],
  [109, 'Mt', 'Meitnerium', 276.000,  1.30,  129, 246,  2400, 5800,   9,  0.0300, 2.798, 0xEB0026,  3],
  [110, 'Ds', 'Darmstadtium',281.0,   1.30,  128, 246,  2400, 5800,  10,  0.0300, 2.798, 0xEF001A,  2],
  [111, 'Rg', 'Roentgenium',280.000,  1.30,  121, 246,  2400, 5800,  11,  0.0300, 2.798, 0xF20014,  1],
  [112, 'Cn', 'Copernicium',285.000,  1.30,  122, 246,  2400, 5800,  12,  0.0300, 2.798, 0xF6000D,  2],
  [113, 'Nh', 'Nihonium',   284.000,  1.30,  136, 246,  700,  1400,   3,  0.0300, 2.798, 0xF90004,  1],
  [114, 'Fl', 'Flerovium',  289.000,  1.30,  143, 246,  340,   420,   4,  0.0300, 2.798, 0xFB0000,  2],
  [115, 'Mc', 'Moscovium',  288.000,  1.30,  162, 246,  670,  1400,   5,  0.0300, 2.798, 0xFB0000,  1],
  [116, 'Lv', 'Livermorium',293.000,  1.30,  175, 246,  709,  1085,   6,  0.0300, 2.798, 0xFB0000,  2],
  [117, 'Ts', 'Tennessine', 294.000,  1.30,  165, 246,  723,   883,   7,  0.0300, 2.798, 0xFB0000, -1],
  [118, 'Og', 'Oganesson',  294.000,  1.30,  157, 246,  325,   450,   0,  0.0300, 2.798, 0xFB0000,  0],
];

// ============================================================================
// PARSED ELEMENT OBJECTS
// ============================================================================

/** @type {Object[]} Indexed by atomic number (1-118). Index 0 is null. */
const ELEMENTS_BY_Z = new Array(119);
/** @type {Map<string, Object>} Lookup by symbol */
const ELEMENTS_BY_SYMBOL = new Map();

for (const row of ELEMENT_DATA) {
  const el = {
    atomicNumber: row[0],
    symbol: row[1],
    name: row[2],
    mass: row[3],
    electronegativity: row[4],
    atomicRadius: row[5],       // picometers
    vanDerWaalsRadius: row[6],  // picometers
    meltPoint: row[7],          // Kelvin
    boilPoint: row[8],          // Kelvin
    valenceElectrons: row[9],
    ljEpsilon: row[10],         // eV (Lennard-Jones well depth)
    ljSigma: row[11],           // Ångströms (Lennard-Jones equilibrium distance)
    cpkColor: row[12],          // 0xRRGGBB
    defaultCharge: row[13],     // typical ionic charge
  };
  ELEMENTS_BY_Z[el.atomicNumber] = el;
  ELEMENTS_BY_SYMBOL.set(el.symbol, el);
}

// ============================================================================
// PUBLIC API — ELEMENT LOOKUP
// ============================================================================

/**
 * Get element by atomic number (1-118).
 * @param {number} atomicNumber
 * @returns {Object|null}
 */
export function getElement(atomicNumber) {
  return ELEMENTS_BY_Z[atomicNumber] || null;
}

/**
 * Get element by symbol ('H', 'Fe', 'Au', etc.).
 * @param {string} symbol
 * @returns {Object|null}
 */
export function getElementBySymbol(symbol) {
  return ELEMENTS_BY_SYMBOL.get(symbol) || null;
}

/**
 * Get all elements.
 * @returns {Object[]}
 */
export function getAllElements() {
  return ELEMENTS_BY_Z.filter(Boolean);
}

// ============================================================================
// ELEMENT SHORTHAND CONSTANTS
// ============================================================================

/** Quick access: ELEMENTS.H = 1, ELEMENTS.Fe = 26, etc. */
export const ELEMENTS = {};
for (const [sym, el] of ELEMENTS_BY_SYMBOL) {
  ELEMENTS[sym] = el.atomicNumber;
}

// ============================================================================
// LENNARD-JONES MIXING RULES
// ============================================================================

/**
 * Compute Lennard-Jones cross-interaction parameters using Lorentz-Berthelot rules.
 * @param {number} z1 - Atomic number of element 1
 * @param {number} z2 - Atomic number of element 2
 * @returns {{ epsilon: number, sigma: number }}
 */
export function ljMixingRule(z1, z2) {
  const e1 = ELEMENTS_BY_Z[z1]; const e2 = ELEMENTS_BY_Z[z2];
  if (!e1 || !e2) return { epsilon: 0.01, sigma: 3.0 };
  return {
    epsilon: Math.sqrt(e1.ljEpsilon * e2.ljEpsilon),
    sigma: (e1.ljSigma + e2.ljSigma) * 0.5,
  };
}

// ============================================================================
// MOLECULE / COMPOUND PRESETS
// ============================================================================

/**
 * Common molecule presets — arrays of { element, count, charge }.
 */
export const MOLECULE_PRESETS = {
  H2:   [{ element: 1, count: 2 }],
  O2:   [{ element: 8, count: 2 }],
  N2:   [{ element: 7, count: 2 }],
  H2O:  [{ element: 1, count: 2 }, { element: 8, count: 1 }],
  CO2:  [{ element: 6, count: 1 }, { element: 8, count: 2 }],
  NaCl: [{ element: 11, count: 1, charge: 1 }, { element: 17, count: 1, charge: -1 }],
  CH4:  [{ element: 6, count: 1 }, { element: 1, count: 4 }],
  NH3:  [{ element: 7, count: 1 }, { element: 1, count: 3 }],
  Fe:   [{ element: 26, count: 1 }],
  Au:   [{ element: 79, count: 1 }],
  SiO2: [{ element: 14, count: 1 }, { element: 8, count: 2 }],
};

// ============================================================================
// GPU ELEMENT BUFFER — per-particle element type
// ============================================================================

/**
 * Create the element table system with per-particle element buffer.
 * @param {GPUDevice} device
 * @param {number} maxParticles
 */
export function createElementTable(device, maxParticles) {
  // Per-particle element type (u32: atomicNumber 1-118, 0 = unassigned)
  const elementBuffer = device.createBuffer({
    label: 'ElementTable.elements',
    size: maxParticles * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  labelResource(elementBuffer, 'ElementTable.elements');

  // Per-particle charge (f32: can be fractional for partial charges)
  const chargeBuffer = device.createBuffer({
    label: 'ElementTable.charges',
    size: maxParticles * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  labelResource(chargeBuffer, 'ElementTable.charges');

  // Element property LUT — uploaded to GPU for shader access
  // 128 entries × 8 floats = 4096 bytes (covers elements 0-127)
  // Layout per entry: [mass, ljEpsilon, ljSigma, charge, meltPoint, boilPoint, atomicRadius, electronegativity]
  const lutSize = 128 * 8 * 4; // 128 elements × 8 floats × 4 bytes
  const lutBuffer = device.createBuffer({
    label: 'ElementTable.lut',
    size: lutSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  labelResource(lutBuffer, 'ElementTable.lut');

  // Upload LUT data
  const lutData = new Float32Array(128 * 8);
  for (let z = 1; z <= 118; z++) {
    const el = ELEMENTS_BY_Z[z];
    if (!el) continue;
    const base = z * 8;
    lutData[base + 0] = el.mass;
    lutData[base + 1] = el.ljEpsilon;
    lutData[base + 2] = el.ljSigma;
    lutData[base + 3] = el.defaultCharge;
    lutData[base + 4] = el.meltPoint;
    lutData[base + 5] = el.boilPoint;
    lutData[base + 6] = el.atomicRadius * 0.01; // pm → Å (divide by 100)
    lutData[base + 7] = el.electronegativity;
  }
  device.queue.writeBuffer(lutBuffer, 0, lutData);

  // CPK color LUT — for rendering (vec4 per element: r, g, b, 1)
  const colorLutSize = 128 * 4 * 4; // 128 entries × vec4<f32>
  const colorLutBuffer = device.createBuffer({
    label: 'ElementTable.colorLut',
    size: colorLutSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  labelResource(colorLutBuffer, 'ElementTable.colorLut');

  const colorData = new Float32Array(128 * 4);
  for (let z = 1; z <= 118; z++) {
    const el = ELEMENTS_BY_Z[z];
    if (!el) continue;
    const base = z * 4;
    colorData[base + 0] = ((el.cpkColor >> 16) & 0xFF) / 255;
    colorData[base + 1] = ((el.cpkColor >> 8) & 0xFF) / 255;
    colorData[base + 2] = (el.cpkColor & 0xFF) / 255;
    colorData[base + 3] = 1.0;
  }
  device.queue.writeBuffer(colorLutBuffer, 0, colorData);

  return {
    device,
    elementBuffer,
    chargeBuffer,
    lutBuffer,
    colorLutBuffer,
    maxParticles,
  };
}

/**
 * Set element type for a range of particles.
 * @param {Object} system
 * @param {GPUDevice} device
 * @param {number} startIndex
 * @param {number} count
 * @param {number} atomicNumber (1-118)
 */
export function setParticleElements(system, device, startIndex, count, atomicNumber) {
  if (!system || startIndex + count > system.maxParticles) return;
  const data = new Uint32Array(count);
  data.fill(atomicNumber);
  device.queue.writeBuffer(system.elementBuffer, startIndex * 4, data);

  // Also set default charges from element table
  const el = ELEMENTS_BY_Z[atomicNumber];
  if (el) {
    const charges = new Float32Array(count);
    charges.fill(el.defaultCharge);
    device.queue.writeBuffer(system.chargeBuffer, startIndex * 4, charges);
  }
}

/**
 * Set charge for a range of particles (overrides element default).
 */
export function setParticleCharges(system, device, startIndex, count, charge) {
  if (!system || startIndex + count > system.maxParticles) return;
  const data = new Float32Array(count);
  data.fill(charge);
  device.queue.writeBuffer(system.chargeBuffer, startIndex * 4, data);
}

/**
 * Destroy the element table system.
 */
export function destroyElementTable(system) {
  if (!system) return;
  if (system.elementBuffer) system.elementBuffer.destroy();
  if (system.chargeBuffer) system.chargeBuffer.destroy();
  if (system.lutBuffer) system.lutBuffer.destroy();
  if (system.colorLutBuffer) system.colorLutBuffer.destroy();
}

// ============================================================================
// WGSL SNIPPET — for inclusion in compute/render shaders
// ============================================================================

/**
 * WGSL struct and accessor for element LUT.
 * Bind elementLUT as storage buffer, elementTypes and charges as storage buffers.
 */
export const ELEMENT_LUT_WGSL = /* wgsl */`
struct ElementProps {
  mass: f32,
  ljEpsilon: f32,
  ljSigma: f32,
  defaultCharge: f32,
  meltPoint: f32,
  boilPoint: f32,
  atomicRadius: f32,
  electronegativity: f32,
};

fn getElementProps(elementLUT: ptr<storage, array<f32>, read>, atomicNumber: u32) -> ElementProps {
  let base = atomicNumber * 8u;
  return ElementProps(
    (*elementLUT)[base + 0u],
    (*elementLUT)[base + 1u],
    (*elementLUT)[base + 2u],
    (*elementLUT)[base + 3u],
    (*elementLUT)[base + 4u],
    (*elementLUT)[base + 5u],
    (*elementLUT)[base + 6u],
    (*elementLUT)[base + 7u],
  );
}
`;
