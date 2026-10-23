/* =========================================================
   거래처 원장 자동화 V9.1 · app.js
   ---------------------------------------------------------
   · GAS(구글 앱스 스크립트)는 그대로 두고, 이 화면만 새로 만들었습니다.
   · 주소/토큰/이미지 경로는 config.json 에서 읽습니다.
   · GAS 가 실제로 제공하는 action 만 사용합니다:
     ping, customers, preview, send, discard, pending, history,
     regular, runRegular, clearSent, rows, set, run, unset
   ========================================================= */
'use strict';

/* ------------------------------------------------------------------
   0. 기본값 (config.json 을 못 읽었을 때 쓰는 안전장치)
   ------------------------------------------------------------------ */
const DEFAULTS = {
  webapp: {
    url: 'https://script.google.com/macros/s/AKfycbx1ApZaWu7qX8l2NciEkMtBZTnOIX_Fs8hPogFST705srrjHx1czPde_jGuIKOkmsJG/exec',
    token: 'ProzymeCustomerLedger',
    timeoutMs: 60000
  },
  assets: {
    logo: ['./TIGERS.JPG', './TIGERS.jpg', './tigers.jpg', './TIGERS.png'],
    background: ['./DOYEONG_Ledger.png', './DOYEONG_Ledger.PNG', './DOYEONG_Ledger.jpg', './DOYEONG_Ledger.JPG', './DOYEONG_Ledger'],
    backgroundOpacity: 0.34,
    backgroundPosition: 'center 26%'
  },
  brand: {
    appName: '거래처 원장 자동화', version: 'V9.1', fallbackInitial: 'PZ',
    title: '거래처 원장', titleAccent: '확인 후 발송',
    subtitle: 'PDF로 먼저 확인 → 회사·거래처 동시 발송',
    footer: '푸로찜 총판 · 거래처 원장 자동화'
  },
  ui: { pickerLimit: 60, searchDebounceMs: 120, historyLimit: 80, showManualRun: true }
};

const $  = (id) => document.getElementById(id);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ------------------------------------------------------------------
   1. 전역 상태
   ------------------------------------------------------------------ */
const ST = {
  cfg: DEFAULTS,
  url: '', token: '',
  customers: [],
  cur: null, per: null,
  connected: false,
  cfgMissing: false
};

/* ------------------------------------------------------------------
   2. 공통 유틸
   ------------------------------------------------------------------ */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));
}
function money(v) {
  const n = Number(v || 0);
  return n.toLocaleString('ko-KR') + '원';
}
function isoToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function isoShift(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dots(iso) { return String(iso || '-').replace(/-/g, '.'); }
function showMsg(id, text, kind) {
  const el = $(id);
  if (!el) return;
  el.className = 'msg show ' + (kind || 'info');
  el.textContent = text;
}
function hideMsg(id) {
  const el = $(id);
  if (el) el.className = 'msg';
}
function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.dataset.label || btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> ' + (label || '처리 중…');
  } else {
    btn.disabled = false;
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }
}
function pill(kind, text) {
  const el = $('connPill');
  if (!el) return;
  el.className = 'pill ' + (kind || '');
  el.textContent = text;
}

/* ------------------------------------------------------------------
   3. config.json 불러오기 + 이미지 자동 탐색
   ------------------------------------------------------------------ */
