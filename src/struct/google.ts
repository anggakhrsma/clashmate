import { Util } from '../util/toolkit.js';

const GOOGLE_MAPS_API_BASE_URL = 'https://maps.googleapis.com/maps/api';

// Google Sheets disabled — auth/drive/sheet stubbed
const auth: any = null;
const drive: any = {
  permissions: { create: async () => {} },
  revisions: { update: async () => {} }
};
const sheet: any = {
  spreadsheets: {
    create: async () => ({ data: {} }),
    values: { batchUpdate: async () => {} },
    batchUpdate: async () => {}
  }
};

const publish = async (fileId: string) => {
  return Promise.all([
    drive.permissions.create({
      requestBody: {
        role: 'reader',
        type: 'anyone'
      },
      fileId
    }),
    drive.revisions.update({
      requestBody: {
        publishedOutsideDomain: true,
        publishAuto: true,
        published: true
      },
      revisionId: '1',
      fields: '*',
      fileId
    })
  ]);
};

export type SchemaRequest = any;

const allowedFormulas = ['=HYPERLINK(', '=IMAGE(', '=SUM('];

const getSheetValue = (value?: string | number | boolean | Date | null) => {
  if (typeof value === 'string' && allowedFormulas.some((formula) => value.startsWith(formula))) {
    return { formulaValue: value };
  }

  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return { numberValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (value instanceof Date) return { numberValue: Util.dateToSerialDate(value) };
  return {};
};

const getUserEnteredFormat = (value?: string | number | boolean | Date | null) => {
  if (value instanceof Date) return { numberFormat: { type: 'DATE_TIME' } };
  if (typeof value === 'string' && allowedFormulas.some((formula) => value.startsWith(formula))) {
    return { hyperlinkDisplayType: 'LINKED' };
  }

  if (typeof value === 'number' && value % 1 !== 0) {
    return {
      numberFormat: {
        type: 'NUMBER',
        pattern: '0.00'
      }
    };
  }

  return {};
};

export const createHyperlink = (url: string, text: string) => `=HYPERLINK("${url}","${text}")`;

const getConditionalFormatRequests = (sheets: CreateGoogleSheet[]) => {
  const gridStyleRequests: SchemaRequest[] = sheets
    .map((sheet, sheetId) => [
      {
        addConditionalFormatRule: {
          index: 0,
          rule: {
            ranges: [
              {
                sheetId,
                startRowIndex: 1,
                endRowIndex: sheet.rows.length + 1
              }
            ],
            booleanRule: {
              condition: {
                type: 'CUSTOM_FORMULA',
                values: [
                  {
                    userEnteredValue: '=MOD(ROW(),2)=0'
                  }
                ]
              },
              format: {
                backgroundColor: {
                  red: 1,
                  green: 1,
                  blue: 1
                }
              }
            }
          }
        }
      },
      {
        addConditionalFormatRule: {
          index: 1,
          rule: {
            ranges: [
              {
                sheetId,
                startRowIndex: 1,
                endRowIndex: sheet.rows.length + 1
              }
            ],
            booleanRule: {
              condition: {
                type: 'CUSTOM_FORMULA',
                values: [
                  {
                    userEnteredValue: '=MOD(ROW(),2)=1'
                  }
                ]
              },
              format: {
                backgroundColor: {
                  red: 0.9,
                  green: 0.9,
                  blue: 0.9
                }
              }
            }
          }
        }
      }
    ])
    .flat();

  return gridStyleRequests;
};

const getStyleRequests = (sheets: CreateGoogleSheet[]) => {
  const styleRequests: SchemaRequest[] = sheets
    .map(({ columns }, sheetId) =>
      columns
        .map((column, columnIndex) => [
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: 0,
                // endRowIndex: 0,
                startColumnIndex: columnIndex,
                endColumnIndex: columnIndex + 1
              },
              cell: {
                userEnteredFormat: {
                  horizontalAlignment: column.align
                }
              },
              fields: 'userEnteredFormat(horizontalAlignment)'
            }
          },
          {
            updateDimensionProperties: {
              range: {
                sheetId,
                startIndex: columnIndex,
                endIndex: columnIndex + 1,
                dimension: 'COLUMNS'
              },
              properties: {
                pixelSize: column.width
              },
              fields: 'pixelSize'
            }
          }
        ])
        .flat()
    )
    .flat();

  return styleRequests;
};

const createSheetRequest = async (title: string, sheets: CreateGoogleSheet[]) => {
  const { data } = await sheet.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: sheets.map((sheet, sheetId) => ({
        properties: {
          sheetId,
          index: sheetId,
          title: Util.escapeSheetName(sheet.title),
          gridProperties: {
            rowCount: Math.max(sheet.rows.length + 1, 25),
            columnCount: Math.max(sheet.columns.length, 15),
            frozenRowCount: sheet.rows.length ? 1 : 0
          }
        }
      }))
    },
    fields: 'spreadsheetId,spreadsheetUrl'
  });
  return data;
};

const createColumnRequest = (columns: CreateGoogleSheet['columns']) => {
  return {
    values: columns.map((column) => ({
      userEnteredValue: {
        stringValue: column.name
      },
      userEnteredFormat: {
        wrapStrategy: 'WRAP',
        textFormat: { bold: true },
        verticalAlignment: 'MIDDLE'
      },
      note: column.note
    }))
  };
};

export const updateGoogleSheet = async () => null;

export const createGoogleSheet = async () => ({ spreadsheetId: '', spreadsheetUrl: '' });

const getLocation = async (query: string) => {
  // Free geocoding via OpenStreetMap Nominatim — no API key needed
  const search = new URLSearchParams({
    q: query,
    format: 'json',
    limit: '1'
  }).toString();

  const results = await fetch(`https://nominatim.openstreetmap.org/search?${search}`, {
    headers: { 'User-Agent': 'ClashMate Discord Bot' }
  })
    .then((res) => res.json() as Promise<{ lat: string; lon: string; display_name: string }[]>)
    .catch(() => null);

  if (!results?.length) return null;
  return results[0];
};

const timezone = async (query: string) => {
  const location = await getLocation(query);
  if (!location) return null;

  const { lat, lon, display_name } = location;

  // Free timezone lookup via timeapi.io
  const tzResult = await fetch(
    `https://timeapi.io/api/timezone/coordinate?latitude=${lat}&longitude=${lon}`
  )
    .then(
      (res) =>
        res.json() as Promise<{
          timeZone: string;
          currentLocalTime: string;
          currentUtcOffset: { seconds: number };
        }>
    )
    .catch(() => null);

  if (!tzResult?.timeZone) return null;

  const offsetSeconds = tzResult.currentUtcOffset.seconds;

  return {
    location: { formatted_address: display_name },
    timezone: {
      timeZoneId: tzResult.timeZone,
      timeZoneName: tzResult.timeZone,
      rawOffset: String(offsetSeconds),
      dstOffset: '0'
    }
  };
};

export default {
  async location(query: string) {
    return getLocation(query);
  },

  async timezone(query: string) {
    return timezone(query);
  },

  sheet() {
    return sheet;
  },

  drive() {
    return drive;
  },

  async publish(fileId: string) {
    return publish(fileId);
  }
};

export interface CreateGoogleSheet {
  title: string;
  columns: { align: string; width: number; name: string; note?: string }[];
  rows: (string | number | Date | boolean | undefined | null)[][];
}
