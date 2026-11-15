// Deploy as a web app, execute as yourself, access: Anyone.
// The source spreadsheet stays private. Only the explicitly selected columns leave it.
const SPREADSHEET_ID = '19DyLdg7qiyiPNqQOQqkLfugrKo6Hx3qbI44fa8bFuvc';

function doGet(e) {
  const callback = e && e.parameter && e.parameter.callback;
  if (callback && !/^castMaster_[A-Za-z0-9_]{1,100}$/.test(callback)) {
    return ContentService.createTextOutput('{"error":"Invalid callback"}')
      .setMimeType(ContentService.MimeType.JSON);
  }
  let result;
  try {
    // Read A:F and H:K only. Never accept sheet/range/spreadsheet parameters.
    // Advanced Sheets service supports a genuinely read-only OAuth scope;
    // SpreadsheetApp.openById requires the broader read/write scope.
    const response = Sheets.Spreadsheets.Values.batchGet(SPREADSHEET_ID, {
      ranges: ["'アプリ用マスター'!A2:F", "'アプリ用マスター'!H2:K"],
      valueRenderOption: 'UNFORMATTED_VALUE'
    });
    if (!response.valueRanges || response.valueRanges.length !== 2) throw new Error('Master missing');
    const lureRows = response.valueRanges[0].values || [];
    const reelRows = response.valueRanges[1].values || [];
    const str = value => String(value == null ? '' : value).trim();
    const id = value => {
      const valueId = str(value);
      if (!valueId || valueId.startsWith('#')) throw new Error('Invalid ID');
      return valueId;
    };
    // The sheet already extracts owned lures; enforce the same rule defensively.
    const lures = lureRows.filter(row => str(row[4]) === 'あり')
      .map(row => {
        const weight = str(row[2]) === '' ? null : Number(row[2]);
        if (!str(row[1]) || str(row[1]).startsWith('#') || (weight !== null && (!Number.isFinite(weight) || weight < 0))) throw new Error('Invalid lure');
        return {id: id(row[0]), name: str(row[1]), weight, color: str(row[3]), state: str(row[4]), maker: str(row[5])};
      });
    const reels = reelRows.filter(row => row.some(value => str(value))).map(row => {
      const rate = Number(row[2]);
      if (!str(row[1]) || !Number.isFinite(rate) || rate < 1 || rate > 150 || !str(row[3])) throw new Error('Invalid reel');
      return {id: id(row[0]), name: str(row[1]), rate, basis: str(row[3])};
    });
    result = {version: 1, lures, reels};
  } catch (error) {
    // Do not disclose spreadsheet internals, stack traces or arbitrary cell data.
    result = {error: 'Master unavailable'};
  }
  const json = JSON.stringify(result).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return ContentService.createTextOutput(callback ? callback + '(' + json + ');' : json)
    .setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}