function deepMerge(base, over) {
  const out = Object.assign({}, base);
  Object.keys(over || {}).forEach(k => {
    if (k.charAt(0) === '_') return;
    const v = over[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  });
  return out;
}

async function loadConfig() {
  try {
    const res = await fetch('./config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('config.json 없음');
    const raw = await res.json();
    ST.cfg = deepMerge(DEFAULTS, raw);
  } catch (e) {
    ST.cfg = DEFAULTS;
    ST.cfgMissing = true;
  }
  const c = ST.cfg;
  ST.url = String((c.webapp && c.webapp.url) || '').trim();
  ST.token = String((c.webapp && c.webapp.token) || '').trim();
}

/* 후보 경로를 앞에서부터 시험 → 처음 성공한 파일을 사용 */
function pickAsset(candidates) {
  const list = (candidates || []).filter(Boolean);
  return new Promise(resolve => {
    let i = 0;
    const tryNext = () => {
      if (i >= list.length) return resolve('');
      const src = list[i++];
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        if (ok) resolve(src); else tryNext();
      };
      const img = new Image();
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      /* 이미지 응답이 없어도 화면이 멈추지 않도록 2.5초 제한 */
      setTimeout(() => finish(false), 2500);
      img.src = src;
    };
    tryNext();
  });
}

async function applyBranding() {
  const c = ST.cfg;
  const b = c.brand || {};

  /* 문구 */
  document.title = (b.appName || '') + ' ' + (b.version || '');
  if ($('brandName')) $('brandName').textContent = b.appName || '';
  if ($('brandVer')) $('brandVer').textContent = b.version || '';
  if ($('brandTitle')) $('brandTitle').innerHTML = esc(b.title || '') + (b.titleAccent ? ' <em>' + esc(b.titleAccent) + '</em>' : '');
  if ($('brandSub')) $('brandSub').textContent = b.subtitle || '';
  if ($('footName')) $('footName').textContent = (b.footer || '') + ' ' + (b.version || '');
  if ($('symFallback')) $('symFallback').textContent = b.fallbackInitial || 'PZ';

  /* 배경 사진 — ★ 여기서 '진짜 파일명'을 찾아서 CSS 변수에 넣습니다 */
  const a = c.assets || {};
  const bg = await pickAsset(a.background);
  const root = document.documentElement;
  if (bg) {
    root.style.setProperty('--bg-photo', 'url("' + bg + '")');
    root.style.setProperty('--bg-photo-opacity', String(a.backgroundOpacity != null ? a.backgroundOpacity : 0.34));
    root.style.setProperty('--bg-photo-pos', a.backgroundPosition || 'center 26%');
    document.body.setAttribute('data-bg', bg);
  } else {
    document.body.setAttribute('data-bg', '');
    if ($('assetWarn')) {
      $('assetWarn').classList.remove('hide');
      $('assetWarn').innerHTML = '배경 이미지를 찾지 못했습니다. <code>config.json</code> 의 '
        + '<code>assets.background</code> 목록에 실제 파일명(대소문자까지)을 넣어 주세요. '
        + '지금은 그라데이션 배경으로 정상 동작합니다.';
    }
  }

  /* 로고(TIGERS) — 심볼 자리에 표시 */
  const logo = await pickAsset(a.logo);
  const sym = $('symbol');
  const img = $('symImg');
  if (logo && img) {
    img.src = logo;
    img.style.display = 'block';
    if (sym) sym.classList.add('has-img');
  } else if (img) {
    img.style.display = 'none';
  }
}

/* ------------------------------------------------------------------
   4. GAS 호출 (CORS 회피 : Content-Type text/plain)
   ------------------------------------------------------------------ */
async function gas(payload, useGet) {
  if (!ST.url || ST.url.indexOf('여기에') >= 0) {
    throw new Error('config.json 의 webapp.url 에 Apps Script /exec 주소를 넣어 주세요.');
  }
  const body = Object.assign({}, payload);
  if (ST.token) body.token = ST.token;

  const opt = { method: useGet ? 'GET' : 'POST' };
  let url = ST.url;
  if (useGet) {
    url = ST.url + (ST.url.indexOf('?') >= 0 ? '&' : '?') + new URLSearchParams(body).toString();
  } else {
    opt.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
    opt.body = JSON.stringify(body);
    opt.redirect = 'follow';
  }

  const ctrl = ('AbortController' in window) ? new AbortController() : null;
  const limit = Number((ST.cfg.webapp && ST.cfg.webapp.timeoutMs) || 60000);
  let timer = null;
  if (ctrl) {
    opt.signal = ctrl.signal;
    timer = setTimeout(() => ctrl.abort(), limit);
  }

  try {
    const res = await fetch(url, opt);
    const txt = await res.text();
    try { return JSON.parse(txt); }
    catch (e) {
      throw new Error('응답을 해석하지 못했습니다. 배포 권한(모든 사용자)과 /exec 주소를 확인하세요.\n' + txt.slice(0, 180));
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* 연결 확인 → 상단 상태 알약만 갱신 */
async function connect(silent) {
  if (!silent) pill('busy', '확인 중…');
  try {
    const out = await gas({ action: 'ping' });
    if (!out.ok) throw new Error(out.error || '연결 실패');
    ST.connected = true;
    pill('ok', '연결됨');
    const nx = dots(out.nextRegular) + (out.weekendShift ? ' (금)' : '');
    if ($('nextPill')) $('nextPill').textContent = '다음 정기 ' + nx;
    if ($('regNext')) $('regNext').textContent = dots(out.nextRegular);
    if ($('regNextNote')) {
      $('regNextNote').textContent = out.weekendShift
        ? '말일이 주말이라 직전 금요일에 발송됩니다.'
        : '말일이 평일이라 말일 당일에 발송됩니다.';
    }
    return out;
  } catch (e) {
    ST.connected = false;
    pill('err', '연결 안 됨');
    if (!silent) showMsg('msgReg', e.message, 'err');
    return null;
  }
}

/* ------------------------------------------------------------------
   5. 거래처 목록 — 정렬 + 검색
   ------------------------------------------------------------------ */
const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

/* 한글 이름의 첫 글자로 가나다 그룹 키 만들기 (영문/숫자는 'A-Z', '0-9') */
function groupKey(name) {
  const s = String(name || '').trim();
  if (!s) return '#';
  const ch = s.charAt(0);
  const code = ch.charCodeAt(0);
  if (code >= 0xAC00 && code <= 0xD7A3) {
    return CHO[Math.floor((code - 0xAC00) / 588)];
  }
  if (/[0-9]/.test(ch)) return '0-9';
  if (/[A-Za-z]/.test(ch)) return 'A-Z';
  return '#';
}
const GROUP_ORDER = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ','A-Z','0-9','#'];
function groupRank(k) {
  const i = GROUP_ORDER.indexOf(k);
  return i < 0 ? 999 : i;
}

/* 이름 가나다 정렬 (한글 우선, 그다음 영문/숫자) */
function sortByName(list) {
  return list.slice().sort((a, b) => {
    const ga = groupRank(groupKey(a.name)), gb = groupRank(groupKey(b.name));
    if (ga !== gb) return ga - gb;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
  });
}

/* 화면에 표시할 '부가 정보' 만들기 — 어떤 키 이름으로 와도 잡아냅니다 */
function contactOf(c) {
  const pick = (...vals) => {
    for (const v of vals) {
      const s = String(v == null ? '' : v).trim();
      if (s) return s;
    }
    return '';
  };
  return {
    bizNo: pick(c.bizNo, c.bizno, c.bizNumber, c.biz_no, c.사업자번호),
    email: pick(c.email, c.mail, c.emailAddress, c.이메일),
    phone: pick(c.phone, c.tel, c.mobile, c.연락처, c.전화)
  };
}

function flagsOf(c) {
  const f = [];
  if (c.isRegular) f.push({ t: '정기', c: '' });
  if (c.isCurrent) f.push({ t: '당월', c: 'b2' });
  if (c.isPeriod)  f.push({ t: '기간', c: 'b3' });
  return f;
}

/* 로컬 검색 : 이름 / 사업자번호 / 이메일 / 연락처 */
function localFilter(q, src) {
  const all = src || ST.customers;
  const s = String(q || '').trim().toLowerCase();
  const digits = s.replace(/[^0-9]/g, '');
  if (!s) return all;
  return all.filter(c => {
    const nm = String(c.name || '').toLowerCase();
    const ct = contactOf(c);
    const bn = ct.bizNo.replace(/[^0-9]/g, '');
    const ph = ct.phone.replace(/[^0-9]/g, '');
    return nm.indexOf(s) >= 0
      || (digits && bn && bn.indexOf(digits) >= 0)
      || (digits && ph && ph.indexOf(digits) >= 0)
      || String(ct.email || '').toLowerCase().indexOf(s) >= 0;
  });
}

/* 중복 제거 (id 기준) */
function dedupe(list) {
  const seen = Object.create(null);
  const out = [];
  (list || []).forEach(c => {
    if (!c || !c.id) return;
    if (seen[c.id]) {
      /* 이미 있으면 비어있는 연락처만 보충 */
      const prev = seen[c.id];
      const a = contactOf(prev), b = contactOf(c);
      if (!a.email && b.email) prev.email = b.email;
      if (!a.bizNo && b.bizNo) prev.bizNo = b.bizNo;
      if (!a.phone && b.phone) prev.phone = b.phone;
      prev.isRegular = prev.isRegular || !!c.isRegular;
      prev.isCurrent = prev.isCurrent || !!c.isCurrent;
      prev.isPeriod  = prev.isPeriod  || !!c.isPeriod;
      return;
    }
    seen[c.id] = c;
    out.push(c);
  });
  return out;
}

let custLoading = null;
async function ensureCustomers(force) {
  if (!force && ST.customers.length) return ST.customers;
  if (custLoading) return custLoading;

  custLoading = (async () => {
    let list = [];
    /* 1) 전체 거래처 (customers) */
    try {
      const out = await gas({ action: 'customers' });
      if (out && out.ok) list = list.concat(out.customers || []);
    } catch (e) { /* 아래 2차 시도 */ }

    /* 2) 정기 목록(regular)에는 이메일/사업자번호가 꼭 들어있음 →
          customers 응답에 연락처가 비어 있던 문제를 여기서 보충합니다. */
    try {
      const out2 = await gas({ action: 'regular' });
      if (out2 && out2.ok && out2.data && out2.data.list) {
        out2.data.list.forEach(r => list.push({
          id: r.id, name: r.name, email: r.email || '', bizNo: r.bizNo || '',
          isRegular: true
        }));
      }
    } catch (e) { /* 없어도 됨 */ }

    if (!list.length) throw new Error('거래처 목록을 불러오지 못했습니다. (GAS 배포 권한 확인)');

    ST.customers = sortByName(dedupe(list));
    return ST.customers;
  })();

  try { return await custLoading; }
  finally { custLoading = null; }
}

/* ------------------------------------------------------------------
   6. 거래처 선택 UI (가나다 그룹 + 부가정보)
   ------------------------------------------------------------------ */
function renderPicker(pickerEl, selEl, selNameEl, list, onPick) {
  const limit = Number((ST.cfg.ui && ST.cfg.ui.pickerLimit) || 60);
  const rows = sortByName(dedupe(list)).slice(0, limit);

  if (!rows.length) {
    pickerEl.innerHTML = '<div class="picker-empty">검색 결과가 없습니다.<br>'
      + '<span style="font-size:11px">이름 · 사업자번호 · 이메일 · 연락처로 다시 검색해 보세요.</span></div>';
    pickerEl.classList.add('show');
    return;
  }

  let html = '<div class="picker-head"><span>거래처 <b>' + rows.length + '</b>곳 · 가나다 순</span>'
    + '<span>클릭하면 선택됩니다</span></div>';

  let lastGroup = '';
  rows.forEach(c => {
    const g = groupKey(c.name);
    if (g !== lastGroup) {
      html += '<div class="picker-group">' + esc(g) + '</div>';
      lastGroup = g;
    }
    const ct = contactOf(c);
    const bits = [ct.bizNo, ct.email, ct.phone].filter(Boolean);
    const fb = flagsOf(c).map(f => '<span class="fbadge ' + f.c + '">' + f.t + '</span>').join('');
    const meta = bits.length
      ? esc(bits.join(' · '))
      : (fb ? '연락처 미등록' : '연락처 미등록');
    html += '<div class="picker-row" data-id="' + esc(c.id) + '" data-name="' + esc(c.name) + '">'
      + '<div class="pr-l">'
      +   '<div class="nm">' + esc(c.name) + '</div>'
      +   '<div class="mt' + (bits.length ? '' : ' none') + '">' + meta + '</div>'
      + '</div>'
      + '<div class="pr-r">' + fb + '</div>'
      + '</div>';
  });

  pickerEl.innerHTML = html;

  Array.from(pickerEl.querySelectorAll('.picker-row')).forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.id, name = row.dataset.name;
      pickerEl.classList.remove('show');
      selEl.classList.remove('hide');
      const found = ST.customers.filter(c => c.id === id)[0] || { id: id, name: name };
      const ct = contactOf(found);
      selNameEl.innerHTML = esc(name)
        + '<span class="sub">' + esc(ct.email || '이메일 미등록') + (ct.bizNo ? ' · ' + esc(ct.bizNo) : '') + '</span>';
      onPick({ id: id, name: name });
    });
  });
  pickerEl.classList.add('show');
}

