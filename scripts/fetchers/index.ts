import type { CityFetcher } from './types.ts';
import { KarlsruheFetcher } from './karlsruhe.ts';
import { FreiburgFetcher } from './freiburg.ts';
import { AachenFetcher } from './aachen.ts';
import { NuernbergFetcher } from './nuernberg.ts';
import { DarmstadtFetcher } from './darmstadt.ts';
import { RegioItFetcher } from './regioit.ts';
import { HeidelbergFetcher } from './heidelberg.ts';
import { KoelnFetcher } from './koeln.ts';
import { LeipzigFetcher } from './leipzig.ts';
import { MuellmaxFetcher, type MuellmaxConfig } from './muellmax.ts';
import { AbfallPlusFetcher, type AbfallPlusConfig } from './abfallplus.ts';
import { JumoMindFetcher, type JumoMindConfig } from './jumomind.ts';
import jumoCitiesRaw from './jumomind-cities.json' with { type: 'json' };
import abfallPlusCitiesRaw from './abfallplus-cities.json' with { type: 'json' };
import muellmaxCitiesRaw from './muellmax-cities.json' with { type: 'json' };

export * from './types.ts';
export * from './karlsruhe.ts';
export * from './freiburg.ts';
export * from './regioit.ts';
export * from './heidelberg.ts';
export * from './koeln.ts';
export * from './leipzig.ts';
export * from './muellmax.ts';
export * from './abfallplus.ts';
export * from './aachen.ts';
export * from './nuernberg.ts';
export * from './jumomind.ts';
export * from './darmstadt.ts';

const jumoCities = jumoCitiesRaw as JumoMindConfig[];
const abfallPlusCities = abfallPlusCitiesRaw as AbfallPlusConfig[];
const muellmaxCities = muellmaxCitiesRaw as MuellmaxConfig[];

