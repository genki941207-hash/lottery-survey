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
var API_VERSION = '2026-11-23 表單匯入版';   // 在瀏覽器打開 API 網址就會顯示，用來確認部署的是不是最新版
var SHEET_RESPONSES = 'responses';
var SHEET_CODEBOOK = 'codebook';
var SHEET_SUMMARY = 'summary';   // 作答時間摘要（自動更新）
var MAX_WTP = 1000000;          // 金額題上限（元），需與網站 js/questions.js 的 MAX_WTP 相同
var SHEET_TIMING = 'timing';     // 每題作答秒數（與 responses 分開放）
// timing 分頁的黃底：每一題各自和「所有人在這一題的中位數」比較，符合任一條件就標黃
//   ① 該題秒數 < 該題中位數 × TIMING_RATIO（該題累積滿 TIMING_MIN_SAMPLE 筆才套用）
//   ② 該題秒數 < TIMING_MIN_SEC（快到不可能看完選項）
var TIMING_RATIO = 0.3;
var TIMING_MIN_SEC = 1;
var TIMING_MIN_SAMPLE = 10;
var STATS_CACHE_SECONDS = 60;

// ---------- 作答過快標示（可自行調整） ----------
// 符合任一條件就在 speed_flag 欄標示，整列變成淡紅色：
//   ① 作答秒數 < 所有人作答秒數的「中位數」× SPEED_RATIO
//   ② 作答秒數 < SPEED_MIN_SEC（不管別人多快，這麼短幾乎不可能認真看完題目）
var SPEED_COLUMN = 'speed_flag';
var SPEED_RATIO = 0.5;        // 少於中位數的一半就標示
var SPEED_MIN_SEC = 30;       // 少於 30 秒一律標示
var SPEED_MIN_SAMPLE = 10;    // 累積滿 10 筆才開始和中位數比較（太少筆時中位數不準）

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
  { id: 'Q4', no: '4', type: 'choice', title: '甲彩券（中獎機率 1,000 萬分之一）和乙彩券（中獎機率 1 億分之一），對您的購買吸引力有多大差別？（兩張皆售價 100 元、頭獎 1 億元）',
    options: ['完全沒差別（覺得都很難中，購買意願一樣）', '幾乎沒差別', '有一點差別（較想買甲彩券，但也會考慮乙彩券）', '差別很大（乙彩券機率太低，我只會買甲彩券）', '兩張我都完全不想買'] },
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
    .addSeparator()
    .addItem('重新標示作答過快', 'updateSpeedFlagsMenu')
    .addSeparator()
    .addSeparator()
    .addItem('匯入表單版資料（放在最上面）', 'importFormData')
    .addItem('移除表單版資料', 'removeFormData')
    .addToUi();
}