/* 검색 입력 1개를 통째로 연결 (당월/기간 공용) */
function wireSearch(inputId, pickerId, selId, selNameId, msgId, onPick) {
  const input = $(inputId), picker = $(pickerId), sel = $(selId), selName = $(selNameId);
  let timer = null;
  let searching = false;

  const run = async () => {
    if (searching) return;
    searching = true;
    try {
      let list;
      try {
        list = await ensureCustomers();
      } catch (e) {
        showMsg(msgId, e.message, 'err');
        searching = false;
        return;
      }
      renderPicker(picker, sel, selName, localFilter(input.value, list), c => onPick(c, input));
    } finally { searching = false; }
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, Number((ST.cfg.ui && ST.cfg.ui.searchDebounceMs) || 120));
  });
  input.addEventListener('focus', run);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') picker.classList.remove('show');
  });
  document.addEventListener('click', (e) => {
    if (!picker.contains(e.target) && e.target !== input) picker.classList.remove('show');
  });
  return { input, picker, sel, selName };
}

/* ------------------------------------------------------------------
   7. 미리보기 카드 (PDF 열기 + 승인/취소) — 기존 기능 그대로
   ------------------------------------------------------------------ */
function renderPreview(slotEl, msgId, d, ctx) {
  const modeLabel = d.mode === '정기' ? '① 정기 거래처원장'
    : (d.mode === '당월' ? '② 당월 거래처원장' : '③ 기간별 거래처원장');

  const rows = (d.rows || []).map(r => {
    let cls = '';
    if (r.sales !== '' && r.sales !== null && r.sales !== undefined) cls = 'row-sale';
    else if (r.pay !== '' && r.pay !== null && r.pay !== undefined) cls = 'row-pay';
    else if (r.content && (String(r.content).indexOf('미수금') >= 0 || String(r.content).indexOf('선수금') >= 0)) cls = 'row-base';
    return '<tr class="' + cls + '">'
      + '<td>' + esc(r.date) + '</td>'
      + '<td>' + esc(r.content) + '</td>'
      + '<td class="num">' + (r.qty === '' || r.qty == null ? '' : esc(r.qty)) + '</td>'
      + '<td class="num">' + (r.sales === '' || r.sales == null ? '' : Number(r.sales).toLocaleString('ko-KR')) + '</td>'
      + '<td class="num">' + (r.pay === '' || r.pay == null ? '' : Number(r.pay).toLocaleString('ko-KR')) + '</td>'
      + '<td class="num"><b>' + (r.balance === '' || r.balance == null ? '' : Number(r.balance).toLocaleString('ko-KR')) + '</b></td>'
      + '<td>' + esc(r.note) + '</td>'
      + '</tr>';
  }).join('');

  const mailCc = d.cc ? ' / 참조 ' + d.cc : '';

  slotEl.innerHTML =
    '<div class="preview-box">'
    + '<div class="preview-head">'
    +   '<div class="t">📄 원장 미리보기 · ' + esc(modeLabel) + ' · ' + esc(d.customer.name) + '</div>'
    +   '<div><a class="pdf-btn" href="' + esc(d.pdfUrl) + '" target="_blank" rel="noopener">📄 PDF 열기</a></div>'
    + '</div>'
    + '<div class="kv">'
    +   '<div class="box"><div class="k">기간</div><div class="v" style="font-size:11px">' + esc(d.startIso) + ' ~ ' + esc(d.endIso) + '</div></div>'
    +   '<div class="box"><div class="k">과거 미수 (' + esc(String(d.asOfIso || '').slice(5).replace('-', '.')) + ' 기준)</div><div class="v">' + d.historyCount + '건 · ' + money(d.openingBalance) + '</div></div>'
    +   '<div class="box"><div class="k">기간 내 거래</div><div class="v">' + d.currentCount + '건</div></div>'
    +   '<div class="box"><div class="k">최종 미수 잔액</div><div class="v" style="color:var(--gold-lt)">' + money(d.closingBalance) + '</div></div>'
    + '</div>'
    + (d.collapsed ? '<div class="note" style="margin-bottom:11px">거래 건수가 양식(13행)을 넘어 일부를 자동 축약했습니다 — ' + esc(d.collapseNote || '') + '</div>' : '')
    + '<div class="tbl-scroll" style="margin-bottom:13px">'
    +   '<table><thead><tr><th>일자</th><th>내용</th><th style="text-align:right">수량</th>'
    +   '<th style="text-align:right">판매금</th><th style="text-align:right">입금액</th>'
    +   '<th style="text-align:right">잔액</th><th>비고</th></tr></thead>'
    +   '<tbody>' + (rows || '<tr><td colspan="7" style="color:var(--muted)">기간 내 거래가 없습니다.</td></tr>') + '</tbody></table>'
    + '</div>'
    + '<div class="note" style="margin-bottom:13px"><b>받는사람</b> ' + esc(d.to || '') + esc(mailCc)
    +   '<br>위 PDF를 먼저 확인하세요. 이상이 없으면 아래 <b>[회사+거래처 발송]</b>을 누르면 그 순간 발송됩니다.</div>'
    + '<div class="btns">'
    +   '<button class="btn gold" data-approve="' + esc(d.token) + '">✅ 회사+거래처 발송</button>'
    +   '<button class="btn ghost" data-discard="' + esc(d.token) + '">취소 (발송 안 함)</button>'
    + '</div>'
    + '</div>';

  slotEl.querySelectorAll('[data-approve]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm('이 원장을 회사와 거래처에 지금 발송할까요?\n발송 후에는 취소할 수 없습니다.')) return;
      setBusy(b, true, '발송 중');
      try {
        const out = await gas({ action: 'send', token: b.dataset.approve });
        if (!out.ok) throw new Error(out.error || '발송 실패');
        showMsg(msgId, '✅ 발송 완료 → ' + out.to + (out.cc ? '  (참조 ' + out.cc + ')' : ''), 'ok');
        slotEl.innerHTML = '';
        loadHistory();
        if (ctx && ctx.after) ctx.after();
      } catch (e) {
        showMsg(msgId, e.message, 'err');
        setBusy(b, false);
      }
    });
  });
  slotEl.querySelectorAll('[data-discard]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm('이 미리보기를 취소할까요? (발송되지 않습니다)')) return;
      try {
        await gas({ action: 'discard', token: b.dataset.discard });
        showMsg(msgId, '취소했습니다. 발송되지 않았습니다.', 'info');
        slotEl.innerHTML = '';
        loadHistory();
      } catch (e) { showMsg(msgId, e.message, 'err'); }
    });
  });
}