export const REGIOIT_EXTRA_FETCHERS: CityFetcher[] = [
  new RegioItFetcher({
    id: 'oberhausen',
    name: 'Oberhausen',
    shortName: 'OB',
    serviceDomain: 'oberhausen',
    center: [6.8514, 51.4696],
    defaultZoom: 12,
    bbox: [51.4487, 6.7773, 51.58, 6.9305]
  }),
  new RegioItFetcher({
    id: 'muelheim',
    name: 'Mülheim an der Ruhr',
    shortName: 'MH',
    serviceDomain: 'muelheim',
    center: [6.8829, 51.4273],
    defaultZoom: 12,
    bbox: [51.3507, 6.8067, 51.4714, 6.9595]
  }),
  new RegioItFetcher({
    id: 'solingen',
    name: 'Solingen',
    shortName: 'SG',
    serviceDomain: 'solingen',
    center: [7.0846, 51.1722],
    defaultZoom: 12,
    bbox: [51.1142, 6.9511, 51.2204, 7.1741]
  }),
  new RegioItFetcher({
    id: 'bergisch-gladbach',
    name: 'Bergisch Gladbach',
    shortName: 'GL',
    serviceDomain: 'aw-bgl2',
    center: [7.1277, 50.9929],
    defaultZoom: 12,
    bbox: [50.9199, 7.0618, 51.0269, 7.2546]
  }),
  new RegioItFetcher({
    id: 'cottbus',
    name: 'Cottbus',
    shortName: 'CB',
    serviceDomain: 'cottbus',
    center: [14.3357, 51.7567],
    defaultZoom: 12,
    bbox: [51.6925, 14.2733, 51.8642, 14.5013]
  }),
  new RegioItFetcher({
    id: 'norderstedt',
    name: 'Norderstedt',
    shortName: 'NIZ',
    serviceDomain: 'nds',
    center: [9.9892, 53.709],
    defaultZoom: 12,
    bbox: [53.6481, 9.9348, 53.7598, 10.0729]
  }),
  new RegioItFetcher({
    id: 'luedenscheid',
    name: 'Lüdenscheid',
    shortName: 'MK',
    serviceDomain: 'stl',
    center: [7.6397, 51.2181],
    defaultZoom: 12,
    bbox: [51.1551, 7.5522, 51.2708, 7.7233]
  }),
  new RegioItFetcher({
    id: 'dorsten',
    name: 'Dorsten',
    shortName: 'DOR',
    serviceDomain: 'dorsten',
    center: [6.9647, 51.6604],
    defaultZoom: 12,
    bbox: [51.6228, 6.8939, 51.801, 7.0882]
  }),
  new RegioItFetcher({
    id: 'dinslaken',
    name: 'Dinslaken',
    shortName: 'DIN',
    serviceDomain: 'din',
    center: [6.7345, 51.5624],
    defaultZoom: 12,
    bbox: [51.5325, 6.6865, 51.6082, 6.866]
  }),
  new RegioItFetcher({
    id: 'frankenthal',
    name: 'Frankenthal',
    shortName: 'FT',
    serviceDomain: 'frankenthal',
    center: [8.3541, 49.5353],
    defaultZoom: 12,
    bbox: [49.4847, 8.3093, 49.5826, 8.4229]
  }),
  new RegioItFetcher({
    id: 'bocholt',
    name: 'Bocholt',
    shortName: 'BOH',
    serviceDomain: 'wml2',
    center: [6.6149, 51.8383],
    defaultZoom: 12,
    bbox: [51.7898, 6.4725, 51.9176, 6.7212]
  }),
  new RegioItFetcher({
    id: 'coesfeld',
    name: 'Coesfeld',
    shortName: 'COE',
    serviceDomain: 'coe',
    center: [7.1691, 51.9459],
    defaultZoom: 12,
    bbox: [51.8462, 7.0557, 51.9879, 7.2612]
  }),
  new RegioItFetcher({
    id: 'luenen',
    name: 'Lünen',
    shortName: 'LÜN',
    serviceDomain: 'unna',
    center: [7.5228, 51.6142],
    defaultZoom: 12,
    bbox: [51.578, 7.4179, 51.6527, 7.5923]
  }),
  new RegioItFetcher({
    id: 'viersen',
    name: 'Viersen',
    shortName: 'VIE',
    serviceDomain: 'viersen',
    center: [6.3905, 51.2562],
    defaultZoom: 12,
    bbox: [51.2165, 6.2642, 51.3223, 6.4578]
  }),
  new RegioItFetcher({
    id: 'unna',
    name: 'Unna',
    shortName: 'UN',
    serviceDomain: 'unna',
    center: [7.689, 51.5349],
    defaultZoom: 12,
    bbox: [51.4904, 7.6288, 51.5786, 7.8429]
  }),
  new RegioItFetcher({
    id: 'ahlen',
    name: 'Ahlen',
    shortName: 'AHL',
    serviceDomain: 'krwaf',
    center: [7.8909, 51.7628],
    defaultZoom: 12,
    bbox: [51.7001, 7.7882, 51.8313, 7.9916]
  }),
  new RegioItFetcher({
    id: 'eschweiler',
    name: 'Eschweiler',
    shortName: 'ESW',
    serviceDomain: 'zew2',
    center: [6.2631, 50.8175],
    defaultZoom: 12,
    bbox: [50.7783, 6.1905, 50.884, 6.3409]
  }),
  new RegioItFetcher({
    id: 'stolberg',
    name: 'Stolberg',
    shortName: 'STB',
    serviceDomain: 'zew2',
    center: [6.2296, 50.7703],
    defaultZoom: 12,
    bbox: [50.6847, 6.1745, 50.8056, 6.3656]
  }),
  new RegioItFetcher({
    id: 'elmshorn',
    name: 'Elmshorn',
    shortName: 'ELM',
    serviceDomain: 'pi',
    center: [9.6525, 53.7532],
    defaultZoom: 12,
    bbox: [53.7261, 9.6216, 53.7813, 9.7215]
  }),
  new RegioItFetcher({
    id: 'pinneberg',
    name: 'Pinneberg',
    shortName: 'PI',
    serviceDomain: 'pi',
    center: [9.7995, 53.6622],
    defaultZoom: 12,
    bbox: [53.6231, 9.7346, 53.6934, 9.845]
  }),
  new RegioItFetcher({
    id: 'erkelenz',
    name: 'Erkelenz',
    shortName: 'ERK',
    serviceDomain: 'krhs',
    center: [6.3161, 51.081],
    defaultZoom: 12,
    bbox: [51.0127, 6.2007, 51.117, 6.4774]
  }),
  new RegioItFetcher({
    id: 'ascheberg',
    name: 'Ascheberg',
    shortName: 'ASC',
    serviceDomain: 'coe',
    center: [7.6197, 51.7887],
    defaultZoom: 12,
    bbox: [51.7055, 7.5487, 51.843, 7.7373]
  }),
  new RegioItFetcher({
    id: 'billerbeck',
    name: 'Billerbeck',
    shortName: 'BIL',
    serviceDomain: 'coe',
    center: [7.2909, 51.9774],
    defaultZoom: 12,
    bbox: [51.9367, 7.2115, 52.0407, 7.4345]
  }),
  new RegioItFetcher({
    id: 'duelmen',
    name: 'Dülmen',
    shortName: 'DÜL',
    serviceDomain: 'coe',
    center: [7.2791, 51.8284],
    defaultZoom: 12,
    bbox: [51.7785, 7.0997, 51.9263, 7.4339]
  }),
  new RegioItFetcher({
    id: 'havixbeck',
    name: 'Havixbeck',
    shortName: 'HAV',
    serviceDomain: 'coe',
    center: [7.4136, 51.9751],
    defaultZoom: 12,
    bbox: [51.9315, 7.3652, 52.0096, 7.5227]
  }),
  new RegioItFetcher({
    id: 'luedinghausen',
    name: 'Lüdinghausen',
    shortName: 'LÜD',
    serviceDomain: 'coe',
    center: [7.4446, 51.7718],
    defaultZoom: 12,
    bbox: [51.7216, 7.259, 51.8337, 7.5385]
  }),
  new RegioItFetcher({
    id: 'nordkirchen',
    name: 'Nordkirchen',
    shortName: 'NOR',
    serviceDomain: 'coe',
    center: [7.5252, 51.738],
    defaultZoom: 12,
    bbox: [51.6848, 7.4772, 51.7757, 7.6278]
  }),
  new RegioItFetcher({
    id: 'nottuln',
    name: 'Nottuln',
    shortName: 'NOT',
    serviceDomain: 'coe',
    center: [7.3533, 51.9297],
    defaultZoom: 12,
    bbox: [51.8769, 7.2541, 51.9706, 7.4624]
  }),
  new RegioItFetcher({
    id: 'olfen',
    name: 'Olfen',
    shortName: 'OLF',
    serviceDomain: 'coe',
    center: [7.3788, 51.7076],
    defaultZoom: 12,
    bbox: [51.6647, 7.2988, 51.7429, 7.4518]
  }),
  new RegioItFetcher({
    id: 'rosendahl',
    name: 'Rosendahl',
    shortName: 'ROS',
    serviceDomain: 'coe',
    center: [7.197, 52.0202],
    defaultZoom: 12,
    bbox: [51.9741, 7.0515, 52.0622, 7.3359]
  }),
  new RegioItFetcher({
    id: 'senden-westfalen',
    name: 'Senden (Westfalen)',
    shortName: 'SDW',
    serviceDomain: 'coe',
    center: [7.4883, 51.855],
    defaultZoom: 12,
    bbox: [51.7719, 7.4204, 51.9415, 7.6015]
  }),
  new RegioItFetcher({
    id: 'brueggen',
    name: 'Brüggen',
    shortName: 'BRÜ',
    serviceDomain: 'viersen',
    center: [6.1812, 51.2431],
    defaultZoom: 12,
    bbox: [51.2273, 6.0727, 51.3074, 6.2415]
  }),
  new RegioItFetcher({
    id: 'grefrath',
    name: 'Grefrath',
    shortName: 'GRE',
    serviceDomain: 'viersen',
    center: [6.3437, 51.3361],
    defaultZoom: 12,
    bbox: [51.3046, 6.304, 51.3793, 6.4063]
  }),
  new RegioItFetcher({
    id: 'kempen',
    name: 'Kempen',
    shortName: 'KEM',
    serviceDomain: 'viersen',
    center: [6.4195, 51.3642],
    defaultZoom: 12,
    bbox: [51.3306, 6.3584, 51.425, 6.5356]
  }),
  new RegioItFetcher({
    id: 'nettetal',
    name: 'Nettetal',
    shortName: 'NET',
    serviceDomain: 'viersen',
    center: [6.2714, 51.3155],
    defaultZoom: 12,
    bbox: [51.2528, 6.1538, 51.3659, 6.3266]
  }),
  new RegioItFetcher({
    id: 'niederkruechten',
    name: 'Niederkrüchten',
    shortName: 'NIE',
    serviceDomain: 'viersen',
    center: [6.2197, 51.2],
    defaultZoom: 12,
    bbox: [51.1668, 6.068, 51.24, 6.2509]
  }),
  new RegioItFetcher({
    id: 'schwalmtal',
    name: 'Schwalmtal',
    shortName: 'SCH',
    serviceDomain: 'viersen',
    center: [6.2707, 51.2273],
    defaultZoom: 12,
    bbox: [51.1754, 6.2097, 51.2687, 6.3311]
  }),
  new RegioItFetcher({
    id: 'toenisvorst',
    name: 'Tönisvorst',
    shortName: 'TÖN',
    serviceDomain: 'viersen',
    center: [6.45, 51.3167],
    defaultZoom: 12,
    bbox: [51.2775, 6.3871, 51.3493, 6.5157]
  }),
  new RegioItFetcher({
    id: 'willich',
    name: 'Willich',
    shortName: 'WIL',
    serviceDomain: 'viersen',
    center: [6.5447, 51.2641],
    defaultZoom: 12,
    bbox: [51.2226, 6.413, 51.2999, 6.626]
  }),
  new RegioItFetcher({
    id: 'gangelt',
    name: 'Gangelt',
    shortName: 'GAN',
    serviceDomain: 'krhs',
    center: [5.9971, 50.9928],
    defaultZoom: 12,
    bbox: [50.9479, 5.9528, 51.0424, 6.0811]
  }),
  new RegioItFetcher({
    id: 'geilenkirchen',
    name: 'Geilenkirchen',
    shortName: 'GEI',
    serviceDomain: 'krhs',
    center: [6.12, 50.9636],
    defaultZoom: 12,
    bbox: [50.9299, 6.0151, 51.0174, 6.2369]
  }),
  new RegioItFetcher({
    id: 'heinsberg',
    name: 'Heinsberg',
    shortName: 'HEI',
    serviceDomain: 'krhs',
    center: [6.0984, 51.0654],
    defaultZoom: 12,
    bbox: [50.9965, 6.0392, 51.1221, 6.2139]
  }),
  new RegioItFetcher({
    id: 'hueckelhoven',
    name: 'Hückelhoven',
    shortName: 'HÜC',
    serviceDomain: 'krhs',
    center: [6.2247, 51.0552],
    defaultZoom: 12,
    bbox: [50.9871, 6.1526, 51.0899, 6.3066]
  }),
  new RegioItFetcher({
    id: 'selfkant',
    name: 'Selfkant',
    shortName: 'SEL',
    serviceDomain: 'krhs',
    center: [5.9218, 51.0207],
    defaultZoom: 12,
    bbox: [50.9746, 5.8663, 51.0669, 5.9835]
  }),
  new RegioItFetcher({
    id: 'uebach-palenberg',
    name: 'Übach-Palenberg',
    shortName: 'ÜP',
    serviceDomain: 'krhs',
    center: [6.1129, 50.9214],
    defaultZoom: 12,
    bbox: [50.8979, 6.0151, 50.9533, 6.1564]
  }),
  new RegioItFetcher({
    id: 'waldfeucht',
    name: 'Waldfeucht',
    shortName: 'WAL',
    serviceDomain: 'krhs',
    center: [5.9888, 51.0667],
    defaultZoom: 12,
    bbox: [51.0301, 5.9681, 51.1063, 6.0609]
  }),
  new RegioItFetcher({
    id: 'wassenberg',
    name: 'Wassenberg',
    shortName: 'WAS',
    serviceDomain: 'krhs',
    center: [6.1561, 51.1007],
    defaultZoom: 12,
    bbox: [51.0761, 6.08, 51.1487, 6.2064]
  }),
  new RegioItFetcher({
    id: 'bergkamen',
    name: 'Bergkamen',
    shortName: 'BER',
    serviceDomain: 'unna',
    center: [7.6363, 51.6149],
    defaultZoom: 12,
    bbox: [51.5877, 7.5606, 51.6611, 7.6905]
  }),
  new RegioItFetcher({
    id: 'boenen',
    name: 'Bönen',
    shortName: 'BÖN',
    serviceDomain: 'unna',
    center: [7.7589, 51.5981],
    defaultZoom: 12,
    bbox: [51.5612, 7.714, 51.6269, 7.825]
  }),
  new RegioItFetcher({
    id: 'froendenberg',
    name: 'Fröndenberg',
    shortName: 'FRÖ',
    serviceDomain: 'unna',
    center: [7.7618, 51.4713],
    defaultZoom: 12,
    bbox: [51.4663, 7.7568, 51.4763, 7.7668]
  }),
  new RegioItFetcher({
    id: 'holzwickede',
    name: 'Holzwickede',
    shortName: 'HOL',
    serviceDomain: 'unna',
    center: [7.6186, 51.5007],
    defaultZoom: 12,
    bbox: [51.4515, 7.5964, 51.5211, 7.6729]
  }),
  new RegioItFetcher({
    id: 'kamen',
    name: 'Kamen',
    shortName: 'KAM',
    serviceDomain: 'unna',
    center: [7.6617, 51.5918],
    defaultZoom: 12,
    bbox: [51.5485, 7.5903, 51.615, 7.7503]
  }),
  new RegioItFetcher({
    id: 'schwerte',
    name: 'Schwerte',
    shortName: 'SCH',
    serviceDomain: 'unna',
    center: [7.5675, 51.4455],
    defaultZoom: 12,
    bbox: [51.3852, 7.5047, 51.476, 7.6344]
  }),
  new RegioItFetcher({
    id: 'selm',
    name: 'Selm',
    shortName: 'SEL',
    serviceDomain: 'unna',
    center: [7.4686, 51.7006],
    defaultZoom: 12,
    bbox: [51.6404, 7.4088, 51.7362, 7.5491]
  }),
  new RegioItFetcher({
    id: 'werne',
    name: 'Werne',
    shortName: 'WER',
    serviceDomain: 'unna',
    center: [7.6355, 51.6627],
    defaultZoom: 12,
    bbox: [51.6271, 7.5406, 51.7288, 7.7287]
  }),
  new RegioItFetcher({
    id: 'ahaus',
    name: 'Ahaus',
    shortName: 'AHA',
    serviceDomain: 'wml2',
    center: [7.0049, 52.0762],
    defaultZoom: 12,
    bbox: [52.0211, 6.8671, 52.1811, 7.0673]
  }),
  new RegioItFetcher({
    id: 'borken',
    name: 'Borken',
    shortName: 'BOR',
    serviceDomain: 'wml2',
    center: [6.8583, 51.8445],
    defaultZoom: 12,
    bbox: [51.7737, 6.7323, 51.9329, 6.9236]
  }),
  new RegioItFetcher({
    id: 'gescher',
    name: 'Gescher',
    shortName: 'GES',
    serviceDomain: 'wml2',
    center: [7.0039, 51.9569],
    defaultZoom: 12,
    bbox: [51.8837, 6.9256, 52.005, 7.0902]
  }),
  new RegioItFetcher({
    id: 'gronau',
    name: 'Gronau',
    shortName: 'GRO',
    serviceDomain: 'wml2',
    center: [7.0264, 52.2086],
    defaultZoom: 12,
    bbox: [52.1349, 6.9504, 52.243, 7.1028]
  }),
  new RegioItFetcher({
    id: 'heek',
    name: 'Heek',
    shortName: 'HEE',
    serviceDomain: 'wml2',
    center: [7.1012, 52.1242],
    defaultZoom: 12,
    bbox: [52.08, 7.0128, 52.1969, 7.1744]
  }),
  new RegioItFetcher({
    id: 'heiden',
    name: 'Heiden',
    shortName: 'HEI',
    serviceDomain: 'wml2',
    center: [6.9341, 51.8265],
    defaultZoom: 12,
    bbox: [51.7719, 6.8887, 51.8699, 7.0253]
  }),
  new RegioItFetcher({
    id: 'isselburg',
    name: 'Isselburg',
    shortName: 'ISS',
    serviceDomain: 'wml2',
    center: [6.4614, 51.8344],
    defaultZoom: 12,
    bbox: [51.8028, 6.3868, 51.874, 6.5323]
  }),
  new RegioItFetcher({
    id: 'legden',
    name: 'Legden',
    shortName: 'LEG',
    serviceDomain: 'wml2',
    center: [7.1057, 52.0306],
    defaultZoom: 12,
    bbox: [52.004, 7.0393, 52.0904, 7.1855]
  }),
  new RegioItFetcher({
    id: 'raesfeld',
    name: 'Raesfeld',
    shortName: 'RAE',
    serviceDomain: 'wml2',
    center: [6.8382, 51.7694],
    defaultZoom: 12,
    bbox: [51.7289, 6.7543, 51.8028, 6.9163]
  }),
  new RegioItFetcher({
    id: 'reken',
    name: 'Reken',
    shortName: 'REK',
    serviceDomain: 'wml2',
    center: [7.0442, 51.8311],
    defaultZoom: 12,
    bbox: [51.7769, 6.9778, 51.8883, 7.1738]
  }),
  new RegioItFetcher({
    id: 'rhede',
    name: 'Rhede',
    shortName: 'RHE',
    serviceDomain: 'wml2',
    center: [6.6961, 51.8363],
    defaultZoom: 12,
    bbox: [51.7685, 6.6436, 51.9055, 6.7657]
  }),
  new RegioItFetcher({
    id: 'schoeppingen',
    name: 'Schöppingen',
    shortName: 'SCH',
    serviceDomain: 'wml2',
    center: [7.2369, 52.0926],
    defaultZoom: 12,
    bbox: [52.043, 7.1019, 52.1292, 7.2745]
  }),
  new RegioItFetcher({
    id: 'stadtlohn',
    name: 'Stadtlohn',
    shortName: 'STA',
    serviceDomain: 'wml2',
    center: [6.9173, 51.9928],
    defaultZoom: 12,
    bbox: [51.9619, 6.8284, 52.0463, 7.0504]
  }),
  new RegioItFetcher({
    id: 'suedlohn',
    name: 'Südlohn',
    shortName: 'SÜD',
    serviceDomain: 'wml2',
    center: [6.8658, 51.9446],
    defaultZoom: 12,
    bbox: [51.9077, 6.754, 51.9939, 6.9308]
  }),
  new RegioItFetcher({
    id: 'velen',
    name: 'Velen',
    shortName: 'VEL',
    serviceDomain: 'wml2',
    center: [6.9839, 51.8957],
    defaultZoom: 12,
    bbox: [51.8509, 6.8813, 51.9421, 7.0505]
  }),
  new RegioItFetcher({
    id: 'vreden',
    name: 'Vreden',
    shortName: 'VRE',
    serviceDomain: 'wml2',
    center: [6.8236, 52.0359],
    defaultZoom: 12,
    bbox: [51.9935, 6.6867, 52.1281, 6.911]
  }),
  new RegioItFetcher({
    id: 'burscheid',
    name: 'Burscheid',
    shortName: 'BUR',
    serviceDomain: 'bav',
    center: [7.1212, 51.0825],
    defaultZoom: 12,
    bbox: [51.0635, 7.0576, 51.119, 7.1692]
  }),
  new RegioItFetcher({
    id: 'engelskirchen',
    name: 'Engelskirchen',
    shortName: 'ENG',
    serviceDomain: 'bav',
    center: [7.4084, 50.9873],
    defaultZoom: 12,
    bbox: [50.9463, 7.3259, 51.0255, 7.5154]
  }),
  new RegioItFetcher({
    id: 'hueckeswagen',
    name: 'Hückeswagen',
    shortName: 'HÜC',
    serviceDomain: 'bav',
    center: [7.3414, 51.1505],
    defaultZoom: 12,
    bbox: [51.1009, 7.2695, 51.1967, 7.3988]
  }),
  new RegioItFetcher({
    id: 'kuerten',
    name: 'Kürten',
    shortName: 'KÜR',
    serviceDomain: 'bav',
    center: [7.2613, 51.054],
    defaultZoom: 12,
    bbox: [50.9862, 7.1842, 51.0868, 7.3392]
  }),
  new RegioItFetcher({
    id: 'leichlingen',
    name: 'Leichlingen',
    shortName: 'LEI',
    serviceDomain: 'bav',
    center: [7.014, 51.106],
    defaultZoom: 12,
    bbox: [51.0809, 6.9882, 51.1385, 7.1578]
  }),
  new RegioItFetcher({
    id: 'lindlar',
    name: 'Lindlar',
    shortName: 'LIN',
    serviceDomain: 'bav',
    center: [7.378, 51.0186],
    defaultZoom: 12,
    bbox: [50.9711, 7.2509, 51.0791, 7.4617]
  }),
  new RegioItFetcher({
    id: 'morsbach',
    name: 'Morsbach',
    shortName: 'MOR',
    serviceDomain: 'bav',
    center: [7.7283, 50.8643],
    defaultZoom: 12,
    bbox: [50.8186, 7.6458, 50.9173, 7.7665]
  }),
  new RegioItFetcher({
    id: 'nuembrecht',
    name: 'Nümbrecht',
    shortName: 'NÜM',
    serviceDomain: 'bav',
    center: [7.5409, 50.9034],
    defaultZoom: 12,
    bbox: [50.8514, 7.4604, 50.9409, 7.6209]
  }),
  new RegioItFetcher({
    id: 'odenthal',
    name: 'Odenthal',
    shortName: 'ODE',
    serviceDomain: 'bav',
    center: [7.1172, 51.0327],
    defaultZoom: 12,
    bbox: [51.0102, 7.0909, 51.0747, 7.2104]
  }),
  new RegioItFetcher({
    id: 'overath',
    name: 'Overath',
    shortName: 'OVE',
    serviceDomain: 'bav',
    center: [7.2839, 50.932],
    defaultZoom: 12,
    bbox: [50.9066, 7.1939, 50.9878, 7.3987]
  }),
  new RegioItFetcher({
    id: 'radevormwald',
    name: 'Radevormwald',
    shortName: 'RAD',
    serviceDomain: 'bav',
    center: [7.3571, 51.2029],
    defaultZoom: 12,
    bbox: [51.1695, 7.295, 51.2505, 7.4339]
  }),
  new RegioItFetcher({
    id: 'reichshof',
    name: 'Reichshof',
    shortName: 'REI',
    serviceDomain: 'bav',
    center: [7.6911, 50.9508],
    defaultZoom: 12,
    bbox: [50.9006, 7.5892, 51.0114, 7.7917]
  }),
  new RegioItFetcher({
    id: 'wermelskirchen',
    name: 'Wermelskirchen',
    shortName: 'WER',
    serviceDomain: 'bav',
    center: [7.2157, 51.1406],
    defaultZoom: 12,
    bbox: [51.0646, 7.1386, 51.161, 7.2989]
  }),
  new RegioItFetcher({
    id: 'beckum',
    name: 'Beckum',
    shortName: 'BEC',
    serviceDomain: 'krwaf',
    center: [8.0411, 51.7555],
    defaultZoom: 12,
    bbox: [51.7017, 7.9529, 51.8191, 8.1376]
  }),
  new RegioItFetcher({
    id: 'beelen',
    name: 'Beelen',
    shortName: 'BEE',
    serviceDomain: 'krwaf',
    center: [8.1178, 51.93],
    defaultZoom: 12,
    bbox: [51.8931, 8.0693, 51.9571, 8.1735]
  }),
  new RegioItFetcher({
    id: 'borgholzhausen',
    name: 'Borgholzhausen',
    shortName: 'BOR',
    serviceDomain: 'krwaf',
    center: [8.2759, 52.0899],
    defaultZoom: 12,
    bbox: [52.0449, 8.2014, 52.1349, 8.3693]
  }),
  new RegioItFetcher({
    id: 'drensteinfurt',
    name: 'Drensteinfurt',
    shortName: 'DRE',
    serviceDomain: 'krwaf',
    center: [7.7418, 51.7973],
    defaultZoom: 12,
    bbox: [51.7238, 7.6114, 51.8787, 7.8173]
  }),
  new RegioItFetcher({
    id: 'ennigerloh',
    name: 'Ennigerloh',
    shortName: 'ENN',
    serviceDomain: 'krwaf',
    center: [8.0256, 51.836],
    defaultZoom: 12,
    bbox: [51.8047, 7.8783, 51.9229, 8.1409]
  }),
  new RegioItFetcher({
    id: 'everswinkel',
    name: 'Everswinkel',
    shortName: 'EVE',
    serviceDomain: 'krwaf',
    center: [7.8473, 51.9241],
    defaultZoom: 12,
    bbox: [51.8728, 7.7567, 51.9686, 7.9185]
  }),
  new RegioItFetcher({
    id: 'guetersloh',
    name: 'Gütersloh',
    shortName: 'GÜT',
    serviceDomain: 'krwaf',
    center: [8.4043, 51.9167],
    defaultZoom: 12,
    bbox: [51.856, 8.2855, 51.9771, 8.506]
  }),
  new RegioItFetcher({
    id: 'halle',
    name: 'Halle (Westf)',
    shortName: 'HAL',
    serviceDomain: 'krwaf',
    center: [8.3392, 52.0447],
    defaultZoom: 12,
    bbox: [51.9941, 8.2423, 52.0954, 8.4186]
  }),
  new RegioItFetcher({
    id: 'harsewinkel',
    name: 'Harsewinkel',
    shortName: 'HAR',
    serviceDomain: 'krwaf',
    center: [8.2252, 51.9617],
    defaultZoom: 12,
    bbox: [51.9264, 8.1055, 52.0142, 8.3323]
  }),
  new RegioItFetcher({
    id: 'herzebrock-clarholz',
    name: 'Herzebrock-Clarholz',
    shortName: 'HC',
    serviceDomain: 'krwaf',
    center: [8.2249, 51.8993],
    defaultZoom: 12,
    bbox: [51.8422, 8.1504, 51.9496, 8.3171]
  }),
  new RegioItFetcher({
    id: 'langenberg',
    name: 'Langenberg',
    shortName: 'LAN',
    serviceDomain: 'krwaf',
    center: [8.3159, 51.7755],
    defaultZoom: 12,
    bbox: [51.7222, 8.252, 51.8049, 8.3684]
  }),
  new RegioItFetcher({
    id: 'oelde',
    name: 'Oelde',
    shortName: 'OEL',
    serviceDomain: 'krwaf',
    center: [8.1455, 51.8261],
    defaultZoom: 12,
    bbox: [51.7581, 8.0818, 51.8997, 8.2599]
  }),
  new RegioItFetcher({
    id: 'ostbevern',
    name: 'Ostbevern',
    shortName: 'OST',
    serviceDomain: 'krwaf',
    center: [7.84, 52.0362],
    defaultZoom: 12,
    bbox: [51.9997, 7.7246, 52.104, 7.921]
  }),
  new RegioItFetcher({
    id: 'rheda-wiedenbrueck',
    name: 'Rheda-Wiedenbrück',
    shortName: 'RW',
    serviceDomain: 'krwaf',
    center: [8.2986, 51.8428],
    defaultZoom: 12,
    bbox: [51.7896, 8.1996, 51.8979, 8.4018]
  }),
  new RegioItFetcher({
    id: 'rietberg',
    name: 'Rietberg',
    shortName: 'RIE',
    serviceDomain: 'krwaf',
    center: [8.4287, 51.8074],
    defaultZoom: 12,
    bbox: [51.7174, 8.3332, 51.8761, 8.5346]
  }),
  new RegioItFetcher({
    id: 'sassenberg',
    name: 'Sassenberg',
    shortName: 'SAS',
    serviceDomain: 'krwaf',
    center: [8.0407, 51.9882],
    defaultZoom: 12,
    bbox: [51.9559, 7.9763, 52.0684, 8.1144]
  }),
  new RegioItFetcher({
    id: 'schloss-holte-stukenbrock',
    name: 'Schloß Holte-Stukenbrock',
    shortName: 'SS',
    serviceDomain: 'krwaf',
    center: [8.6353, 51.9017],
    defaultZoom: 12,
    bbox: [51.852, 8.5568, 51.9303, 8.7483]
  }),
  new RegioItFetcher({
    id: 'sendenhorst',
    name: 'Sendenhorst',
    shortName: 'SEN',
    serviceDomain: 'krwaf',
    center: [7.8274, 51.8444],
    defaultZoom: 12,
    bbox: [51.8012, 7.6868, 51.908, 7.8896]
  }),
  new RegioItFetcher({
    id: 'steinhagen',
    name: 'Steinhagen',
    shortName: 'STE',
    serviceDomain: 'krwaf',
    center: [8.3836, 51.9996],
    defaultZoom: 12,
    bbox: [51.9662, 8.2891, 52.045, 8.4616]
  }),
  new RegioItFetcher({
    id: 'wadersloh',
    name: 'Wadersloh',
    shortName: 'WAD',
    serviceDomain: 'krwaf',
    center: [8.2464, 51.7375],
    defaultZoom: 12,
    bbox: [51.6581, 8.1161, 51.7785, 8.3201]
  }),
  new RegioItFetcher({
    id: 'warendorf',
    name: 'Warendorf',
    shortName: 'WAR',
    serviceDomain: 'krwaf',
    center: [7.9912, 51.9532],
    defaultZoom: 12,
    bbox: [51.8518, 7.857, 52.0519, 8.1022]
  }),
  new RegioItFetcher({
    id: 'werther',
    name: 'Werther (Westf)',
    shortName: 'WER',
    serviceDomain: 'krwaf',
    center: [8.4279, 52.0856],
    defaultZoom: 12,
    bbox: [52.0437, 8.3513, 52.115, 8.4725]
  }),
  new RegioItFetcher({
    id: 'aldenhoven',
    name: 'Aldenhoven',
    shortName: 'ALD',
    serviceDomain: 'zew2',
    center: [6.2828, 50.8963],
    defaultZoom: 12,
    bbox: [50.8624, 6.1997, 50.94, 6.3354]
  }),
  new RegioItFetcher({
    id: 'alsdorf',
    name: 'Alsdorf',
    shortName: 'ALS',
    serviceDomain: 'zew2',
    center: [6.1621, 50.8772],
    defaultZoom: 12,
    bbox: [50.8418, 6.1216, 50.894, 6.2307]
  }),
  new RegioItFetcher({
    id: 'baesweiler',
    name: 'Baesweiler',
    shortName: 'BAE',
    serviceDomain: 'zew2',
    center: [6.1826, 50.9075],
    defaultZoom: 12,
    bbox: [50.8853, 6.1404, 50.9498, 6.2296]
  }),
  new RegioItFetcher({
    id: 'dueren',
    name: 'Düren',
    shortName: 'DÜR',
    serviceDomain: 'zew2',
    center: [6.4821, 50.8032],
    defaultZoom: 12,
    bbox: [50.741, 6.3856, 50.8576, 6.5384]
  }),
  new RegioItFetcher({
    id: 'heimbach',
    name: 'Heimbach',
    shortName: 'HEI',
    serviceDomain: 'zew2',
    center: [6.4766, 50.6344],
    defaultZoom: 12,
    bbox: [50.5974, 6.3814, 50.6642, 6.5776]
  }),
  new RegioItFetcher({
    id: 'herzogenrath',
    name: 'Herzogenrath',
    shortName: 'HER',
    serviceDomain: 'zew2',
    center: [6.0951, 50.8685],
    defaultZoom: 12,
    bbox: [50.8077, 6.0574, 50.9135, 6.1455]
  }),
  new RegioItFetcher({
    id: 'huertgenwald',
    name: 'Hürtgenwald',
    shortName: 'HÜR',
    serviceDomain: 'zew2',
    center: [6.3712, 50.7127],
    defaultZoom: 12,
    bbox: [50.6507, 6.2845, 50.7746, 6.4588]
  }),
  new RegioItFetcher({
    id: 'inden',
    name: 'Inden',
    shortName: 'IND',
    serviceDomain: 'zew2',
    center: [6.368, 50.863],
    defaultZoom: 12,
    bbox: [50.8333, 6.3154, 50.8963, 6.4336]
  }),
  new RegioItFetcher({
    id: 'juelich',
    name: 'Jülich',
    shortName: 'JÜL',
    serviceDomain: 'zew2',
    center: [6.3611, 50.9221],
    defaultZoom: 12,
    bbox: [50.8785, 6.2645, 50.9785, 6.4549]
  }),
  new RegioItFetcher({
    id: 'kreuzau',
    name: 'Kreuzau',
    shortName: 'KRE',
    serviceDomain: 'zew2',
    center: [6.4893, 50.7469],
    defaultZoom: 12,
    bbox: [50.6934, 6.4187, 50.7824, 6.5489]
  }),
  new RegioItFetcher({
    id: 'langerwehe',
    name: 'Langerwehe',
    shortName: 'LAN',
    serviceDomain: 'zew2',
    center: [6.3681, 50.802],
    defaultZoom: 12,
    bbox: [50.7565, 6.2985, 50.8355, 6.4183]
  }),
  new RegioItFetcher({
    id: 'linnich',
    name: 'Linnich',
    shortName: 'LIN',
    serviceDomain: 'zew2',
    center: [6.2676, 50.9806],
    defaultZoom: 12,
    bbox: [50.9345, 6.1936, 51.0249, 6.3622]
  }),
  new RegioItFetcher({
    id: 'merzenich',
    name: 'Merzenich',
    shortName: 'MER',
    serviceDomain: 'zew2',
    center: [6.5245, 50.8281],
    defaultZoom: 12,
    bbox: [50.8015, 6.5016, 50.893, 6.6141]
  }),
  new RegioItFetcher({
    id: 'monschau',
    name: 'Monschau',
    shortName: 'MON',
    serviceDomain: 'zew2',
    center: [6.2408, 50.5545],
    defaultZoom: 12,
    bbox: [50.4944, 6.1741, 50.6117, 6.3802]
  }),
  new RegioItFetcher({
    id: 'nideggen',
    name: 'Nideggen',
    shortName: 'NID',
    serviceDomain: 'zew2',
    center: [6.4826, 50.6914],
    defaultZoom: 12,
    bbox: [50.6357, 6.3721, 50.7126, 6.6014]
  }),
  new RegioItFetcher({
    id: 'niederzier',
    name: 'Niederzier',
    shortName: 'NIE',
    serviceDomain: 'zew2',
    center: [6.4667, 50.8833],
    defaultZoom: 12,
    bbox: [50.8411, 6.413, 50.9527, 6.5359]
  }),
  new RegioItFetcher({
    id: 'noervenich',
    name: 'Nörvenich',
    shortName: 'NÖR',
    serviceDomain: 'zew2',
    center: [6.641, 50.8064],
    defaultZoom: 12,
    bbox: [50.7655, 6.5208, 50.8382, 6.7184]
  }),
  new RegioItFetcher({
    id: 'roetgen',
    name: 'Roetgen',
    shortName: 'ROE',
    serviceDomain: 'zew2',
    center: [6.1968, 50.6472],
    defaultZoom: 12,
    bbox: [50.6238, 6.166, 50.7053, 6.2721]
  }),
  new RegioItFetcher({
    id: 'simmerath',
    name: 'Simmerath',
    shortName: 'SIM',
    serviceDomain: 'zew2',
    center: [6.3005, 50.6072],
    defaultZoom: 12,
    bbox: [50.5294, 6.2458, 50.6865, 6.4197]
  }),
  new RegioItFetcher({
    id: 'titz',
    name: 'Titz',
    shortName: 'TIT',
    serviceDomain: 'zew2',
    center: [6.427, 51.0075],
    defaultZoom: 12,
    bbox: [50.9345, 6.3372, 51.0457, 6.5003]
  }),
  new RegioItFetcher({
    id: 'vettweiss',
    name: 'Vettweiß',
    shortName: 'VET',
    serviceDomain: 'zew2',
    center: [6.5975, 50.7391],
    defaultZoom: 12,
    bbox: [50.6894, 6.5182, 50.788, 6.7027]
  }),
  new RegioItFetcher({
    id: 'wuerselen',
    name: 'Würselen',
    shortName: 'WÜR',
    serviceDomain: 'zew2',
    center: [6.1341, 50.8179],
    defaultZoom: 12,
    bbox: [50.8029, 6.0865, 50.8556, 6.21]
  }),
  new RegioItFetcher({
    id: 'appen',
    name: 'Appen',
    shortName: 'APP',
    serviceDomain: 'pi',
    center: [9.7399, 53.648],
    defaultZoom: 12,
    bbox: [53.6183, 9.6913, 53.6801, 9.7778]
  }),
  new RegioItFetcher({
    id: 'barmstedt',
    name: 'Barmstedt',
    shortName: 'BAR',
    serviceDomain: 'pi',
    center: [9.7704, 53.7889],
    defaultZoom: 12,
    bbox: [53.7696, 9.7324, 53.8259, 9.8313]
  }),
  new RegioItFetcher({
    id: 'bevern',
    name: 'Bevern',
    shortName: 'BEV',
    serviceDomain: 'pi',
    center: [9.7711, 53.7555],
    defaultZoom: 12,
    bbox: [53.7374, 9.7309, 53.7671, 9.7986]
  }),
  new RegioItFetcher({
    id: 'bilsen',
    name: 'Bilsen',
    shortName: 'BIL',
    serviceDomain: 'pi',
    center: [9.8783, 53.768],
    defaultZoom: 12,
    bbox: [53.7474, 9.8579, 53.7817, 9.9016]
  }),
  new RegioItFetcher({
    id: 'bokel',
    name: 'Bokel',
    shortName: 'BOK',
    serviceDomain: 'pi',
    center: [9.7941, 54.2158],
    defaultZoom: 12,
    bbox: [54.1996, 9.7338, 54.2467, 9.838]
  }),
  new RegioItFetcher({
    id: 'bokholt-hanredder',
    name: 'Bokholt-Hanredder',
    shortName: 'BH',
    serviceDomain: 'pi',
    center: [9.7186, 53.7845],
    defaultZoom: 12,
    bbox: [53.7659, 9.68, 53.7973, 9.7466]
  }),
  new RegioItFetcher({
    id: 'boenningstedt',
    name: 'Bönningstedt',
    shortName: 'BÖN',
    serviceDomain: 'pi',
    center: [9.9058, 53.6646],
    defaultZoom: 12,
    bbox: [53.652, 9.878, 53.6957, 9.9457]
  }),
  new RegioItFetcher({
    id: 'borstel-hohenraden',
    name: 'Borstel-Hohenraden',
    shortName: 'BH',
    serviceDomain: 'pi',
    center: [9.8167, 53.6833],
    defaultZoom: 12,
    bbox: [53.6751, 9.7932, 53.7438, 9.8578]
  }),
  new RegioItFetcher({
    id: 'brande-hoernerkirchen',
    name: 'Brande-Hörnerkirchen',
    shortName: 'BH',
    serviceDomain: 'pi',
    center: [9.7083, 53.8491],
    defaultZoom: 12,
    bbox: [53.8239, 9.6715, 53.8699, 9.7519]
  }),
  new RegioItFetcher({
    id: 'bullenkuhlen',
    name: 'Bullenkuhlen',
    shortName: 'BUL',
    serviceDomain: 'pi',
    center: [9.7482, 53.7659],
    defaultZoom: 12,
    bbox: [53.7569, 9.7244, 53.778, 9.7705]
  }),
  new RegioItFetcher({
    id: 'ellerbek',
    name: 'Ellerbek',
    shortName: 'ELL',
    serviceDomain: 'pi',
    center: [9.8935, 53.6469],
    defaultZoom: 12,
    bbox: [53.6346, 9.849, 53.6773, 9.9071]
  }),
  new RegioItFetcher({
    id: 'ellerhoop',
    name: 'Ellerhoop',
    shortName: 'ELL',
    serviceDomain: 'pi',
    center: [9.7774, 53.7294],
    defaultZoom: 12,
    bbox: [53.7066, 9.7415, 53.7459, 9.8196]
  }),
  new RegioItFetcher({
    id: 'gross-nordende',
    name: 'Groß Nordende',
    shortName: 'GN',
    serviceDomain: 'pi',
    center: [9.65, 53.7],
    defaultZoom: 12,
    bbox: [53.6889, 9.5974, 53.7102, 9.6587]
  }),
  new RegioItFetcher({
    id: 'gross-offenseth-aspern',
    name: 'Groß Offenseth-Aspern',
    shortName: 'GA',
    serviceDomain: 'pi',
    center: [9.7244, 53.8141],
    defaultZoom: 12,
    bbox: [53.7927, 9.6901, 53.8352, 9.7543]
  }),
  new RegioItFetcher({
    id: 'halstenbek',
    name: 'Halstenbek',
    shortName: 'HAL',
    serviceDomain: 'pi',
    center: [9.8369, 53.6284],
    defaultZoom: 12,
    bbox: [53.6093, 9.7988, 53.6473, 9.885]
  }),
  new RegioItFetcher({
    id: 'haselau',
    name: 'Haselau',
    shortName: 'HAS',
    serviceDomain: 'pi',
    center: [9.6223, 53.6605],
    defaultZoom: 12,
    bbox: [53.6299, 9.5208, 53.6773, 9.6413]
  }),
  new RegioItFetcher({
    id: 'haseldorf',
    name: 'Haseldorf',
    shortName: 'HAS',
    serviceDomain: 'pi',
    center: [9.5962, 53.6342],
    defaultZoom: 12,
    bbox: [53.61, 9.5615, 53.6559, 9.649]
  }),
  new RegioItFetcher({
    id: 'hasloh',
    name: 'Hasloh',
    shortName: 'HAS',
    serviceDomain: 'pi',
    center: [9.9169, 53.6933],
    defaultZoom: 12,
    bbox: [53.6775, 9.885, 53.7197, 9.9527]
  }),
  new RegioItFetcher({
    id: 'heede',
    name: 'Heede',
    shortName: 'HEE',
    serviceDomain: 'pi',
    center: [9.8145, 53.7953],
    defaultZoom: 12,
    bbox: [53.7595, 9.7664, 53.8304, 9.862]
  }),
  new RegioItFetcher({
    id: 'heidgraben',
    name: 'Heidgraben',
    shortName: 'HEI',
    serviceDomain: 'pi',
    center: [9.6848, 53.7059],
    defaultZoom: 12,
    bbox: [53.6954, 9.6518, 53.716, 9.7056]
  }),
  new RegioItFetcher({
    id: 'heist',
    name: 'Heist',
    shortName: 'HEI',
    serviceDomain: 'pi',
    center: [9.6665, 53.6528],
    defaultZoom: 12,
    bbox: [53.6319, 9.64, 53.6653, 9.7151]
  }),
  new RegioItFetcher({
    id: 'hemdingen',
    name: 'Hemdingen',
    shortName: 'HEM',
    serviceDomain: 'pi',
    center: [9.8381, 53.7625],
    defaultZoom: 12,
    bbox: [53.729, 9.7896, 53.7859, 9.8681]
  }),
  new RegioItFetcher({
    id: 'hetlingen',
    name: 'Hetlingen',
    shortName: 'HET',
    serviceDomain: 'pi',
    center: [9.6373, 53.6077],
    defaultZoom: 12,
    bbox: [53.5825, 9.5372, 53.6402, 9.6626]
  }),
  new RegioItFetcher({
    id: 'holm',
    name: 'Holm',
    shortName: 'HOL',
    serviceDomain: 'pi',
    center: [9.6729, 53.6201],
    defaultZoom: 12,
    bbox: [53.6064, 9.6487, 53.6414, 9.7559]
  }),
  new RegioItFetcher({
    id: 'klein-nordende',
    name: 'Klein Nordende',
    shortName: 'KN',
    serviceDomain: 'pi',
    center: [9.6567, 53.7242],
    defaultZoom: 12,
    bbox: [53.7095, 9.6268, 53.7398, 9.7161]
  }),
  new RegioItFetcher({
    id: 'klein-offenseth-sparrieshoop',
    name: 'Klein Offenseth-Sparrieshoop',
    shortName: 'KS',
    serviceDomain: 'pi',
    center: [9.6892, 53.8036],
    defaultZoom: 12,
    bbox: [53.7749, 9.6493, 53.8342, 9.7249]
  }),
  new RegioItFetcher({
    id: 'koelln-reisiek',
    name: 'Kölln-Reisiek',
    shortName: 'KR',
    serviceDomain: 'pi',
    center: [9.6921, 53.7575],
    defaultZoom: 12,
    bbox: [53.7439, 9.6795, 53.7714, 9.7408]
  }),
  new RegioItFetcher({
    id: 'kummerfeld',
    name: 'Kummerfeld',
    shortName: 'KUM',
    serviceDomain: 'pi',
    center: [9.791, 53.6916],
    defaultZoom: 12,
    bbox: [53.683, 9.767, 53.7238, 9.8065]
  }),
  new RegioItFetcher({
    id: 'langeln',
    name: 'Langeln',
    shortName: 'LAN',
    serviceDomain: 'pi',
    center: [9.8588, 53.8013],
    defaultZoom: 12,
    bbox: [53.7788, 9.8287, 53.8232, 9.8839]
  }),
  new RegioItFetcher({
    id: 'lutzhorn',
    name: 'Lutzhorn',
    shortName: 'LUT',
    serviceDomain: 'pi',
    center: [9.777, 53.8254],
    defaultZoom: 12,
    bbox: [53.8002, 9.7433, 53.8599, 9.8298]
  }),
  new RegioItFetcher({
    id: 'moorrege',
    name: 'Moorrege',
    shortName: 'MOO',
    serviceDomain: 'pi',
    center: [9.6707, 53.6671],
    defaultZoom: 12,
    bbox: [53.6524, 9.584, 53.6791, 9.7012]
  }),
  new RegioItFetcher({
    id: 'neuendeich',
    name: 'Neuendeich',
    shortName: 'NEU',
    serviceDomain: 'pi',
    center: [9.6035, 53.676],
    defaultZoom: 12,
    bbox: [53.6718, 9.5732, 53.7015, 9.6414]
  }),
  new RegioItFetcher({
    id: 'osterhorn',
    name: 'Osterhorn',
    shortName: 'OST',
    serviceDomain: 'pi',
    center: [9.7016, 53.8667],
    defaultZoom: 12,
    bbox: [53.8578, 9.6741, 53.8909, 9.7207]
  }),
  new RegioItFetcher({
    id: 'prisdorf',
    name: 'Prisdorf',
    shortName: 'PRI',
    serviceDomain: 'pi',
    center: [9.7607, 53.68],
    defaultZoom: 12,
    bbox: [53.6628, 9.745, 53.6969, 9.7797]
  }),
  new RegioItFetcher({
    id: 'quickborn',
    name: 'Quickborn',
    shortName: 'QUI',
    serviceDomain: 'pi',
    center: [9.2115, 54.0111],
    defaultZoom: 12,
    bbox: [53.9798, 9.16, 54.0184, 9.2251]
  }),
  new RegioItFetcher({
    id: 'raa-besenbek',
    name: 'Raa-Besenbek',
    shortName: 'RB',
    serviceDomain: 'pi',
    center: [9.6173, 53.7584],
    defaultZoom: 12,
    bbox: [53.722, 9.5643, 53.7709, 9.6373]
  }),
  new RegioItFetcher({
    id: 'rellingen',
    name: 'Rellingen',
    shortName: 'REL',
    serviceDomain: 'pi',
    center: [9.8299, 53.6512],
    defaultZoom: 12,
    bbox: [53.6219, 9.8086, 53.6749, 9.8969]
  }),
  new RegioItFetcher({
    id: 'schenefeld',
    name: 'Schenefeld',
    shortName: 'SCH',
    serviceDomain: 'pi',
    center: [9.4812, 54.046],
    defaultZoom: 12,
    bbox: [54.0324, 9.4242, 54.0695, 9.5003]
  }),
  new RegioItFetcher({
    id: 'seester',
    name: 'Seester',
    shortName: 'SEE',
    serviceDomain: 'pi',
    center: [9.5973, 53.7176],
    defaultZoom: 12,
    bbox: [53.6994, 9.5684, 53.7444, 9.6425]
  }),
  new RegioItFetcher({
    id: 'seestermuehe',
    name: 'Seestermühe',
    shortName: 'SEE',
    serviceDomain: 'pi',
    center: [9.5639, 53.7042],
    defaultZoom: 12,
    bbox: [53.6692, 9.486, 53.7179, 9.5869]
  }),
  new RegioItFetcher({
    id: 'seeth-ekholt',
    name: 'Seeth-Ekholt',
    shortName: 'SE',
    serviceDomain: 'pi',
    center: [9.7314, 53.7426],
    defaultZoom: 12,
    bbox: [53.7218, 9.71, 53.752, 9.7658]
  }),
  new RegioItFetcher({
    id: 'tangstedt',
    name: 'Tangstedt',
    shortName: 'TAN',
    serviceDomain: 'pi',
    center: [10.0945, 53.7395],
    defaultZoom: 12,
    bbox: [53.697, 10.0227, 53.77, 10.1705]
  }),
  new RegioItFetcher({
    id: 'tornesch',
    name: 'Tornesch',
    shortName: 'TOR',
    serviceDomain: 'pi',
    center: [9.7115, 53.6959],
    defaultZoom: 12,
    bbox: [53.6728, 9.6952, 53.7246, 9.7815]
  }),
  new RegioItFetcher({
    id: 'uetersen',
    name: 'Uetersen',
    shortName: 'UET',
    serviceDomain: 'pi',
    center: [9.6698, 53.6852],
    defaultZoom: 12,
    bbox: [53.6706, 9.6119, 53.7029, 9.707]
  }),
  new RegioItFetcher({
    id: 'wedel',
    name: 'Wedel',
    shortName: 'WED',
    serviceDomain: 'pi',
    center: [9.7039, 53.581],
    defaultZoom: 12,
    bbox: [53.5576, 9.6333, 53.6188, 9.7592]
  }),
  new RegioItFetcher({
    id: 'westerhorn',
    name: 'Westerhorn',
    shortName: 'WES',
    serviceDomain: 'pi',
    center: [9.6802, 53.8526],
    defaultZoom: 12,
    bbox: [53.848, 9.6457, 53.8893, 9.7012]
  })
];

