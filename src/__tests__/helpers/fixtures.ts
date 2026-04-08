import path from 'path';

const DATA_ROOT = path.resolve(__dirname, '../../../test_data');

export const XML_DIR = path.join(DATA_ROOT, 'xml');
export const XLSX_DIR = path.join(DATA_ROOT, 'xlsx');

export const XML_FILES = {
  inKyThuatSo911: path.join(XML_DIR, '0310989626_1_C26TAA_911_31012026_congtytnhhinkythuatso.xml'),
  inKyThuatSo933: path.join(XML_DIR, '0310989626_1_C26TAA_933_31012026_congtytnhhinkythuatso.xml'),
  dauTuDuyPhu: path.join(XML_DIR, '0314499083_1_C26TDP_1_31012026_congtytnhhdautuduyphu.xml'),
  vanThinhPhuc: path.join(XML_DIR, '0317572493_1_C26TTP_00000056_31012026_congtytnhhvanthinhphuc.xml'),
  zionRestaurant: path.join(XML_DIR, '0318566277_1_C26MTT_1233_31012026_congtytnhhzionrestaurant.xml'),
} as const;

export const XLSX_FILES = {
  hoadonSold: path.join(XLSX_DIR, 'hoadon_sold_2026-03-22.xlsx'),
} as const;