/* ------------------------------------------------------------------
   8. ① 정기 탭
   ------------------------------------------------------------------ */
async function loadRegular() {
  const box = $('regList');
  box.innerHTML = '<div class="picker-empty">불러오는 중…</div>';
  try {
    const out = await gas({ action: 'regular' });
    if (!out.ok) throw new Error(out.error || '불러오기 실패');
    const d = out.data || {};

    if ($('regNext')) $('regNext').textContent = dots(d.nextRunIso);
    if ($('nextPill')) $('nextPill').textContent = '다음 정기 ' + dots(d.nextRunIso);
    if ($('regNextNote')) {
      $('regNextNote').textContent = d.weekendShift
        ? '말일(' + dots(d.monthEndIso) + ')이 주말이라 직전 금요일에 발송됩니다.'
        : '말일이 평일이라 말일 당일에 발송됩니다.';
    }

    const list = sortByName(d.list || []);
    if ($('regCount')) $('regCount').textContent = list.length;
    if (!list.length) {
      box.innerHTML = '<div class="picker-empty">노션에서 「정기 거래처원장」이 체크된 거래처가 없습니다.</div>';
      return;
    }
    box.innerHTML = list.map(c => {
      const ct = contactOf(c);
      const meta = [ct.email || '이메일 없음', c.lastSent ? '최근 발송 ' + c.lastSent : '발송 이력 없음'];
      return '<div class="chk on">'
        + '<div class="box">✓</div>'
        + '<div style="flex:1;min-width:0">'
        +   '<div class="nm">' + esc(c.name) + '</div>'
        +   '<div class="meta">' + esc(meta.join(' · ')) + '</div>'
        + '</div></div>';
    }).join('');
  } catch (e) {
    box.innerHTML = '<div class="picker-empty" style="color:#fca5a5">' + esc(e.message) + '</div>';
  }
}