// ---------- 初始化：建立工作表、欄位與編碼簿 ----------
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var sh = ss.getSheetByName(SHEET_RESPONSES) || ss.insertSheet(SHEET_RESPONSES);
  var header = META_COLUMNS.concat(QUESTIONS.map(function (q) { return q.id; }), [SPEED_COLUMN]);
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  sh.setFrozenRows(1);
  // 所有欄位設為純文字，避免 Sheets 自動把「5,000 元以下」等選項轉格式
  sh.getRange(1, 1, sh.getMaxRows(), header.length).setNumberFormat('@');
  ensureSpeedRule_(sh, header.indexOf(SPEED_COLUMN) + 1);
  timingSheet_();

  var cb = ss.getSheetByName(SHEET_CODEBOOK) || ss.insertSheet(SHEET_CODEBOOK);
  cb.clear();
  var rows = [['欄位', '題號', '類型', '題目', '選項（依序，以 | 分隔）']];
  META_COLUMNS.forEach(function (m) {
    var desc = {
      timestamp: '伺服器收到回覆的時間',
      client_id: '瀏覽器隨機產生的匿名 ID（同裝置重複填答時相同，可用來去重）',
      duration_sec: '從按下「開始作答」到送出的秒數（可用來排除亂填的超快作答）',
      source: '來源（web = 真實回覆，test = 測試資料）',
      version: '問卷版本'
    }[m];
    rows.push([m, '', 'meta', desc, '']);
  });
  rows.push(['（timing 分頁）timestamp + client_id', '', '對應鍵', '與 responses 分頁同一份回覆的 timestamp、client_id 完全相同，用這兩欄合併', '']);
  rows.push(['（timing 分頁）back_count', '', 'meta', '作答過程中按「上一題」的次數', '']);
  rows.push(['（timing 分頁）input_errors', '', 'meta', '金額題輸入被擋下的次數（格式錯誤或超過 ' + MAX_WTP + ' 元上限）；大於 0 可能代表不認真作答', '']);
  QUESTIONS.forEach(function (q) {
    rows.push(['（timing 分頁）T_' + q.id, q.no, '秒數', '停留在第 ' + q.no + ' 題的總秒數（回頭修改會累加）；空白 = 沒看到這題（選「不想買」後自動跳過的金額題）；低於該題中位數 × ' + TIMING_RATIO + ' 或低於 ' + TIMING_MIN_SEC + ' 秒時標黃', '']);
  });
  rows.push([SPEED_COLUMN, '', 'meta', '作答過快標示：秒數低於中位數 × ' + SPEED_RATIO + ' 或低於 ' + SPEED_MIN_SEC + ' 秒時填入說明，空白 = 正常', '']);
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
  return json_({ ok: true, message: 'Lottery survey API is running.', apiVersion: API_VERSION });
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
      if (body.timing) {
        try { timingSheet_().appendRow(timingRow_(body, row)); } catch (tErr) { /* 計時寫入失敗不影響送出 */ }
      }
      try { updateSpeedFlags_(); } catch (flagErr) { /* 標示失敗不影響送出 */ }
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
      if (v === '' || v === null || v === undefined || !isFinite(n) || n < 0) {
        throw new Error(q.no + ' 題請填入 0 以上的數字');
      }
      if (n > MAX_WTP) throw new Error(q.no + ' 題金額上限為 ' + MAX_WTP.toLocaleString() + ' 元');
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
  var rows = [], tRows = [];
  for (var n = 0; n < 50; n++) {
    var sim = simulate_();
    var row = validate_(sim);
    row[3] = 'test';
    rows.push(row);
    tRows.push(timingRow_(sim, row));
  }
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  var ts = timingSheet_();
  ts.getRange(ts.getLastRow() + 1, 1, tRows.length, tRows[0].length).setValues(tRows);
  CacheService.getScriptCache().remove('stats');
  updateSpeedFlags_();
  Logger.log('✅ 已寫入 50 筆測試資料（source = test）');
}

// 刪除 source = test 的列
function deleteTestData() {
  var sh = sheet_();
  var vals = sh.getDataRange().getValues();
  for (var i = vals.length - 1; i >= 1; i--) {
    if (vals[i][3] === 'test') sh.deleteRow(i + 1);
  }
  var ts = timingSheet_();
  var tv = ts.getDataRange().getValues();
  for (var j = tv.length - 1; j >= 1; j--) {
    if (tv[j][2] === 'test') ts.deleteRow(j + 1);
  }
  CacheService.getScriptCache().remove('stats');
  updateSpeedFlags_();
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
  var dur = r() < 0.1 ? Math.round(12 + r() * 20) : Math.round(90 + r() * 200);
  var timing = {};
  QUESTIONS.forEach(function (q, idx) {
    var prev = QUESTIONS[idx - 1];
    if (q.type === 'number' && prev && a[prev.id] === prev.options[prev.options.length - 1]) return; // 不想買 → 金額題被跳過
    var base = q.type === 'number' ? 6 : (['Q1_1', 'Q2_1', 'Q3_1', 'Q4'].indexOf(q.id) >= 0 ? 15 : 4);
    var sec = base * (0.5 + r()) * (dur < 35 ? 0.12 : 1);
    timing[q.id] = Math.round(sec * 10) / 10;
  });
  return { answers: a, clientId: 'test-' + n_(), durationSec: dur, version: 'test', timing: timing, backCount: r() < 0.2 ? 1 : 0, inputErrors: r() < 0.1 ? 1 : 0 };
}
function n_() { return Utilities.getUuid().slice(0, 8); }

