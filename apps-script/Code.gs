/**
 * 彩券購買決策調查 — 後端 API（Google 試算表當資料庫）
 *
 * 放在「試算表綁定」的 Apps Script 專案（試算表 → 擴充功能 → Apps Script）。
 * 第一次使用：執行 setup() 建立工作表與欄位，再部署成網頁應用程式。
 *
 *   POST  {API_URL}                 送出一份回覆（JSON 字串放在 body）
 *   GET   {API_URL}?action=stats    取得匯總統計（不含任何個別回覆）
 */

// ---------- 設定 ----------
var SHEET_RESPONSES = 'responses';
var SHEET_CODEBOOK = 'codebook';
var STATS_CACHE_SECONDS = 60;

// ---------- 題目（選項文字與原表單完全一致，不可更動） ----------
var QUESTIONS = [
  { id: 'Q1_1', no: '1-1', type: 'choice', title: '如果只能選一種，您會想買哪一張？（方案一：頭獎 1,000 萬、機率 10 萬分之一；方案二：頭獎 1 億、機率 200 萬分之一）',
    options: ['方案一（頭獎 1,000 萬，機率 10 萬分之一）', '方案二（頭獎 1 億，機率 200 萬分之一）', '兩種都不想買'] },
  { id: 'Q1_2', no: '1-2', type: 'number', title: '承上題，這張彩券您最多願意花多少錢購買？（若都不想買請填 0）' },
  { id: 'Q2_1', no: '2-1', type: 'choice', title: '您比較想買哪一種？（兩者長期返還比例相同；方案一：頭獎 5,000 萬、機率 100 萬分之一；方案二：頭獎 50 萬、機率 1 萬分之一）',
    options: ['方案一（頭獎 5,000 萬，機率 100 萬分之一）', '方案二（頭獎 50 萬，機率 1 萬分之一）', '兩種都不想買'] },
  { id: 'Q2_2', no: '2-2', type: 'number', title: '承上題，您最多願意花多少錢購買您選的那一種？（若都不想買請填 0）' },
  { id: 'Q3_1', no: '3-1', type: 'choice', title: '哪一期會讓您更想去買？（平分制；第一期：頭獎 2 億、2,000 萬張下注；第二期：頭獎 8,000 萬、100 萬張下注）',
    options: ['第一期（頭獎 2 億，全國 2,000 萬張下注）', '第二期（頭獎 8,000 萬，全國僅 100 萬張下注）', '兩期對我的吸引力差不多', '兩期都不想買'] },
  { id: 'Q3_2', no: '3-2', type: 'number', title: '在您較偏好的那一期中，您最多願意花多少錢購買？（若都不想買請填 0）' },
  { id: 'Q4', no: '4', type: 'choice', title: '請問這兩張彩券對您的購買吸引力有多大差別？（頭獎皆 1 億；甲：1,000 萬分之一；乙：1 億分之一）',
    options: ['完全沒差別（覺得都很難中，購買意願一樣）', '幾乎沒差別', '有一點差別，但還是會考慮買乙彩券', '差別很大（乙彩券機率太低，我只會買甲彩券）', '兩張我都完全不想買'] },
  { id: 'Q5', no: '5', type: 'choice', title: '假設您參加抽獎活動，主持人給您兩個領獎選項，您會選哪一個？',
    options: ['確定直接拿 1,000 元', '50% 機率拿 2,500 元，50% 機率拿 0 元'] },
  { id: 'Q6', no: '6', type: 'choice', title: '您平常購買公益彩券（大樂透、威力彩、刮刮樂等）的頻率為何？',
    options: ['從來不買', '偶爾才買（如過年、或看到頭獎累積很高時）', '每月至少買 1～3 次', '每週都會買'] },
  { id: 'Q7', no: '7', type: 'choice', title: '您的性別：',
    options: ['男性', '女性', '其他 ／ 不願透露'] },
  { id: 'Q8', no: '8', type: 'choice', title: '您目前每月可自由支配的金額（扣除房租、水電、三餐等必要生活開銷後）：',
    options: ['5,000 元以下', '5,001 ～ 15,000 元', '15,001 ～ 30,000 元', '30,001 元以上'] },
  { id: 'Q9', no: '9', type: 'choice', title: '您是否曾修習過「機率、統計、財務或經濟學」相關課程？',
    options: ['完全沒有', '有修過基礎課程', '非常熟悉（相關科系或工作經常使用）'] }
];

// 中繼資料欄位（不是問卷題目，用於資料清理）
var META_COLUMNS = ['timestamp', 'client_id', 'duration_sec', 'source', 'version'];