/* ------------------------------------------------------------------
   9. ② 당월 탭
   ------------------------------------------------------------------ */
function initCurrent() {
  const ui = wireSearch('curSearch', 'curPicker', 'curSel', 'curSelName', 'msgCur',
    (c, input) => { ST.cur = c; input.value = c.name; });

  $('curSelX').addEventListener('click', () => {
    ST.cur = null; ui.sel.classList.add('hide'); ui.input.value = '';
  });

  $('btnCurPreview').addEventListener('click', async () => {
    const btn = $('btnCurPreview');
    hideMsg('msgCur');
    if (!ST.cur) { showMsg('msgCur', '거래처를 먼저 검색해서 선택하세요.', 'err'); return; }
    setBusy(btn, true, '원장 만드는 중');
    try {
      const out = await gas({ action: 'preview', mode: '당월', customerId: ST.cur.id });
      if (!out.ok) throw new Error(out.error || '미리보기 실패');
      renderPreview($('curPreviewSlot'), 'msgCur', out, { after: loadRegular });
      showMsg('msgCur', 'PDF를 먼저 확인한 뒤 [회사+거래처 발송]을 누르세요. (아직 발송되지 않았습니다)', 'info');
    } catch (e) {
      showMsg('msgCur', e.message, 'err');
    } finally { setBusy(btn, false); }
  });
}