// ---------- 作答過快標示 ----------
// 從選單執行：重新計算並顯示結果
function updateSpeedFlagsMenu() {
  var n = updateSpeedFlags_();
  SpreadsheetApp.getActiveSpreadsheet().toast('共標示 ' + n + ' 筆作答過快', '彩券問卷', 5);
}

// 重新計算所有列的 speed_flag（中位數會隨新回覆改變，所以每次全部重算）
function updateSpeedFlags_() {
  var sh = sheet_();
  var lastCol = sh.getLastColumn();
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0];

  var fCol = header.indexOf(SPEED_COLUMN) + 1;
  if (fCol === 0) {                       // 舊的工作表沒有這欄 → 自動補在最右邊
    fCol = lastCol + 1;
    sh.getRange(1, fCol).setValue(SPEED_COLUMN).setFontWeight('bold');
  }
  ensureSpeedRule_(sh, fCol);

  var lastRow = sh.getLastRow();
  if (lastRow < 2) {                       // 沒有任何回覆：summary 也要歸零，不能直接結束
    writeSpeedSummary_([], null, false, 0);
    return 0;
  }

  var dIdx = header.indexOf('duration_sec');
  var sIdx = header.indexOf('source');
  var data = sh.getRange(2, 1, lastRow - 1, Math.max(lastCol, fCol)).getValues();

  function durationOf(r) {
    var raw = String(r[dIdx]).trim();
    var d = Number(raw);
    return (raw !== '' && isFinite(d)) ? d : null;
  }
  // 真實回覆與測試資料都納入（測試資料正式上線前會刪掉）
  function counted(r) { return r[sIdx] === 'web' || r[sIdx] === 'test'; }

  var durs = [];
  data.forEach(function (r) {
    var d = durationOf(r);
    if (counted(r) && d !== null) durs.push(d);
  });
  var med = median_(durs);
  var useRatio = durs.length >= SPEED_MIN_SAMPLE && med !== null;

  var flagged = 0;
  var out = data.map(function (r) {
    var d = durationOf(r);
    if (!counted(r) || d === null) return [''];
    var tooFast = d < SPEED_MIN_SEC || (useRatio && d < med * SPEED_RATIO);
    if (!tooFast) return [''];
    flagged++;
    return ['⚠️ 過快：' + d + ' 秒' + (useRatio ? '（中位數 ' + Math.round(med) + ' 秒）' : '')];
  });

  sh.getRange(2, fCol, out.length, 1).setNumberFormat('@').setValues(out);
  writeSpeedSummary_(durs, med, useRatio, flagged);
  return flagged;
}