// 願付價格分組（統計圖表用）
var WTP_BINS = [
  { label: '1–49 元', min: 0.0001, max: 49.9999 },
  { label: '50–99 元', min: 50, max: 99.9999 },
  { label: '100 元', min: 100, max: 100 },
  { label: '101–199 元', min: 100.0001, max: 199.9999 },
  { label: '200–499 元', min: 200, max: 499.9999 },
  { label: '500 元以上', min: 500, max: Infinity }
];

// ---------- 試算表上方的自訂選單（不用進 Apps Script 編輯器也能操作） ----------
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🎰 彩券問卷')
    .addItem('① 初始化工作表', 'setup')
    .addSeparator()
    .addItem('寫入 50 筆測試資料', 'seedTestData')
    .addItem('刪除測試資料', 'deleteTestData')
    .addToUi();
}

// ---------- 初始化：建立工作表、欄位與編碼簿 ----------
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var sh = ss.getSheetByName(SHEET_RESPONSES) || ss.insertSheet(SHEET_RESPONSES);
  var header = META_COLUMNS.concat(QUESTIONS.map(function (q) { return q.id; }));
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  sh.setFrozenRows(1);
  // 所有欄位設為純文字，避免 Sheets 自動把「5,000 元以下」等選項轉格式
  sh.getRange(1, 1, sh.getMaxRows(), header.length).setNumberFormat('@');

  var cb = ss.getSheetByName(SHEET_CODEBOOK) || ss.insertSheet(SHEET_CODEBOOK);
  cb.clear();
  var rows = [['欄位', '題號', '類型', '題目', '選項（依序，以 | 分隔）']];
  META_COLUMNS.forEach(function (m) {
    var desc = {
      timestamp: '伺服器收到回覆的時間',
      client_id: '瀏覽器隨機產生的匿名 ID（同裝置重複填答時相同，可用來去重）',
      duration_sec: '從按下「開始作答」到送出的秒數（可用來排除亂填的超快作答）',
      source: '來源（web）',
      version: '問卷版本'
    }[m];
    rows.push([m, '', 'meta', desc, '']);
  });
  QUESTIONS.forEach(function (q) {
    rows.push([q.id, q.no, q.type === 'choice' ? '單選' : '數字（元）', q.title, q.options ? q.options.join(' | ') : '']);
  });
  cb.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  cb.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
  cb.setFrozenRows(1);

  Logger.log('✅ 已建立工作表：' + SHEET_RESPONSES + '、' + SHEET_CODEBOOK);
}

// ---------- API ----------
function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'stats') return json_({ ok: true, stats: getStats_() });
  return json_({ ok: true, message: 'Lottery survey API is running.' });
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    // 機器人陷阱：真人看不到這個欄位，若被填了就假裝成功但不寫入
    if (body.website) return json_({ ok: true, stats: getStats_() });

    var row = validate_(body);

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      sheet_().appendRow(row);
    } finally {
      lock.releaseLock();
    }

    CacheService.getScriptCache().remove('stats');
    return json_({ ok: true, stats: getStats_() });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

// ---------- 驗證 ----------
function validate_(body) {
  var a = body.answers || {};
  var row = [
    Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss'),
    String(body.clientId || '').slice(0, 64),
    clampNum_(body.durationSec, 0, 86400),
    'web',
    String(body.version || '').slice(0, 20)
  ];

  QUESTIONS.forEach(function (q) {
    var v = a[q.id];
    if (q.type === 'choice') {
      if (q.options.indexOf(v) < 0) throw new Error(q.no + ' 題答案無效');
      row.push(v);
    } else {
      var n = Number(v);
      if (v === '' || v === null || v === undefined || !isFinite(n) || n < 0 || n > 1e9) {
        throw new Error(q.no + ' 題請填入 0 以上的數字');
      }
      row.push(String(n));
    }
  });
  return row;
}

function clampNum_(v, lo, hi) {
  var n = Number(v);
  if (!isFinite(n)) return '';
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

// ---------- 統計 ----------
function getStats_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('stats');
  if (hit) return JSON.parse(hit);

  var sh = sheet_();
  var lastRow = sh.getLastRow();
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var data = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, header.length).getValues() : [];

  var col = {};
  header.forEach(function (h, i) { col[h] = i; });

  var counts = {}, wtp = {};
  QUESTIONS.forEach(function (q) {
    if (q.type === 'choice') {
      counts[q.id] = q.options.map(function () { return 0; });
    } else {
      wtp[q.id] = { values: [], zero: 0 };
    }
  });

  data.forEach(function (r) {
    QUESTIONS.forEach(function (q) {
      var v = r[col[q.id]];
      if (q.type === 'choice') {
        var k = q.options.indexOf(String(v));
        if (k >= 0) counts[q.id][k]++;
      } else {
        var n = Number(v);
        if (!isFinite(n) || String(v) === '') return;
        if (n === 0) wtp[q.id].zero++;
        else wtp[q.id].values.push(n);
      }
    });
  });

  var wtpOut = {};
  Object.keys(wtp).forEach(function (id) {
    var a = wtp[id].values.sort(function (x, y) { return x - y; });
    var L = a.length;
    wtpOut[id] = {
      median: L ? (L % 2 ? a[(L - 1) / 2] : (a[L / 2 - 1] + a[L / 2]) / 2) : null,
      zero: wtp[id].zero,
      bins: WTP_BINS.map(function (b) {
        return { label: b.label, count: a.filter(function (x) { return x >= b.min && x <= b.max; }).length };
      })
    };
  });

  var stats = { total: data.length, counts: counts, wtp: wtpOut, updatedAt: new Date().toISOString() };
  cache.put('stats', JSON.stringify(stats), STATS_CACHE_SECONDS);
  return stats;
}