/* ------------------------------------------------------------------
   10. ③ 기간별 탭
   ------------------------------------------------------------------ */
function initPeriod() {
  const ui = wireSearch('perSearch', 'perPicker', 'perSel', 'perSelName', 'msgPer',
    (c, input) => { ST.per = c; input.value = c.name; });

  $('perSelX').addEventListener('click', () => {
    ST.per = null; ui.sel.classList.add('hide'); ui.input.value = '';
  });

  $$('[data-range]').forEach(b => {
    b.addEventListener('click', () => {
      const t = isoToday();
      const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
      const pad = n => String(n).padStart(2, '0');
      const r = b.dataset.range;
      let s = '', e = t;
      if (r === 'thisMonth') { s = y + '-' + pad(m) + '-01'; }
      else if (r === 'lastMonth') {
        const ly = m === 1 ? y - 1 : y, lm = m === 1 ? 12 : m - 1;
        s = ly + '-' + pad(lm) + '-01';
        e = ly + '-' + pad(lm) + '-' + pad(new Date(ly, lm, 0).getDate());
      } else if (r === 'last30') { s = isoShift(-30); }
      else if (r === 'thisQuarter') {
        const qm = Math.floor((m - 1) / 3) * 3 + 1;
        s = y + '-' + pad(qm) + '-01';
      }
      $('perStart').value = s;
      $('perEnd').value = e;
    });
  });

  function collect() {
    const startIso = $('perStart').value;
    const endIso = $('perEnd').value;
    if (!ST.per) throw new Error('거래처를 먼저 검색해서 선택하세요.');
    if (!startIso || !endIso) throw new Error('시작일과 종료일을 모두 넣으세요.');
    if (startIso > endIso) throw new Error('시작일이 종료일보다 늦습니다.');
    return { customerId: ST.per.id, customerName: ST.per.name, startIso, endIso, memo: $('perMemo').value };
  }

  $('btnPerPreview').addEventListener('click', async () => {
    const btn = $('btnPerPreview');
    hideMsg('msgPer');
    let p;
    try { p = collect(); } catch (e) { showMsg('msgPer', e.message, 'err'); return; }
    setBusy(btn, true, '원장 만드는 중');
    try {
      const out = await gas(Object.assign({ action: 'preview', mode: '기간' }, p));
      if (!out.ok) throw new Error(out.error || '미리보기 실패');
      renderPreview($('perPreviewSlot'), 'msgPer', out, { after: loadRegular });
      showMsg('msgPer', 'PDF를 먼저 확인한 뒤 [회사+거래처 발송]을 누르세요. (아직 발송되지 않았습니다)', 'info');
    } catch (e) {
      showMsg('msgPer', e.message, 'err');
    } finally { setBusy(btn, false); }
  });

  $('btnPerSave').addEventListener('click', async () => {
    const btn = $('btnPerSave');
    hideMsg('msgPer');
    let p;
    try { p = collect(); } catch (e) { showMsg('msgPer', e.message, 'err'); return; }
    setBusy(btn, true, '저장 중');
    try {
      const out = await gas(Object.assign({ action: 'set' }, p));
      if (!out.ok) throw new Error(out.error || '저장 실패');
      showMsg('msgPer', '저장했습니다. 이제 노션에서 「기간별 거래처원장」을 체크하면 1분 안에 실행됩니다.\n'
        + '(또는 위 [미리보기]로 바로 확인하셔도 됩니다)', 'ok');
      loadHistory();
    } catch (e) {
      showMsg('msgPer', e.message, 'err');
    } finally { setBusy(btn, false); }
  });
}