// summary 工作表：整體作答時間摘要（每次重新標示時一起更新）
function writeSpeedSummary_(durs, med, useRatio, flagged) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sm = ss.getSheetByName(SHEET_SUMMARY) || ss.insertSheet(SHEET_SUMMARY);
  var threshold = useRatio ? Math.max(SPEED_MIN_SEC, med * SPEED_RATIO) : SPEED_MIN_SEC;
  var normal = durs.filter(function (d) { return d >= threshold; });
  function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function fmt(sec) {
    if (sec === null || sec === undefined) return '—';
    var t = Math.round(sec);
    return Math.floor(t / 60) + ' 分 ' + ('0' + (t % 60)).slice(-2) + ' 秒（' + t + ' 秒）';
  }
  var rows = [
    ['項目', '數值', '說明'],
    ['納入計算的回覆數', durs.length, 'source 為 web 或 test、且有作答秒數的列'],
    ['作答時間中位數', fmt(med), '一半的人比這快、一半比這慢；用來判斷過快'],
    ['平均作答時間（全部）', fmt(avg(durs)), '會被少數拖很久的人拉高'],
    ['平均作答時間（排除過快）', fmt(avg(normal)), '比較能代表正常作答者'],
    ['最短 / 最長', durs.length ? fmt(Math.min.apply(null, durs)) + ' ／ ' + fmt(Math.max.apply(null, durs)) : '—', ''],
    ['目前的過快門檻', fmt(threshold), useRatio
      ? '中位數 × ' + SPEED_RATIO + '，且至少 ' + SPEED_MIN_SEC + ' 秒'
      : '回覆未滿 ' + SPEED_MIN_SAMPLE + ' 筆，暫時只用 ' + SPEED_MIN_SEC + ' 秒門檻'],
    ['被標示過快的筆數', flagged, durs.length ? Math.round(flagged / durs.length * 100) + '%' : ''],
    ['最後更新', Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss'), '有新回覆或執行「重新標示作答過快」時自動更新']
  ];
  sm.clear();
  sm.getRange(1, 1, rows.length, 3).setValues(rows);
  sm.getRange(1, 1, 1, 3).setFontWeight('bold');
  sm.setFrozenRows(1);
  sm.setColumnWidth(1, 200);   // 中文自動調整欄寬會被切掉，改成固定寬度
  sm.setColumnWidth(2, 300);
  sm.setColumnWidth(3, 420);

  // 各題作答秒數（來自 timing 分頁）
  var ts = ss.getSheetByName(SHEET_TIMING);
  if (!ts || ts.getLastRow() < 2) return;
  var th = ts.getRange(1, 1, 1, ts.getLastColumn()).getValues()[0];
  var tv = ts.getRange(2, 1, ts.getLastRow() - 1, th.length).getValues();
  var qRows = [['各題作答秒數', '中位數', '黃底門檻（低於此值標黃）', '有秒數的筆數']];
  QUESTIONS.forEach(function (q) {
    var idx = th.indexOf('T_' + q.id);
    if (idx < 0) return;
    var vals = [];
    tv.forEach(function (r) {
      var raw = r[idx], v = Number(raw);
      if (raw !== '' && raw !== null && isFinite(v)) vals.push(v);
    });
    var m = median_(vals);
    var cut = (vals.length >= TIMING_MIN_SAMPLE && m !== null) ? Math.max(TIMING_MIN_SEC, m * TIMING_RATIO) : TIMING_MIN_SEC;
    qRows.push([q.no + ' 題', m === null ? '—' : (Math.round(m * 10) / 10) + ' 秒',
                (Math.round(cut * 10) / 10) + ' 秒' + (vals.length < TIMING_MIN_SAMPLE ? '（未滿 ' + TIMING_MIN_SAMPLE + ' 筆，暫用固定門檻）' : ''),
                vals.length]);
  });
  var start = rows.length + 2;
  sm.getRange(start, 1, qRows.length, 4).setValues(qRows);
  sm.getRange(start, 1, 1, 4).setFontWeight('bold');
  sm.setColumnWidth(4, 140);
}

// 條件式格式：speed_flag 有內容的列整列變淡紅色（只建立一次，不會覆蓋你手動上的顏色）
function ensureSpeedRule_(sh, fCol) {
  var letter = columnLetter_(fCol);
  var formula = '=$' + letter + '2<>""';
  var rules = sh.getConditionalFormatRules();
  var exists = rules.some(function (rule) {
    var c = rule.getBooleanCondition();
    return c && c.getCriteriaType() === SpreadsheetApp.BooleanCriteria.CUSTOM_FORMULA &&
           c.getCriteriaValues()[0] === formula;
  });
  if (exists) return;
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(formula)
      .setBackground('#f8d7da')
      .setFontColor('#842029')
      .setRanges([sh.getRange('A2:' + letter)])
      .build()
  );
  sh.setConditionalFormatRules(rules);
}

function median_(arr) {
  if (!arr.length) return null;
  var a = arr.slice().sort(function (x, y) { return x - y; });
  var L = a.length;
  return L % 2 ? a[(L - 1) / 2] : (a[L / 2 - 1] + a[L / 2]) / 2;
}

function columnLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ---------- 每題作答秒數（timing 分頁） ----------
function timingHeader_() {
  // input_errors 放最後，舊的 timing 分頁會自動補上欄名，T_ 各欄位置不變
  return ['timestamp', 'client_id', 'source', 'back_count'].concat(QUESTIONS.map(function (q) { return 'T_' + q.id; }), ['input_errors']);
}