export const MUELLMAX_FETCHERS: CityFetcher[] = muellmaxCities.map(
  (cfg) => new MuellmaxFetcher(cfg)
);

export const ABFALLPLUS_FETCHERS: CityFetcher[] = abfallPlusCities.map(
  (cfg) => new AbfallPlusFetcher(cfg)
);

export const JUMOMIND_FETCHERS: CityFetcher[] = jumoCities.map(
  (cfg) => (cfg.id === 'darmstadt' ? new DarmstadtFetcher() : new JumoMindFetcher(cfg))
);

export const FETCHERS: CityFetcher[] = [
  new KarlsruheFetcher(),
  new FreiburgFetcher(),
  new AachenFetcher(),
  new NuernbergFetcher(),
  new HeidelbergFetcher(),
  new KoelnFetcher(),
  new LeipzigFetcher(),
  ...REGIOIT_EXTRA_FETCHERS,
  ...MUELLMAX_FETCHERS,
  ...ABFALLPLUS_FETCHERS,
  ...JUMOMIND_FETCHERS
];

export const FETCHER_MAP = new Map<string, CityFetcher>(
  FETCHERS.map((f) => [f.id, f])
);

export function getCityFetcher(cityId: string): CityFetcher {
  const fetcher = FETCHER_MAP.get(cityId.toLowerCase());
  if (!fetcher) {
    const known = FETCHERS.map((f) => f.id).join(', ');
    throw new Error(`Unknown city "${cityId}". Known cities: ${known}`);
  }
  return fetcher;
}