/* ------------------------------------------------------------------
   11. 📋 이력 탭
   ------------------------------------------------------------------ */
function statusBadge(text) {
  const t = String(text || '');
  if (t.indexOf('성공') === 0) return '<span class="badge b-ok">발송완료</span>';
  if (t.indexOf('미리보기') === 0) return '<span class="badge b-prev">승인대기</span>';
  if (t.indexOf('실패') === 0 || t.indexOf('오류') === 0) return '<span class="badge b-err">오류</span>';
  if (t.indexOf('건너뜀') === 0) return '<span class="badge b-off">건너뜀</span>';
  return '<span class="badge b-wait">대기</span>';
}

async function loadHistory() {
  const box = $('hisList');
  if (!box) return;
  const kind = $('hisKind').value;
  const mode = $('hisMode').value;
  box.innerHTML = '<div class="picker-empty">불러오는 중…</div>';
  try {
    if (kind === 'pending') {
      const out = await gas({ action: 'pending' });
      if (!out.ok) throw new Error(out.error || '불러오기 실패');
      const rows = (out.rows || []).filter(r => !mode || r.mode === mode);
      if (!rows.length) {
        box.innerHTML = '<div class="picker-empty">승인 대기 중인 원장이 없습니다.</div>';
        return;
      }
      box.innerHTML = rows.map(r =>
        '<div class="item"><div class="l">'
        + '<div class="nm">' + esc(r.name) + ' ' + statusBadge(r.status === '승인대기' ? '미리보기' : r.status) + '</div>'
        + '<div class="sub">' + esc(r.mode) + ' · ' + esc(r.startIso) + ' ~ ' + esc(r.endIso) + '<br>'
        + '최종 미수 ' + money(r.closing) + ' · ' + esc(r.email || '이메일 없음') + '</div></div>'
        + '<div class="r"><a class="pdf-btn ' + (r.pdfUrl ? '' : 'off') + '" href="' + esc(r.pdfUrl || '#') + '" target="_blank" rel="noopener">📄 PDF 열기</a></div>'
        + '</div>').join('');
      return;
    }

    const out = await gas({ action: 'history', limit: Number((ST.cfg.ui && ST.cfg.ui.historyLimit) || 80), mode: mode });
    if (!out.ok) throw new Error(out.error || '불러오기 실패');
    const rows = out.rows || [];
    if (!rows.length) {
      box.innerHTML = '<div class="picker-empty">발송 이력이 없습니다.</div>';
      return;
    }
    box.innerHTML = rows.map(r =>
      '<div class="item"><div class="l">'
      + '<div class="nm">' + esc(r.name) + ' ' + statusBadge(r.result)
      + ' <span class="badge b-off">' + esc(r.mode) + '</span></div>'
      + '<div class="sub">' + esc(r.startIso) + ' ~ ' + esc(r.endIso) + ' · ' + esc(r.at) + '<br>'
      + '최종 미수 ' + money(r.closing) + ' · 받는사람 ' + esc(r.recipient || '-') + '</div></div>'
      + '<div class="r"><a class="pdf-btn ' + (r.pdfUrl ? '' : 'off') + '" href="' + esc(r.pdfUrl || '#') + '" target="_blank" rel="noopener">📄 PDF 열기</a></div>'
      + '</div>').join('');
  } catch (e) {
    box.innerHTML = '<div class="picker-empty" style="color:#fca5a5">' + esc(e.message) + '</div>';
  }
}

