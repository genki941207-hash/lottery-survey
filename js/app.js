(function () {
  'use strict';

  var Q = window.QUESTIONS;
  var C = window.CONFIG;
  var DEMO = !C.API_URL;
  // 正確格式：https://script.google.com/macros/s/xxxxx/exec
  var API_BAD = !DEMO && !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(C.API_URL.trim());
  var API_BAD_MSG = 'API_URL 格式不對：請到 Apps Script「部署 → 管理部署作業」複製「網頁應用程式」網址（https://script.google.com/macros/s/…/exec），不要用瀏覽器轉址後的 googleusercontent 網址。';
  var byId = {};
  Q.forEach(function (q, i) { byId[q.id] = q; q.index = i; });

  var STORE_KEY = 'lottery_survey_web_v1';
  var CLIENT_KEY = 'lottery_client_id';

  var state = {
    view: 'home', i: 0, answers: {}, autoZero: {}, history: [],
    stats: null, error: '', startedAt: null, record: loadRecord()
  };
  var app = document.getElementById('app');

  // ===================== 工具 =====================
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { return Number(n).toLocaleString('zh-TW'); }
  function opt(id, k) { return byId[id].options[k]; }
  function $(id) { return document.getElementById(id); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function loadRecord() { try { return JSON.parse(storageGet(STORE_KEY) || 'null'); } catch (e) { return null; } }

  function clientId() {
    var id = storageGet(CLIENT_KEY);
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'c-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      storageSet(CLIENT_KEY, id);
    }
    return id;
  }

  function shareUrl() { return location.origin + '/'; }

  // ===================== API =====================
  function fetchStats() {
    if (DEMO) return Promise.resolve(demoStats());
    return fetch(C.API_URL + '?action=stats')
      .then(function (r) { return r.json(); })
      .then(function (d) { if (!d.ok) throw new Error(d.error || '讀取統計失敗'); return d.stats; });
  }

  function postSurvey(payload) {
    if (DEMO) {
      return sleep(700).then(function () { demoAdd(payload.answers); return { ok: true, stats: demoStats() }; });
    }
    return fetch(C.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // 用 text/plain 避免 CORS 預檢
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (!d.ok) throw new Error(d.error || '送出失敗'); return d; });
  }

  // ---------- 示範模式的假統計 ----------
  var demo = null;
  function demoInit() {
    var seed = 7;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    demo = { total: 128, counts: {}, wtp: {} };
    Q.forEach(function (q) {
      if (q.type === 'choice') {
        var w = q.options.map(function () { return 0.3 + rnd(); });
        var s = w.reduce(function (a, b) { return a + b; }, 0);
        demo.counts[q.id] = w.map(function (x) { return Math.round(x / s * demo.total); });
      } else {
        demo.wtp[q.id] = { median: 100, zero: 20 + Math.round(rnd() * 15),
          bins: ['1–49 元', '50–99 元', '100 元', '101–199 元', '200–499 元', '500 元以上'].map(function (l, i) {
            return { label: l, count: Math.round([14, 22, 30, 12, 9, 4][i] * (0.7 + rnd() * 0.6)) };
          }) };
      }
    });
  }
  function demoStats() { if (!demo) demoInit(); return JSON.parse(JSON.stringify(demo)); }
  function demoAdd(a) {
    if (!demo) demoInit();
    demo.total++;
    Q.forEach(function (q) {
      if (q.type === 'choice') demo.counts[q.id][q.options.indexOf(a[q.id])]++;
      else {
        var b = wtpBin(Number(a[q.id]));
        if (b === 0) demo.wtp[q.id].zero++; else demo.wtp[q.id].bins[b - 1].count++;
      }
    });
  }

  // 願付價格分組（需與後端 WTP_BINS 一致）：0 = 不想買
  function wtpBin(v) {
    if (!(v > 0)) return 0;
    if (v < 50) return 1;
    if (v < 100) return 2;
    if (v === 100) return 3;
    if (v < 200) return 4;
    if (v < 500) return 5;
    return 6;
  }

  // ===================== 畫面 =====================
  function render() {
    window.scrollTo(0, 0);
    var v = state.view;
    if (v === 'home') return renderHome();
    if (v === 'q') return renderQuestion();
    if (v === 'confirm') return renderConfirm();
    if (v === 'submitting') return renderLoading('送出中，正在計算你的結果…');
    if (v === 'result') return renderResult();
    if (v === 'error') return renderError();
  }

  function demoBanner() {
    if (API_BAD) return '<div class="demo-banner warn">⚠️ ' + esc(API_BAD_MSG) + '</div>';
    return DEMO ? '<div class="demo-banner">🧪 示範模式：尚未設定 API_URL，送出不會寫入資料，統計圖為假資料。</div>' : '';
  }

  function friendlyError(e) {
    var m = (e && e.message) || '';
    if (API_BAD) return API_BAD_MSG;
    if (/Failed to fetch|NetworkError|Load failed|JSON/i.test(m)) return '無法連線到伺服器，請檢查網路後再試一次。';
    return m || '送出失敗，請稍後再試';
  }

  function renderLoading(text) {
    app.innerHTML = '<div class="spinner"></div><p class="center small">' + esc(text) + '</p>';
  }

  // ---------- 首頁 ----------
  function renderHome() {
    var s = state.stats;
    var h = demoBanner() +
      '<h1>你是理性派還是夢想派？<br>3 分鐘測你的彩券直覺</h1>' +
      '<div class="chips">' +
        '<span class="chip">⏱ 共 9 題・約 3 分鐘</span>' +
        '<span class="chip">🔒 匿名・免填信箱</span>' +
        '<span class="chip">📊 填完解鎖統計圖表</span>' +
      '</div>' +
      '<div class="counter">' + (s ? '已有 <b>' + fmt(s.total) + '</b> 人參與' : '&nbsp;') + '</div>' +
      '<p class="lead">您好！本問卷旨在了解一般大眾在面對不同彩券玩法與獎金設定時的購買偏好。所有選項皆無對錯之分，請依照您的真實直覺作答，非常感謝您的協助！</p>' +
      '<div class="note"><b>作答說明</b><br>' + esc(window.PART1_INSTRUCTION) + '</div>' +
      '<button class="btn" id="start">開始作答</button>';

    h += '<div class="section-title">📊 大家的選擇</div>';
    if (C.STATS_PUBLIC_BEFORE_SUBMIT) {
      h += s ? allCharts(null, s) : '<div class="card center small">統計載入中…</div>';
    } else {
      h += '<div class="card locked"><div class="icon">🔒</div>' +
           '<b>完成作答後解鎖統計圖表</b>' +
           '<p class="small">為了讓每個人的答案都是自己的直覺，作答前不會顯示其他人的選擇。</p></div>';
    }

    app.innerHTML = h;
    $('start').onclick = function () {
      state.view = 'q'; state.i = 0; state.history = []; state.answers = {}; state.autoZero = {};
      state.startedAt = Date.now();
      render();
    };
  }

  // ---------- 題目 ----------
  function go(next) {
    state.history.push(state.i);
    state.i = next;
    state.view = next >= Q.length ? 'confirm' : 'q';
    render();
  }

  function goBack() {
    if (!state.history.length) { state.view = 'home'; render(); return; }
    state.i = state.history.pop();
    state.view = 'q';
    render();
  }

  function renderQuestion() {
    var q = Q[state.i];
    var pct = Math.round(state.i / Q.length * 100);
    var h =
      '<div class="topbar">' +
        '<button class="back" id="back">' + (state.history.length ? '← 上一題' : '← 回首頁') + '</button>' +
        '<span>' + (state.i + 1) + ' / ' + Q.length + '</span>' +
      '</div>' +
      '<div class="progress" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + pct + '%"></i></div>' +
      '<div class="part">' + esc(q.part) + '</div>' +
      '<h2>' + esc(q.no) + '. ' + esc(q.title) + '</h2>';

    if (q.scenario) h += '<div class="scenario">' + esc(q.scenario) + '</div>';

    if (q.type === 'choice') {
      q.options.forEach(function (o, k) {
        h += '<button class="opt' + (state.answers[q.id] === o ? ' sel' : '') + '" data-k="' + k + '">' + esc(o) + '</button>';
      });
    } else {
      var v = state.answers[q.id];
      var prevQ = Q[state.i - 1];
      if (prevQ && prevQ.type === 'choice' && state.answers[prevQ.id]) {
        h += '<div class="prev">你在上一題選了<b>' + esc(state.answers[prevQ.id]) + '</b></div>';
      }
      h += '<div class="num"><input id="num" inputmode="decimal" autocomplete="off" placeholder="例如 100" aria-label="金額（元）" value="' +
             (v !== undefined ? esc(v) : '') + '"><span>元</span></div>' +
           '<p class="hint">' + esc(q.help || '') + '</p>' +
           '<div class="err" id="err" role="alert"></div>' +
           '<button class="btn" id="next">下一題</button>';
    }

    app.innerHTML = h;
    $('back').onclick = goBack;

    if (q.type === 'choice') {
      var bs = app.querySelectorAll('.opt');
      for (var b = 0; b < bs.length; b++) {
        bs[b].onclick = function () { choose(q, Number(this.getAttribute('data-k')), this); };
      }
    } else {
      var inp = $('num');
      var submitNum = function () {
        var s = inp.value.trim().replace(/[,，\s]/g, '').replace(/元$/, '');
        if (!/^\d+(\.\d+)?$/.test(s)) {
          $('err').textContent = '請填入 0 以上的數字（不需加「元」）';
          return;
        }
        state.answers[q.id] = Number(s);
        delete state.autoZero[q.id];
        go(state.i + 1);
      };
      $('next').onclick = submitNum;
      inp.onkeydown = function (e) { if (e.key === 'Enter') submitNum(); };
      if (window.matchMedia('(pointer: fine)').matches) inp.focus();
    }
  }

  function choose(q, k, el) {
    state.answers[q.id] = q.options[k];
    var all = app.querySelectorAll('.opt');
    for (var j = 0; j < all.length; j++) all[j].classList.remove('sel');
    el.classList.add('sel');

    var step = 1;
    if (q.zeroNextIf !== undefined) {
      var nextId = Q[state.i + 1].id;
      if (k === q.zeroNextIf) {
        state.answers[nextId] = 0;          // 選「不想買」→ 願付金額自動為 0 並跳過
        state.autoZero[nextId] = true;
        step = 2;
      } else if (state.autoZero[nextId]) {  // 回頭改答案 → 清掉自動填的 0
        delete state.answers[nextId];
        delete state.autoZero[nextId];
      }
    }
    setTimeout(function () { go(state.i + step); }, 200);
  }

  // ---------- 送出 ----------
  function renderConfirm() {
    app.innerHTML =
      '<div class="topbar"><button class="back" id="back">← 上一題</button><span>完成！</span></div>' +
      '<div class="progress"><i style="width:100%"></i></div>' +
      '<h1>全部答完了 🎉</h1>' +
      '<p class="lead">送出後就會看到你的「彩券性格」，並解鎖所有人的統計圖表。</p>' +
      '<input class="hp" id="website" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<button class="btn" id="submit">送出並看結果</button>';
    $('back').onclick = goBack;
    $('submit').onclick = submit;
  }

  function submit() {
    var hp = $('website');
    var payload = {
      answers: state.answers,
      clientId: clientId(),
      durationSec: state.startedAt ? Math.round((Date.now() - state.startedAt) / 1000) : null,
      version: window.SURVEY_VERSION,
      website: hp ? hp.value : ''
    };
    state.view = 'submitting'; render();
    postSurvey(payload)
      .then(function (d) {
        state.record = { answers: state.answers, at: Date.now() };
        storageSet(STORE_KEY, JSON.stringify(state.record));
        state.stats = d.stats;
        state.view = 'result';
        render();
      })
      .catch(function (e) {
        state.error = friendlyError(e);
        state.view = 'error';
        render();
      });
  }

  function renderError() {
    app.innerHTML =
      '<h1>糟糕，送出失敗了</h1>' +
      '<p class="lead">' + esc(state.error) + '</p>' +
      '<p class="small">你的答案還在，按下方按鈕重新送出即可。</p>' +
      '<button class="btn" id="retry">再試一次</button>';
    $('retry').onclick = function () { state.view = 'confirm'; render(); };
  }

  // ---------- 結果 ----------
  function persona(a) {
    var noBuy = a.Q1_1 === opt('Q1_1', 2) && a.Q2_1 === opt('Q2_1', 2) && a.Q3_1 === opt('Q3_1', 3);
    if (noBuy) return { emoji: '🧊', name: '冷眼旁觀者', desc: '不管獎金多誘人都不為所動，彩券很難打動你。' };
    var s = 0;
    if (a.Q1_1 === opt('Q1_1', 1)) s++;
    if (a.Q2_1 === opt('Q2_1', 0)) s++;
    if (a.Q3_1 === opt('Q3_1', 0)) s++;
    if (a.Q4 === opt('Q4', 0) || a.Q4 === opt('Q4', 1)) s++;
    if (a.Q5 === opt('Q5', 1)) s++;
    if (s >= 4) return { emoji: '🌠', name: '夢想家', desc: '頭獎越大越心動！比起「中的機率有多少」，你更在意「中了會怎樣」。' };
    if (s >= 2) return { emoji: '⚖️', name: '平衡派', desc: '你會被大獎吸引，也會留意機率，在夢想與現實之間找平衡。' };
    return { emoji: '🧮', name: '精算師', desc: '你習慣先看機率和期望值，再決定值不值得出手。' };
  }

  // 單一數列的橫向長條圖；mine = 使用者選的那一列（以紅色 +「你」標示，不只靠顏色）
  function barChart(o) {
    var total = o.counts.reduce(function (x, y) { return x + y; }, 0);
    var h = '<div class="card chart"><h3>' + esc(o.title) + '</h3>' +
            '<p class="sub">' + esc(o.sub || ('共 ' + fmt(total) + ' 人作答')) + '</p>';
    o.labels.forEach(function (l, k) {
      var c = o.counts[k] || 0;
      var pct = total ? Math.round(c / total * 100) : 0;
      var me = o.mine === k;
      h += '<div class="bar-row' + (me ? ' me' : '') + '" tabindex="0" aria-label="' + esc(l + '：' + pct + '%，' + c + ' 人' + (me ? '（你的選擇）' : '')) + '">' +
             '<span class="tip">' + fmt(c) + ' 人・' + pct + '%</span>' +
             '<div class="lbl"><span>' + (me ? '<span class="you-tag">你</span>' : '') + esc(l) + '</span><span class="val">' + pct + '%</span></div>' +
             '<div class="track"><div class="fill" style="width:' + pct + '%"></div></div>' +
           '</div>';
    });
    if (o.insight) h += '<div class="insight">💡 ' + esc(o.insight) + '</div>';
    return h + '</div>';
  }

  function choiceChart(id, a, s, withInsight) {
    var q = byId[id];
    return barChart({
      title: q.no + '. ' + q.title,
      labels: q.options,
      counts: (s.counts && s.counts[id]) || q.options.map(function () { return 0; }),
      mine: a ? q.options.indexOf(a[id]) : -1,
      insight: withInsight && C.SHOW_INSIGHTS ? window.INSIGHTS[id] : null
    });
  }

  function wtpChart(id, label, a, s) {
    var w = (s.wtp && s.wtp[id]) || { zero: 0, bins: [], median: null };
    var labels = ['不想買（0 元）'].concat(w.bins.map(function (b) { return b.label; }));
    var counts = [w.zero].concat(w.bins.map(function (b) { return b.count; }));
    var mine = a ? wtpBin(Number(a[id])) : -1;
    var sub = '有意願購買者的中位數：' + (w.median !== null && w.median !== undefined ? fmt(w.median) + ' 元' : '—');
    if (a && Number(a[id]) > 0) sub += '　你：' + fmt(a[id]) + ' 元';
    return barChart({ title: label, sub: sub, labels: labels, counts: counts, mine: mine });
  }

  function allCharts(a, s) {
    var h = '';
    ['Q1_1', 'Q2_1', 'Q3_1', 'Q4', 'Q5'].forEach(function (id) { h += choiceChart(id, a, s, !!a); });
    h += '<div class="section-title">💰 願意花多少錢買一張？</div>';
    h += wtpChart('Q1_2', '1-2. 第 1 題的願付價格', a, s);
    h += wtpChart('Q2_2', '2-2. 第 2 題的願付價格', a, s);
    h += wtpChart('Q3_2', '3-2. 第 3 題的願付價格', a, s);
    h += '<div class="section-title">👥 填答者概況</div>';
    ['Q6', 'Q7', 'Q8', 'Q9'].forEach(function (id) { h += choiceChart(id, a, s, false); });
    return h;
  }

  function shareCard(p) {
    var url = shareUrl();
    var text = '我的彩券性格是「' + p.name + '」' + p.emoji + '，你呢？3 分鐘測你的彩券直覺 👉 ';
    var h = '<div class="card center"><b>覺得有趣嗎？幫忙分享給朋友 🙏</b>' +
            '<p class="small">每一份回覆對這份研究都很重要，謝謝你！</p><div class="share">';
    if (navigator.share) h += '<button class="btn" id="nativeShare">分享給朋友</button>';
    h += '<a class="btn line" target="_blank" rel="noopener" href="https://line.me/R/share?text=' + encodeURIComponent(text + url) + '">分享到 LINE</a>' +
         '<button class="btn ghost" id="copy">複製連結</button>' +
         '<input class="urlbox" id="url" readonly value="' + esc(url) + '" aria-label="問卷連結">' +
         '</div></div>';
    return { html: h, text: text, url: url };
  }

  function renderResult() {
    var a = state.record ? state.record.answers : state.answers;
    var s = state.stats;
    var p = persona(a);
    var share = shareCard(p);

    var h = demoBanner() +
      '<div class="persona"><div class="emoji">' + p.emoji + '</div>' +
      '<div class="kicker">你的彩券性格是</div>' +
      '<div class="name">' + esc(p.name) + '</div><p>' + esc(p.desc) + '</p></div>' +
      share.html +
      '<div class="section-title">📊 你和大家的選擇' + (s ? '（共 ' + fmt(s.total) + ' 人）' : '') + '</div>';

    h += s ? allCharts(a, s) : '<div class="card center small">統計載入中…</div>';
    app.innerHTML = h;

    if ($('nativeShare')) {
      $('nativeShare').onclick = function () {
        navigator.share({ title: '彩券直覺小測驗', text: share.text, url: share.url }).catch(function () {});
      };
    }
    $('copy').onclick = function () {
      var btn = this, box = $('url');
      var done = function () { btn.textContent = '已複製！'; setTimeout(function () { btn.textContent = '複製連結'; }, 1800); };
      var fallback = function () {
        box.focus(); box.select();
        try { document.execCommand('copy'); done(); } catch (e) { btn.textContent = '請長按上方連結手動複製'; }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(share.url).then(done, fallback);
      else fallback();
    };
  }

  // ===================== 啟動 =====================
  function refreshStats() {
    fetchStats().then(function (s) {
      state.stats = s;
      if (state.view === 'home' || state.view === 'result') render();
    }).catch(function () { /* 統計讀不到不影響作答 */ });
  }

  if (C.ONE_RESPONSE_PER_DEVICE && state.record && state.record.answers) {
    state.view = 'result';
  }
  render();
  refreshStats();
})();