// ---------- 工具 ----------
function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_RESPONSES);
  if (!sh) {            // 還沒初始化就自動初始化，不一定要手動執行 setup()
    setup();
    sh = ss.getSheetByName(SHEET_RESPONSES);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- 測試用：寫入 50 筆模擬資料 ----------
function seedTestData() {
  var sh = sheet_();
  var rows = [];
  for (var n = 0; n < 50; n++) rows.push(validate_(simulate_()));
  rows.forEach(function (r) { r[3] = 'test'; });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  CacheService.getScriptCache().remove('stats');
  Logger.log('✅ 已寫入 50 筆測試資料（source = test）');
}

// 刪除 source = test 的列
function deleteTestData() {
  var sh = sheet_();
  var vals = sh.getDataRange().getValues();
  for (var i = vals.length - 1; i >= 1; i--) {
    if (vals[i][3] === 'test') sh.deleteRow(i + 1);
  }
  CacheService.getScriptCache().remove('stats');
  Logger.log('🧹 已刪除測試資料');
}

function simulate_() {
  function r() { return Math.random(); }
  function w(arr, ws) {
    var t = ws.reduce(function (a, b) { return a + Math.max(b, 0.01); }, 0), x = r() * t;
    for (var i = 0; i < arr.length; i++) { x -= Math.max(ws[i], 0.01); if (x <= 0) return arr[i]; }
    return arr[arr.length - 1];
  }
  function price(risk) {
    var lv = [10, 20, 30, 50, 80, 100, 120, 150, 200, 300, 500], c = 2 + risk * 7;
    return w(lv, lv.map(function (_, i) { return Math.exp(-Math.pow(i - c, 2) / 4); }));
  }
  var O = {}; QUESTIONS.forEach(function (q) { O[q.id] = q.options; });
  var risk = r(), st = w([0, 1, 2], [0.25, 0.5, 0.25]), a = {};
  a.Q6 = w(O.Q6, [1.5 - risk * 1.3, 1.2, 0.2 + risk * 0.8, 0.05 + risk * 0.4]);
  var pNo = Math.max(0.02, Math.min(0.8, (a.Q6 === O.Q6[0] ? 0.45 : 0.1) + (0.5 - risk) * 0.4));
  if (r() < pNo) { a.Q1_1 = O.Q1_1[2]; a.Q1_2 = 0; } else { a.Q1_1 = r() < 0.2 + risk * 0.6 - st * 0.08 ? O.Q1_1[1] : O.Q1_1[0]; a.Q1_2 = price(risk); }
  if (r() < pNo) { a.Q2_1 = O.Q2_1[2]; a.Q2_2 = 0; } else { a.Q2_1 = r() < 0.15 + risk * 0.7 ? O.Q2_1[0] : O.Q2_1[1]; a.Q2_2 = price(risk); }
  if (r() < pNo) { a.Q3_1 = O.Q3_1[3]; a.Q3_2 = 0; } else { a.Q3_1 = w(O.Q3_1.slice(0, 3), [0.3 + risk * 0.6 - st * 0.15, 0.3 + st * 0.35, 0.3]); a.Q3_2 = price(risk); }
  a.Q4 = r() < pNo * 0.8 ? O.Q4[4] : w(O.Q4.slice(0, 4), [0.4 + risk * 0.4 - st * 0.15, 0.5, 0.4 + st * 0.1, 0.2 + st * 0.4]);
  a.Q5 = r() < 0.15 + risk * 0.6 ? O.Q5[1] : O.Q5[0];
  a.Q7 = w(O.Q7, [0.55, 0.42, 0.03]);
  a.Q8 = w(O.Q8, [0.45, 0.35, 0.13, 0.07]);
  a.Q9 = O.Q9[st];
  return { answers: a, clientId: 'test-' + n_(), durationSec: Math.round(90 + r() * 200), version: 'test' };
}
function n_() { return Utilities.getUuid().slice(0, 8); }