/* ------------------------------------------------------------------
   12. 탭 전환
   ------------------------------------------------------------------ */
function initTabs() {
  $$('.tab').forEach(t => {
    t.addEventListener('click', () => {
      $$('.tab').forEach(x => x.classList.remove('on'));
      t.classList.add('on');
      $$('.pane').forEach(p => p.classList.add('hide'));
      const pane = $(t.dataset.pane);
      if (pane) pane.classList.remove('hide');
      if (t.dataset.pane === 'paneHistory') loadHistory();
      if (t.dataset.pane === 'paneRegular') loadRegular();
    });
  });
}

/* ------------------------------------------------------------------
   13. 초기화
   ------------------------------------------------------------------ */
(async function init() {
  await loadConfig();
  await applyBranding();
  initTabs();
  initCurrent();
  initPeriod();

  $('perStart').value = isoShift(-30);
  $('perEnd').value = isoToday();

  if (ST.cfgMissing && $('cfgWarn')) {
    $('cfgWarn').classList.remove('hide');
  }

  $('btnRegReload').addEventListener('click', loadRegular);
  $('btnHisLoad').addEventListener('click', loadHistory);
  $('hisKind').addEventListener('change', loadHistory);
  $('hisMode').addEventListener('change', loadHistory);

  /* 수동 실행(재발송용) — 접힌 영역 안에만 존재 */
  if ($('btnRegRun')) {
    $('btnRegRun').addEventListener('click', async () => {
      const btn = $('btnRegRun');
      if (!confirm('정기 원장을 지금 수동으로 발송할까요?\n\n· 정상 발송은 매월 말일 오전 9시에 자동으로 나갑니다.\n· 이 버튼은 "자동 발송을 놓쳤을 때" 또는 "새 거래처를 추가했을 때" 쓰는 재발송 버튼입니다.\n· 체크된 모든 거래처에 지금 즉시 나갑니다.')) return;
      setBusy(btn, true, '실행 중');
      try {
        const out = await gas({ action: 'runRegular' });
        if (!out.ok) throw new Error(out.error || '실행 실패');
        showMsg('msgReg', out.summary || '실행 완료', out.failed ? 'err' : 'ok');
        loadRegular();
        loadHistory();
      } catch (e) {
        showMsg('msgReg', e.message, 'err');
      } finally { setBusy(btn, false); }
    });
  }

  if (ST.url) {
    const ok = await connect(true);
    if (ok) loadRegular();
  } else {
    pill('err', '주소 없음');
  }
})();