// 取得 timing 分頁；不存在就建立（含欄位、格式、過快標色）
function timingSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ts = ss.getSheetByName(SHEET_TIMING);
  if (ts) {
    var want = timingHeader_();
    var have = ts.getRange(1, 1, 1, want.length).getValues()[0];
    var mismatch = want.some(function (h, i) { return String(have[i]) !== h; });
    if (mismatch) {                                         // 欄名缺少或不同 → 只重寫前面這幾格欄名（右邊自己寫的備註不受影響）
      ts.getRange(1, 1, 1, want.length).setValues([want]).setFontWeight('bold');
    }
    ensureTimingRule_(ts);
    return ts;
  }

  ts = ss.insertSheet(SHEET_TIMING);
  var header = timingHeader_();
  ts.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  ts.setFrozenRows(1);
  ts.getRange('A2:C').setNumberFormat('@');                                   // 對應鍵維持文字
  ts.getRange('E2:' + columnLetter_(4 + QUESTIONS.length)).setNumberFormat('0.0');   // 秒數，小數一位

  ensureTimingRule_(ts);
  return ts;
}

// 黃底規則：每一欄（每一題）各自用自己那一欄的中位數比較。
// 公式寫的是左上角 E2 的版本，套用到 E2:P 時，Google 試算表會自動換成各欄自己的欄位。
// 每次呼叫都會檢查：門檻設定改過就自動換成新規則。
function timingRuleFormula_() {
  return '=AND(ISNUMBER(E2),OR(E2<' + TIMING_MIN_SEC +
         ',AND(COUNT(E$2:E)>=' + TIMING_MIN_SAMPLE + ',E2<MEDIAN(E$2:E)*' + TIMING_RATIO + ')))';
}

function ensureTimingRule_(ts) {
  var formula = timingRuleFormula_();
  var rules = ts.getConditionalFormatRules();
  function formulaOf(rule) {
    var c = rule.getBooleanCondition();
    return c && c.getCriteriaType() === SpreadsheetApp.BooleanCriteria.CUSTOM_FORMULA ? c.getCriteriaValues()[0] : '';
  }
  if (rules.some(function (r) { return formulaOf(r) === formula; })) return;      // 已是最新規則
  var others = rules.filter(function (r) { return formulaOf(r).indexOf('=AND(ISNUMBER(E2)') !== 0; }); // 只換掉本程式建立的規則
  var lastLetter = columnLetter_(4 + QUESTIONS.length);    // 只套用在 T_ 各題秒數欄
  others.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(formula)
      .setBackground('#fff3cd')
      .setFontColor('#664d03')
      .setRanges([ts.getRange('E2:' + lastLetter)])
      .build()
  );
  ts.setConditionalFormatRules(others);
}

// 一列 timing 資料：對應鍵沿用 responses 那一列的 timestamp、client_id、source
function timingRow_(body, responseRow) {
  var t = body.timing || {};
  return [responseRow[0], responseRow[1], responseRow[3], clampNum_(body.backCount, 0, 1000)]
    .concat(QUESTIONS.map(function (q) {
      var raw = t[q.id];
      var v = Number(raw);
      if (raw === undefined || raw === null || raw === '' || !isFinite(v) || v < 0) return '';
      return Math.min(Math.round(v * 10) / 10, 3600);
    }), [clampNum_(body.inputErrors, 0, 1000)]);
}


// ============================================================
// 匯入表單版資料（Google 表單的回覆試算表 → responses 分頁最上面）
// ============================================================
// 表單回覆試算表的 ID（網址 /d/ 與 /edit 之間那段）與分頁名稱
var FORM_SHEET_ID = '1I8eAMUgOSJcmG6YS8_h-MMCol0dBpYvONdomAVnNaYc';
var FORM_SHEET_TAB = '表單回覆 1';
var SHEET_IMPORT_LOG = 'import_log';

