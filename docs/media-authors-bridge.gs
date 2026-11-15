// Bound to the working Google copy. Deploy as a web app executing as the owner.
// The only writable resource is this explicit spreadsheet, and only membership D / size B.
const WORKBOOK_ID = '14pPkKu5bawgFWmbg5mbongAyCr4n0z-2LAUsfOtxiAk';
const AUTH_URL = 'https://wlqwwhshqrqanapsnsik.supabase.co';

function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function key_(value) { return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); }
function heading_(value) {
  const text = String(value || '').trim(), m = text.match(/^(11[89]|12\d)\s*округ/i);
  return m ? m[1] : /^штаб(?:\s|$)/i.test(text) ? 'hq' : '';
}
function csv_(sheet) {
  const rows = sheet.getDataRange().getValues();
  return rows.filter(row => row.some(cell => cell !== '')).map(row => row.map(cell => {
    const value = cell instanceof Date ? Utilities.formatDate(cell, 'Europe/Moscow', 'yyyy-MM-dd') : String(cell);
    return '"' + value.replace(/"/g, '""') + '"';
  }).join(',')).join('\r\n');
}
// The website already publishes these source statistics through media-pd.
// This endpoint exposes the same three sheets, without giving edit access to the workbook.
function doGet() {
  try {
    const book = SpreadsheetApp.openById(WORKBOOK_ID);
    return json_({ authors: csv_(book.getSheetByName('Авторы')), archive: csv_(book.getSheetByName('10 сезон')), season: csv_(book.getSheetByName('11 сезон')) });
  } catch (e) { return json_({ error: 'Не удалось прочитать рабочую таблицу.' }); }
}
function profile_(token, apiKey) {
  if (typeof token !== 'string' || token.length < 30 || token.length > 8000 || typeof apiKey !== 'string' || apiKey.length > 1000) throw new Error('Войдите на сайт снова.');
  const options = { headers: { Authorization: 'Bearer ' + token, apikey: apiKey }, muteHttpExceptions: true };
  const auth = UrlFetchApp.fetch(AUTH_URL + '/auth/v1/user', options);
  if (auth.getResponseCode() !== 200) throw new Error('Войдите на сайт снова.');
  const uid = JSON.parse(auth.getContentText()).id;
  if (!/^[a-f0-9-]{36}$/i.test(uid || '')) throw new Error('Войдите на сайт снова.');
  const response = UrlFetchApp.fetch(AUTH_URL + '/rest/v1/profiles?id=eq.' + uid + '&select=data', options);
  if (response.getResponseCode() !== 200) throw new Error('Нет доступа к составу округа.');
  const rows = JSON.parse(response.getContentText()), p = rows[0] && rows[0].data;
  if (!p || p.active === false || p.pending || !['head', 'staff', 'coordinator'].includes(p.role)) throw new Error('Добавлять авторов могут координаторы и штаб.');
  return p;
}
function doPost(e) {
  let lock;
  try {
    if (!e || !e.postData || e.postData.contents.length > 18000) throw new Error('Некорректный запрос.');
    const body = JSON.parse(e.postData.contents), p = profile_(body.token, body.apiKey);
    const group = String(body.groupId || ''), name = String(body.name || '').replace(/\s+/g, ' ').trim();
    if (!/^(11[89]|12\d|hq)$/.test(group) || (p.role === 'coordinator' && p.districtId !== group)) throw new Error('Можно добавлять авторов только в свой округ.');
    if (name.length < 4 || name.length > 120 || !/^[А-ЯЁа-яёA-Za-z][А-ЯЁа-яёA-Za-z ’'\-]+$/.test(name) || name.split(' ').length < 2) throw new Error('Укажите фамилию и имя автора.');
    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) throw new Error('Список сейчас обновляется. Повторите попытку.');
    const sheet = SpreadsheetApp.openById(WORKBOOK_ID).getSheetByName('Авторы');
    const rows = sheet.getDataRange().getValues();
    const start = rows.findIndex(row => heading_(row[0]) === group);
    if (start < 0) throw new Error('Блок округа не найден в таблице.');
    let end = start + 1;
    while (end < rows.length && !String(rows[end][0] || '').trim()) end++;
    const members = rows.slice(start, end).filter(row => String(row[3] || '').trim());
    if (members.some(row => key_(row[3]) === key_(name))) return json_({ ok: true, exists: true, name, groupId: group });
    let destination = -1;
    for (let i = start + 1; i < end; i++) if (rows[i].every(cell => cell === '')) { destination = i; break; }
    if (destination < 0) {
      // Insert inside this block; following districts and their formatting move together.
      sheet.insertRowBefore(end + 1); destination = end;
    }
    sheet.getRange(destination + 1, 4).setValue(name);
    sheet.getRange(start + 1, 2).setValue(members.length + 1);
    SpreadsheetApp.flush();
    return json_({ ok: true, exists: false, name, groupId: group });
  } catch (e) { return json_({ error: e instanceof Error ? e.message : 'Не удалось добавить автора.' }); }
  finally { if (lock) lock.releaseLock(); }
}