// 匯入時自動處理：
//   ・欄位依「位置」對應（表單第 2～13 欄 = Q1_1～Q9），並檢查欄名開頭題號，對不上就整批中止
//   ・時間統一成 yyyy-MM-dd HH:mm:ss
//   ・client_id 依序給 form-001、form-002…；source = form；version = form
//   ・選項文字逐字比對；只差全形半形或空白時自動校正成標準文字，完全對不上就略過該筆
//   ・選「不想買」卻填了金額 → 金額改為 0（與網站規則一致）
//   ・12 題答案完全相同的回覆 → 都保留，但在 import_log 標記「疑似重複」
//   ・重複匯入不會變兩份：會先移除舊的 form 資料再重新匯入
// 所有修正與略過都記在 import_log 分頁，原本的表單試算表完全不會被修改。
function importFormData() {
  var ui = SpreadsheetApp.getUi();
  var ans = ui.alert('匯入表單版資料',
    '會讀取表單回覆試算表的所有回覆，轉換格式後放在 responses 分頁最上面（source = form）。\n' +
    '如果之前匯入過，會先移除舊的表單資料再重新匯入。原本的表單試算表不會被修改。\n\n確定要匯入嗎？',
    ui.ButtonSet.YES_NO);
  if (ans !== ui.Button.YES) return;

  var result = importFormData_();
  ui.alert('匯入完成',
    '匯入 ' + result.imported + ' 筆、略過 ' + result.skipped + ' 筆、自動修正 ' + result.fixed + ' 處、疑似重複 ' + result.dups + ' 組。\n' +
    '詳細紀錄請看 import_log 分頁。', ui.ButtonSet.OK);
}

function importFormData_() {
  var src = SpreadsheetApp.openById(FORM_SHEET_ID);
  var fs = src.getSheetByName(FORM_SHEET_TAB) || src.getSheets()[0];
  var values = fs.getDataRange().getValues();
  if (values.length < 2) throw new Error('表單回覆試算表沒有資料');

  // ---- 欄位檢查：第 2～13 欄的欄名開頭必須是對應題號，避免錯位 ----
  var fh = values[0];
  QUESTIONS.forEach(function (q, i) {
    var h = String(fh[i + 1] || '').trim();
    if (h.indexOf(q.no + '.') !== 0) {
      throw new Error('表單第 ' + (i + 2) + ' 欄的欄名是「' + h + '」，預期以「' + q.no + '.」開頭。欄位順序對不上，已中止匯入。');
    }
  });

  var log = [];
  var rowsOut = [];
  var fixed = 0, skipped = 0;
  var seq = 0;

  values.slice(1).forEach(function (r, k) {
    if (r.every(function (c) { return c === '' || c === null; })) return;  // 空白列
    var srcRow = k + 2;
    var ts = formatFormTimestamp_(r[0]);
    if (!ts) { skipped++; log.push([srcRow, String(r[0]), '', '略過', '時間戳記無法辨識']); return; }

    var answers = {}, notes = [], bad = '';
    QUESTIONS.forEach(function (q, i) {
      if (bad) return;
      var raw = r[i + 1];
      if (q.type === 'choice') {
        var v = String(raw).trim();
        if (q.options.indexOf(v) >= 0) { answers[q.id] = v; return; }
        var hit = q.options.filter(function (o) { return normalizeText_(o) === normalizeText_(v); })[0];
        if (hit) { answers[q.id] = hit; notes.push(q.no + ' 選項文字校正'); fixed++; return; }
        bad = q.no + ' 選項「' + v + '」對不上任何標準選項';
      } else {
        var n = Number(String(raw).replace(/[,，\s元]/g, ''));
        if (String(raw).trim() === '' || !isFinite(n) || n < 0) { bad = q.no + ' 金額「' + raw + '」不是 0 以上的數字'; return; }
        if (n > MAX_WTP) { bad = q.no + ' 金額 ' + n + ' 超過上限 ' + MAX_WTP; return; }
        answers[q.id] = n;
      }
    });
    if (bad) { skipped++; log.push([srcRow, ts, '', '略過', bad]); return; }

    // 選「不想買」卻填了金額 → 金額改 0（網站版選不想買會自動記 0）
    QUESTIONS.forEach(function (q, i) {
      var next = QUESTIONS[i + 1];
      if (q.type === 'choice' && next && next.type === 'number') {
        if (String(answers[q.id]).indexOf('不想買') >= 0 && answers[next.id] > 0) {
          notes.push(next.no + ' 選不想買卻填 ' + answers[next.id] + '，改為 0');
          answers[next.id] = 0;
          fixed++;
        }
      }
    });

    seq++;
    var cid = 'form-' + ('00' + seq).slice(-3);
    rowsOut.push({ ts: ts, cid: cid, answers: answers });
    log.push([srcRow, ts, cid, notes.length ? '匯入（已修正）' : '匯入', notes.join('；')]);
  });

  // ---- 疑似重複：12 題答案完全相同 ----
  var groups = {};
  rowsOut.forEach(function (o) {
    var key = QUESTIONS.map(function (q) { return String(o.answers[q.id]); }).join('|');
    (groups[key] = groups[key] || []).push(o.cid);
  });
  var dups = 0;
  Object.keys(groups).forEach(function (key) {
    var ids = groups[key];
    if (ids.length < 2) return;
    dups++;
    log.forEach(function (l) {
      if (ids.indexOf(l[2]) >= 0) l[4] = (l[4] ? l[4] + '；' : '') + '疑似重複（12 題答案與 ' + ids.filter(function (x) { return x !== l[2]; }).join('、') + ' 完全相同）';
    });
  });

  // ---- 寫入 responses：先移除舊的 form 資料，再插入到最上面 ----
  var sh = sheet_();
  removeFormRows_(sh);
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var out = rowsOut.map(function (o) {
    return header.map(function (h) {
      if (h === 'timestamp') return o.ts;
      if (h === 'client_id') return o.cid;
      if (h === 'source') return 'form';
      if (h === 'version') return 'form';
      if (o.answers.hasOwnProperty(h)) return String(o.answers[h]);
      return '';                                   // duration_sec、speed_flag 等表單沒有的欄位留空
    });
  });
  if (out.length) {
    sh.insertRowsBefore(2, out.length);
    var rng = sh.getRange(2, 1, out.length, header.length);
    rng.setNumberFormat('@').setFontWeight('normal');   // 新插入的列不要沿用標題列的粗體
    rng.setValues(out);
  }

  // ---- 匯入紀錄 ----
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lg = ss.getSheetByName(SHEET_IMPORT_LOG) || ss.insertSheet(SHEET_IMPORT_LOG);
  lg.clear();
  var head = [['表單試算表列號', '時間', '指派的 client_id', '動作', '說明']];
  var summaryRow = [['', Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss'), '', '匯入摘要',
    '匯入 ' + out.length + ' 筆、略過 ' + skipped + ' 筆、自動修正 ' + fixed + ' 處、疑似重複 ' + dups + ' 組']];
  var all = head.concat(summaryRow, log);
  lg.getRange(1, 1, all.length, 5).setValues(all);
  lg.getRange(1, 1, 1, 5).setFontWeight('bold');
  lg.setFrozenRows(1);

  CacheService.getScriptCache().remove('stats');
  updateSpeedFlags_();
  return { imported: out.length, skipped: skipped, fixed: fixed, dups: dups };
}

// 撤銷：移除 responses 分頁中所有 source = form 的列
function removeFormData() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('移除表單版資料', '會刪除 responses 分頁中所有 source = form 的列（網站資料不受影響）。確定嗎？', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var n = removeFormRows_(sheet_());
  CacheService.getScriptCache().remove('stats');
  updateSpeedFlags_();
  ui.alert('已移除 ' + n + ' 筆表單版資料。');
}

function removeFormRows_(sh) {
  var vals = sh.getDataRange().getValues();
  var sIdx = vals[0].indexOf('source');
  var n = 0;
  for (var i = vals.length - 1; i >= 1; i--) {
    if (vals[i][sIdx] === 'form') { sh.deleteRow(i + 1); n++; }
  }
  return n;
}

// 表單的時間戳記：通常是日期物件；若是文字（例如「2026/11/17 下午 9:58:59」）也能轉換
function formatFormTimestamp_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  }
  var m = String(v).trim().match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})\s*(上午|下午)?\s*(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return '';
  var h = Number(m[5]);
  if (m[4] === '下午' && h < 12) h += 12;
  if (m[4] === '上午' && h === 12) h = 0;
  function p(x) { return ('0' + x).slice(-2); }
  return m[1] + '-' + p(m[2]) + '-' + p(m[3]) + ' ' + p(h) + ':' + m[6] + ':' + m[7];
}

// 比對選項時忽略全形半形與空白差異
function normalizeText_(s) {
  return String(s).normalize('NFKC').replace(/\s+/g, '');
}
