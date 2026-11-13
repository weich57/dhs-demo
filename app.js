/* ==========================================================
   乡邻帮 · 数字乡村服务平台（前端演示）
   ----------------------------------------------------------
   仅使用原生 JS，无构建依赖，直接双击 index.html 即可运行。
   ========================================================== */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const money = (n) => n.toLocaleString('zh-CN', { maximumFractionDigits: 0 });

/* ---------------- 定位系统 ---------------- */
// 订单发起地（平谷区大华山村桃园）
const FARM_GEO = { lat: 40.3521, lng: 117.1125, label: '大华山村 · 桃园' };

// 三个接单方的真实位置（经度、纬度）
const BROKER_GEO = [
  { id: 'u1', name: '李强', org: '鲜果电商', lat: 40.3987, lng: 117.0023, label: '大华山镇 · 鲜果电商中心' },
  { id: 'u2', name: '王芳', org: '果蔬合作社', lat: 40.3745, lng: 116.9877, label: '邻村 · 果蔬合作社' },
  { id: 'u3', name: '张伟', org: '电商服务站', lat: 40.3692, lng: 117.0128, label: '镇级站点 · 电商服务站' }
];

// 端上"我"的当前位置（接单方视角）—— 用户可见、可改
let currentGeo = { ...BROKER_GEO[0], idx: 0, source: 'user' };

// 后台原始定位日志（仅平台可见）—— 每次系统拿到的真实坐标都会记一条
const rawGeoLog = [];

function haversine(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function scoreFromKm(km) {
  if (km <= 1) return 100;
  if (km >= 15) return 50;
  return Math.round(100 - ((km - 1) / 14) * 50);
}

function fmtCoord(g) {
  return `lng ${g.lng.toFixed(5)} · lat ${g.lat.toFixed(5)}`;
}

function fmtKm(km) {
  return km < 0.95 ? `${Math.round(km * 1000)} 米` : `${km.toFixed(1)} 公里`;
}

function fmtTime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 模拟系统定位（每次调用返回略微抖动的真实坐标）
function fakeSystemGeo() {
  const base = BROKER_GEO[currentGeo.idx] || BROKER_GEO[0];
  return {
    lat: +(base.lat + (Math.random() - 0.5) * 0.0025).toFixed(6),
    lng: +(base.lng + (Math.random() - 0.5) * 0.0025).toFixed(6),
    accuracy: Math.round(18 + Math.random() * 40) + 'm',
    ts: new Date()
  };
}

function pushSysLog() {
  const g = fakeSystemGeo();
  rawGeoLog.push({ ...g, source: 'sys' });
  // 后台逻辑：即便用户改了上报坐标，系统原始定位仍然记录
}

function pushUserLog(g) {
  rawGeoLog.push({ ...g, ts: new Date(), source: 'user' });
}

/* ---------------- 视图切换 ---------------- */
const VIEWS = ['home', 'industry', 'sell', 'dispatch', 'money', 'order', 'provider', 'login', 'account', 'placeholder'];
const NAV_MAP = { home: 0, industry: 1, sell: 1, dispatch: 1, money: 2, order: 3, provider: 4 };

function go(name, opts = {}) {
  if (!VIEWS.includes(name)) return;

  VIEWS.forEach((v) => {
    const el = $('#view-' + v);
    if (el) el.classList.toggle('active', v === name);
  });

  // 导航高亮
  $$('.nav-link').forEach((l, i) => {
    l.classList.toggle('active', NAV_MAP[name] === i);
  });

  window.scrollTo({ top: 0, behavior: opts.noScroll ? 'auto' : 'instant' });

  if (name === 'sell') resetWizard();
  if (name === 'order') renderOrder();
  if (name === 'dispatch') runDispatch();
  if (name === 'money') renderEscrow(escrowStage);
  if (name === 'account') renderAccount();
}

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-go]');
  if (!target) return;
  e.preventDefault();

  const to = target.dataset.go;
  if (to === 'how') {
    go('home', { noScroll: true });
    setTimeout(() => $('#how')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    return;
  }
  if (to === 'placeholder') {
    const sector = target.dataset.sector || 'people';
    fillPlaceholder(sector);
    go('placeholder');
    return;
  }
  go(to);
});

/* ---------------- Toast ---------------- */
let toastTimer = null;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ---------------- 资金安全 · 托管 ---------------- */
const ESCROW_TOTAL = 86400;

const MONEY_STAGES = [
  {
    t: '买家下单付款',
    d: '钱还在买家手里，没进平台，谁也拿不到。',
    escrow: 0, paid: 0,
    who: '钱还在买家手上',
    sub: '买家挑好货、下单，货款还没付。这一步谁都不用担心。',
    trigger: '买家确认下单'
  },
  {
    t: '货款进银行专户',
    d: '86,400 元全额进存管专户，接单方和平台都动不了。',
    escrow: 86400, paid: 0,
    who: '银行存管专户 86,400 元',
    sub: '钱在银行，不在任何个人卡里。平台只有「按规则放款」的指令，没有挪用权。',
    trigger: '买家付款'
  },
  {
    t: '分拣点验货通过 · 放 20%',
    d: '村分拣点统一称重、拍照、封箱贴标后放行，解冻 17,280 元。',
    escrow: 69120, paid: 17280,
    who: '专户 69,120 元 · 已放 17,280 元',
    sub: '这 20% 先给接单方，用于包装、冷链等已经花出去的成本。',
    trigger: '村分拣点验货通过'
  },
  {
    t: '买家确认收货 · 放 60%',
    d: '买家开箱拍照确认，坏果已按包赔处理，再解冻 51,840 元。',
    escrow: 17280, paid: 69120,
    who: '专户 17,280 元 · 已放 69,120 元',
    sub: '大头货款到农户手里，剩 20% 留作售后保证金。',
    trigger: '买家开箱确认收货'
  },
  {
    t: '售后期满 · 放 20%',
    d: '7 天没人提异议，最后 17,280 元结清。',
    escrow: 0, paid: 86400,
    who: '全部结清，一分不欠',
    sub: '最终分账：农户 66,016 元 · 服务与佣金 17,792 元 · 平台服务费 2,592 元。',
    trigger: '售后 7 天无争议'
  }
];

let escrowStage = 1;

function renderEscrow(idx) {
  escrowStage = idx;
  const box = $('#escrowSteps');
  if (!box) return;

  box.innerHTML = MONEY_STAGES.map((s, i) => `
    <button class="es-step ${i === idx ? 'active' : ''} ${i < idx ? 'done' : ''}" data-stage="${i}">
      <span class="es-no">${i + 1}</span>
      <span class="es-body">
        <p class="es-title">${s.t}</p>
        <p class="es-desc">${s.d}</p>
      </span>
      <span class="es-amt">${s.escrow ? money(s.escrow) : '—'}<small>${s.escrow ? '托管中' : ''}</small></span>
    </button>`).join('');

  const s = MONEY_STAGES[idx];
  $('#escrowWho').innerHTML =
    `<div class="lbl">钱在谁手上</div><div class="big">${s.who}</div><div class="sub">${s.sub}</div>`;

  $('#holdEscrow').textContent = money(s.escrow) + ' 元';
  $('#holdPaid').textContent = money(s.paid) + ' 元';

  $('#escrowDetail').innerHTML = [
    ['货款合计', `${money(ESCROW_TOTAL)} 元`],
    ['银行专户托管中', `${money(s.escrow)} 元`],
    ['已验货放款', `${money(s.paid)} 元`],
    ['触发条件', s.trigger]
  ].map(([k, v]) => `<div class="money-row"><span>${k}</span><span class="v">${v}</span></div>`).join('');
}

$('#escrowSteps')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-stage]');
  if (b) renderEscrow(Number(b.dataset.stage));
});

/* ---------------- 板块 Tab ---------------- */
$$('#industryTabs .tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('#industryTabs .tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    $$('.tab-panel').forEach((p) => {
      p.hidden = p.dataset.panel !== tab.dataset.tab;
    });
  });
});

/* ---------------- 帮卖表单 ---------------- */
const st = {
  step: 1,
  services: new Set(['pack', 'cold'])
};

const SERVICE_INFO = {
  pack: { name: '分级包装', per: 0.35 },
  cold: { name: '冷链运输', per: 0.60 },
  live: { name: '数字人直播', pct: 0.01 },
  market: { name: '商超对接', pct: 0.02 }
};

function readForm() {
  const qty = parseFloat($('#f-qty').value) || 0;
  const unit = $('#f-unit').value;
  const price = parseFloat($('#f-price').value) || 0;
  return {
    product: $('#f-product').value,
    qty,
    unit,
    price,
    village: $('#f-village').value,
    note: $('#f-note').value.trim(),
    jin: unit === '吨' ? qty * 2000 : qty
  };
}

function calcBill(f) {
  const gross = f.jin * f.price;
  const platform = gross * 0.03;
  let services = 0;
  const detail = [];
  st.services.forEach((k) => {
    const info = SERVICE_INFO[k];
    const amount = info.per ? f.jin * info.per : gross * info.pct;
    services += amount;
    detail.push({ key: k, name: info.name, amount });
  });
  return {
    gross,
    platform,
    services,
    detail,
    net: gross - platform - services
  };
}

function resetWizard() {
  st.step = 1;
  $$('.wstep').forEach((w) => (w.hidden = w.dataset.step !== '1'));
  $$('.stp').forEach((s) => {
    const n = Number(s.dataset.stp);
    s.classList.toggle('now', n === 1);
    s.classList.remove('done');
  });
  $('#wPrev').hidden = true;
  $('#wNext').textContent = '下一步';
  $$('.chip', $('#serviceChips')).forEach((c) => {
    c.classList.toggle('on', st.services.has(c.dataset.svc));
  });
}

function setStep(n) {
  st.step = n;
  $$('.wstep').forEach((w) => (w.hidden = w.dataset.step !== String(n)));
  $$('.stp').forEach((s) => {
    const i = Number(s.dataset.stp);
    s.classList.toggle('now', i === n);
    s.classList.toggle('done', i < n);
    if (i < n) s.querySelector('.c').textContent = '✓';
    else s.querySelector('.c').textContent = i;
  });
  $('#wPrev').hidden = n === 1;
  $('#wNext').textContent = n === 3 ? '提交并派单' : '下一步';
  if (n === 3) renderSummary();
}

$$('.chip', $('#serviceChips')).forEach((chip) => {
  chip.addEventListener('click', () => {
    const k = chip.dataset.svc;
    if (st.services.has(k)) st.services.delete(k);
    else st.services.add(k);
    chip.classList.toggle('on', st.services.has(k));
    if (st.step === 3) renderSummary();
  });
});

$('#wPrev').addEventListener('click', () => setStep(Math.max(1, st.step - 1)));

$('#wNext').addEventListener('click', () => {
  if (st.step === 1) {
    const f = readForm();
    if (!f.qty || f.qty <= 0) return toast('请填写可出货数量');
    if (!f.price || f.price <= 0) return toast('请填写保底价');
    setStep(2);
    return;
  }
  if (st.step === 2) {
    if (st.services.size === 0) {
      st.services.add('pack');
      $$('.chip', $('#serviceChips')).forEach((c) => {
        if (c.dataset.svc === 'pack') c.classList.add('on');
      });
      toast('已默认选上「分级包装」，散装货不好卖');
    }
    setStep(3);
    return;
  }
  // 提交
  createOrder();
  go('dispatch');
});

function renderSummary() {
  const f = readForm();
  const b = calcBill(f);
  const rows = [
    ['产品', `${f.product} · ${f.qty} ${f.unit}（约 ${money(f.jin)} 斤）`],
    ['保底价', `${f.price} 元/斤（价低不自动成交）`],
    ['产地', f.village],
    ['预计成交额', `${money(b.gross)} 元`],
    ['平台服务费 3%', `- ${money(b.platform)} 元`]
  ];
  b.detail.forEach((d) => rows.push([d.name, `- ${money(d.amount)} 元`]));
  rows.push(['预计到手', `${money(b.net)} 元`]);

  $('#summaryBox').innerHTML = rows
    .map(([k, v], i) => {
      const cls = i === rows.length - 1 ? 'sum-row total' : i >= 3 ? 'sum-row dim' : 'sum-row';
      return `<div class="${cls}"><span>${k}</span><span class="v">${v}</span></div>`;
    })
    .join('');
}

/* ---------------- 订单数据 ---------------- */
let order = null;

function createOrder() {
  const f = readForm();
  const b = calcBill(f);
  order = {
    no: 'BM' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '012',
    product: f.product,
    qty: f.qty,
    unit: f.unit,
    jin: f.jin,
    price: f.price,
    village: f.village,
    note: f.note,
    bill: b,
    services: Array.from(st.services),
    step: 3,           // 已完成节点数
    settled: false
  };
}

if (!order) {
  // 首次进入「我的订单」时给一条演示订单，保证导航随时可用
  order = null;
}

function ensureOrder() {
  if (!order) {
    const f = { product: '大桃', qty: 8, unit: '吨', price: 5.4, village: '大华山村', note: '', jin: 8 * 2000 };
    st.services = new Set(['pack', 'cold', 'live']);
    order = {
      no: 'BM20261105001',
      product: '大桃',
      qty: 8,
      unit: '吨',
      jin: 16000,
      price: 5.4,
      village: '大华山村',
      note: '',
      bill: calcBill(f),
      services: ['pack', 'cold', 'live'],
      step: 3,
      settled: false
    };
  }
}

/* ---------------- 派单 ---------------- */
// 技能/信用/负载/价格 四个非距离维度是接单方自身属性，固定不变
const BASE_DIMS = [
  { skill: 98, credit: 97, load: 88, price: 92, credit92: 96, order30: 38, tags: ['信用 96', '好评 98%', '自带直播间'], note: '擅长桃类，3 天内可完成分级、上架与直播' },
  { skill: 86, credit: 92, load: 95, price: 84, credit92: 92, order30: 22, tags: ['信用 92', '有冷藏库', '走商超'], note: '冷链与分拣能力强，直播偏弱' },
  { skill: 90, credit: 89, load: 62, price: 88, credit92: 89, order30: 41, tags: ['信用 89', '单量最多', '手上较忙'], note: '订单已排到 5 天后，本期负载扣分较多' }
];

const BROKERS_BASE = [
  { name: '李强', org: '鲜果电商', av: '' },
  { name: '王芳', org: '果蔬合作社', av: 'alt' },
  { name: '张伟', org: '电商服务站', av: 'alt2' }
];

// 实时重算 BROKERS：距离 + 匹配度 + meta
function recomputeBrokers() {
  BROKERS = BROKERS_BASE.map((b, i) => {
    const g = BROKER_GEO[i];
    const km = haversine(g, FARM_GEO);
    const distScore = scoreFromKm(km);
    const d0 = BASE_DIMS[i];
    const dims = [
      ['技能', d0.skill],
      ['距离', distScore],
      ['信用', d0.credit],
      ['负载', d0.load],
      ['价格', d0.price]
    ];
    const score = Math.round(
      d0.skill * 0.30 + distScore * 0.25 + d0.credit * 0.20 + d0.load * 0.15 + d0.price * 0.10
    );
    return {
      ...b,
      idx: i,
      brokerGeo: g,
      km,
      score,
      distScore,
      meta: `${g.label.split(' · ')[0]} · 距大华山村 ${fmtKm(km)} · 近 30 天 ${d0.order30} 单`,
      tags: d0.tags,
      dims,
      note: d0.note
    };
  }).sort((a, b) => b.score - a.score);
  BROKERS.forEach((b) => (b.rec = b === BROKERS[0]));
}
let BROKERS = [];
recomputeBrokers();

function runDispatch() {
  ensureOrder();
  $('#dispatchLoading').hidden = false;
  $('#dispatchResult').hidden = true;

  // 每次派单都记一次系统定位（后台隐藏）
  pushSysLog();

  // 重算距离
  recomputeBrokers();
  updateDispatchGeoUI();

  // 摘要
  const b = order.bill;
  $('#dispatchSummary').innerHTML = [
    ['产品', `${order.product} · ${order.qty} ${order.unit}`],
    ['产地', order.village],
    ['保底价', `${order.price} 元/斤`],
    ['预计成交', `${money(b.gross)} 元`],
    ['平台服务费', `${money(b.platform)} 元`]
  ].map(([k, v]) => `<div class="money-row"><span>${k}</span><span class="v">${v}</span></div>`).join('');

  const top = BROKERS[0];
  const bars = {
    barSkill: top.dims[0][1],
    barDist: top.dims[1][1],
    barCredit: top.dims[2][1],
    barLoad: top.dims[3][1],
    barPrice: top.dims[4][1]
  };
  Object.keys(bars).forEach((id) => ($('#' + id).style.width = '0%'));

  setTimeout(() => {
    Object.entries(bars).forEach(([id, v], i) => {
      setTimeout(() => {
        const el = $('#' + id);
        if (el) {
          el.style.width = v + '%';
          el.classList.remove('dist-changed');
          // 距离条如果跟上次不一样就闪一下
          if (id === 'barDist') {
            el.classList.add('dist-changed');
            setTimeout(() => el.classList.remove('dist-changed'), 460);
          }
        }
      }, i * 120);
    });
  }, 120);

  setTimeout(() => {
    $('#dispatchLoading').hidden = true;
    $('#dispatchResult').hidden = false;
    renderCandidates();
    renderGeoLog();
  }, 1650);
}

function updateDispatchGeoUI() {
  const farmKm = haversine(currentGeo, FARM_GEO);
  $('#dispatchGeoLabel').textContent = `当前定位：${currentGeo.label}${currentGeo.source === 'user' ? '（上报）' : ''}`;
  $('#dispatchGeoCoord').textContent = `${fmtCoord(currentGeo)}　距 ${FARM_GEO.label} ${fmtKm(farmKm)}`;
}

function renderCandidates() {
  const box = $('#candidates');
  box.innerHTML = BROKERS.map((b, i) => `
    <div class="broker ${b.rec ? 'rec' : ''}">
      <div class="avatar ${b.av}">${b.name[0]}</div>
      <div class="broker-main">
        <p class="broker-name">${b.name} · ${b.org} ${b.rec ? '<span class="badge gold" style="margin-left:6px">推荐</span>' : ''}</p>
        <div class="broker-meta">${b.meta}</div>
        <div class="broker-tags">${b.tags.map((t) => `<span class="badge">${t}</span>`).join('')}</div>
        <div class="broker-tags" style="margin-top:8px">
          ${b.dims.map(([k, v]) => `<span style="font-size:11px;color:#8c9a90">${k} ${v}</span>`).join('<span style="color:#d8d3c4">·</span>')}
        </div>
      </div>
      <div class="score">
        <div class="num">${b.score}<small>分</small></div>
        <div class="lbl">匹配度</div>
        <button class="btn ${b.rec ? 'btn-dark' : 'btn-ghost'} btn-sm" style="margin-top:8px" data-assign="${i}">
          ${b.rec ? '派给他' : '改派'}
        </button>
      </div>
    </div>
  `).join('');

  $$('[data-assign]', box).forEach((btn) => {
    btn.addEventListener('click', () => {
      const b = BROKERS[Number(btn.dataset.assign)];
      ensureOrder();
      order.brokerName = b.name;
      order.step = 3;
      toast(`已派单给 ${b.name} · ${b.org}`);
      go('order');
    });
  });
}

/* ---------------- 订单渲染 ---------------- */
const ORDER_STEPS = [
  ['发布报货', '11-05 09:12', '农户张建国发布：大桃 8 吨，保底 5.4 元/斤，11-08 采收'],
  ['平台派单', '11-05 09:15', '按技能、距离、信用、订单量、价格打分，推荐李强 · 鲜果电商（96 分）'],
  ['接单方接单', '11-05 09:26', '李强接单，约定 11-08 上午上门看货'],
  ['上门看货', '11-08 08:30', '现场确认果径、损耗与分级比例，双方签字'],
  ['分级包装', '11-08 11:20', '分装 500 箱，贴一物一码，等待分拣点验货'],
  ['村分拣点验货', '11-08 14:05', '分拣点统一抽检、过磅 8,012 斤、封箱贴标 SL-8842-0117 并拍照；通过后解冻 20%'],
  ['冷链运输', '11-09 07:30', '全程 0–4℃ 温控，运输轨迹可查'],
  ['买家开箱收货 · 坏果包赔', '11-09 09:40', '买家开箱拍照上传，6 个坏果从托管尾款包赔；确认收货再解冻 60%'],
  ['售后期满 · 结清', '11-16 09:40', '7 天无争议，尾款解冻，货款全部到账']
];

// 订单进度 → 托管阶段（0–4）
function escrowStageFor(done) {
  if (done <= 1) return 0;
  if (done <= 5) return 1;
  if (done <= 7) return 2;
  if (done === 8) return 3;
  return 4;
}

function renderOrder() {
  ensureOrder();
  const o = order;

  $('#orderNo').textContent = `订单 #${o.no} · ${o.product}帮卖`;
  $('#orderMeta').textContent =
    `${o.village} · ${o.qty} ${o.unit} · 保底 ${o.price} 元/斤 · ${o.note || '11 月 8 日采收'}`;

  const done = o.step;
  const allDone = done >= ORDER_STEPS.length;

  $('#orderStatus').textContent = o.settled ? '已结清' : allDone ? '待结清' : '进行中';
  $('#orderStatus').className = 'badge ' + (o.settled ? '' : 'gold');

  $('#timeline').innerHTML = ORDER_STEPS.map((s, i) => {
    const state = i < done ? 'done' : i === done ? 'now' : '';
    return `
      <div class="tl-item ${state}">
        <div class="tl-time">${s[1]}</div>
        <p class="tl-title">${s[0]}</p>
        <p class="tl-desc">${s[2]}</p>
      </div>`;
  }).join('');

  // 订单顶部的托管条（最后一段要等用户确认结清才放）
  const stageIdx = o.settled ? 4 : done >= 9 ? 3 : escrowStageFor(done);
  const stg = MONEY_STAGES[stageIdx];
  const nextLabel = o.settled ? '已结清' : done >= 9 ? '待确认结清' : done < 6 ? '分拣点验货' : done < 8 ? '买家确认收货' : '售后期满';
  const banner = $('#escrowBanner');
  banner.classList.toggle('done', o.settled);
  banner.innerHTML = `
    <div class="eb-item">银行专户托管中<b>${money(stg.escrow)} 元</b></div>
    <div class="eb-sep"></div>
    <div class="eb-item">已验货放款<b>${money(stg.paid)} 元</b></div>
    <div class="eb-sep"></div>
    <div class="eb-item ${o.settled ? '' : 'warn'}">下一次放款<b>${nextLabel}</b></div>
    <div class="eb-note">钱不在接单方手里，也不在平台自己账上</div>`;

  const b = o.bill;
  const rows = [
    ['成交额', `${money(b.gross)} 元`],
    ['已验货放款（累计）', `${money(stg.paid)} 元`],
    ['银行专户托管中', `${money(stg.escrow)} 元`],
    ['平台服务费 3%', `- ${money(b.platform)} 元`],
    ['农户预计实收', `${money(b.net)} 元`]
  ];

  $('#orderMoney').innerHTML = rows
    .map(([k, v], i) => `<div class="money-row ${i === rows.length - 1 ? 'total' : ''}"><span>${k}</span><span class="v">${v}</span></div>`)
    .join('');

  const canSettle = allDone && !o.settled;
  $('#settleBtn').disabled = !canSettle;
  $('#settleBtn').textContent = o.settled ? '已结清' : '确认收货、结清尾款';
  $('#settleHint').textContent = o.settled
    ? '尾款已结清，凭证存进订单档案'
    : allDone ? '售后期满、无争议，可以结清尾款'
    : done >= 8 ? '买家已确认收货，售后期满后结清'
    : '收货验货通过、售后期满后才能结清';

  $('#advanceBtn').disabled = allDone;
  $('#advanceBtn').style.opacity = allDone ? 0.4 : 1;

  // 验货存证：没走到的那一次先置灰
  [['#inspectA', 6], ['#inspectB', 8]].forEach(([sel, need]) => {
    const el = $(sel);
    if (!el) return;
    const ok = done >= need;
    el.classList.toggle('pending', !ok);
    const seal = $('[data-seal]', el);
    seal.textContent = ok ? '已完成 · 已存证' : '待进行';
    seal.classList.toggle('ok', ok);
  });

  // 接单方卡片名字
  const bd = BROKERS.find((x) => x.name === (o.brokerName || '李强')) || BROKERS[0];
  const brokerBox = $('.card .broker', $('#view-order'));
  if (brokerBox) {
    $('.broker-name', brokerBox).textContent = `${bd.name} · ${bd.org}`;
    $('.broker-meta', brokerBox).textContent = bd.meta;
    $('.avatar', brokerBox).textContent = bd.name[0];
  }
}

$('#advanceBtn').addEventListener('click', () => {
  ensureOrder();
  if (order.step >= ORDER_STEPS.length) return;
  order.step += 1;
  renderOrder();

  const msg = {
    4: '接单方已上门看货，开始分级包装',
    6: '分拣点验货通过：称重拍照已存档，解冻 20%（17,280 元）',
    8: '买家开箱确认：坏果已包赔，再解冻 60%',
    9: '售后期满，尾款可以结清了'
  }[order.step];
  if (msg) toast(msg, 3200);
});

$('#settleBtn').addEventListener('click', () => {
  ensureOrder();
  if (order.settled) return;
  order.settled = true;
  renderOrder();
  toast(`尾款已结清：农户实收 ${money(order.bill.net)} 元，凭证存进订单档案`, 3400);
});

/* ---------------- 接单端 ---------------- */
$('#poAccept')?.addEventListener('click', () => {
  $('#poNew').hidden = true;
  $('#poAccepted').hidden = false;
  toast('已接单，请 2 小时内联系农户');
});

$('#poReject')?.addEventListener('click', () => {
  toast('已拒绝，订单将顺延给下一位接单方');
});

/* ---------------- 其他板块占位 ---------------- */
const SECTORS = {
  people: {
    title: '民生服务',
    sub: '面向老人、儿童、特殊群体与普通农户的上门服务。正在开通，开通后复用同一套派单、验货与放款机制。',
    head: '正在开通 · 可先了解',
    desc: '这一板块解决的是「村里谁需要人照顾、谁来照顾、做完怎么证明」。共 9 项服务，与产业带动共用订单池和信用体系，不另建一套系统。',
    list: ['老人助餐与送餐：按次派单，村食堂或助餐点接单', '上门助浴、日常照护：服务包定价，全程留痕', '留守儿童陪伴与课业辅导：按周排班，家长可查', '代取药品、陪诊就医：跑腿与陪护分开计价', '健康随访与用药提醒：村医接单，异常自动上报', '代办跑腿：社保、医保、快递代取代送']
  },
  eco: {
    title: '生态文明',
    sub: '村庄保洁、垃圾清运、河道与绿化管护。正在开通，之后按片区打包给服务队。',
    head: '正在开通 · 可先了解',
    desc: '把「谁扫、扫到哪、扫得怎么样」变成可查的记录，考核与付费有据可依。共 7 项服务。',
    list: ['村庄保洁：按网格派单，拍照打卡留痕', '垃圾清运：按趟计费，路线可追溯', '河道与绿化管护：季节性任务包', '公厕管护与消杀：按频次考核', '秸秆与农业废弃物处理：按吨结算', '人居环境考核：自动生成月度评分']
  },
  gov: {
    title: '科学治理',
    sub: '治安巡逻、隐患排查、矛盾调解、村务公开与村报。正在开通，之后与镇级平台对接。',
    head: '正在开通 · 可先了解',
    desc: '治理类需求不走交易，但同样需要「谁去、去了没有、发现了什么」的记录，这部分复用平台的履约留痕能力。共 7 项服务。',
    list: ['治安巡逻：排班 + 轨迹 + 事件上报', '隐患排查：清单化，整改闭环', '应急处突：一键召集，就近调度', '重点人群走访：台账 + 定期回访', '矛盾调解：受理、派单、回访全留痕', '村务公开与村报：定期推送，可追溯']
  },
  land: {
    title: '创新发展',
    sub: '土地流转、闲置农房盘活、乡村建设与新型业态。正在开通，从土地档案做起。',
    head: '正在开通 · 可先了解',
    desc: '先把地块档案建起来（在产业带动的数据里已经起步），再做流转撮合、项目用工与业态引入。共 7 项服务。',
    list: ['土地流转：地块档案 + 意向撮合', '地块测绘与确权数据：一次测绘，多方复用', '闲置农房盘活：房源台账 + 改造托管', '乡村建设项目与用工：进度派单、按工种结算', '订单农业与农技推广：先有订单再扩种', '新业态引入：民宿、研学、乡村文旅']
  }
};

function fillPlaceholder(key) {
  const d = SECTORS[key] || SECTORS.people;
  $('#phTitle').textContent = d.title;
  $('#phCrumb').textContent = d.title;
  $('#phSub').textContent = d.sub;
  $('#phHead').textContent = d.head;
  $('#phDesc').textContent = d.desc;
  $('#phList').innerHTML = d.list.map((x) => `<div>${x}</div>`).join('');
}

/* ---------------- 接单端定位栏 ---------------- */
function updatePhoneGeoUI() {
  // 更新接单端手机里的所有定位相关文字
  $('#phoneGeoLabel').textContent = currentGeo.label;
  $('#phoneGreeting').textContent = `${currentGeo.name}，有 1 个新订单派给你`;

  // 订单卡上的"距你 X 公里"：从 currentGeo 到 FARM_GEO
  const farmKm = haversine(currentGeo, FARM_GEO);
  $('#phoneOrderMeta').innerHTML =
    `${FARM_GEO.label} · 距你 ${fmtKm(farmKm)}<br>` +
    `保底 5.4 元/斤 · 预估成交 86,400 元<br>` +
    `需要：分级包装 + 冷链运输 + 直播带货`;

  // picker 里 active 态
  $$('.geo-picker .gp-row').forEach((row) => {
    const idx = Number(row.dataset.geo);
    row.classList.toggle('active', idx === currentGeo.idx);
    row.querySelector('.gp-sub').textContent =
      `${BROKER_GEO[idx].label} · 距 ${FARM_GEO.label} ${fmtKm(haversine(BROKER_GEO[idx], FARM_GEO))}`;
  });

  // 派单雷达页 geo-card
  updateDispatchGeoUI();
}

function applyGeoPreset(idx) {
  const g = BROKER_GEO[idx];
  currentGeo = { ...g, idx, source: 'user' };
  pushUserLog({ ...g, ts: new Date() });
  toast(`已切换到 ${g.label}`);
  updatePhoneGeoUI();

  // 派单雷达页如果已经展开，重新跑派单让距离分数更新
  const dispatchVisible = !$('#view-dispatch').classList.contains('active');
  // 只要派单页可能被看到，就记一次系统定位并准备重算
  pushSysLog();
  if ($('#dispatchLoading') && !$('#dispatchLoading').hidden) {
    recomputeBrokers();
    const top = BROKERS[0];
    $('#barDist').style.width = top.dims[1][1] + '%';
  }
}

// 接单端 picker 展开/收起
$('#phoneGeoBar')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const p = $('#phoneGeoPicker');
  p.hidden = !p.hidden;
});

document.addEventListener('click', (e) => {
  if (!$('#phoneGeoPicker')) return;
  if (!$('#phoneGeoPicker').contains(e.target) && !$('#phoneGeoBar').contains(e.target)) {
    $('#phoneGeoPicker').hidden = true;
  }
});

// 三个预设位置
$$('.geo-picker .gp-row').forEach((row) => {
  row.addEventListener('click', () => {
    applyGeoPreset(Number(row.dataset.geo));
  });
});

// 手动坐标
$('#applyCustomGeo')?.addEventListener('click', () => {
  const lng = parseFloat($('#lngInput').value);
  const lat = parseFloat($('#latInput').value);
  if (isNaN(lng) || isNaN(lat)) return toast('请填写有效坐标');
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return toast('坐标范围不对');
  const idx = currentGeo.idx;
  currentGeo = { lat, lng, name: BROKER_GEO[idx].name, org: BROKER_GEO[idx].org, label: `自定义位置 (${lng.toFixed(3)}, ${lat.toFixed(3)})`, idx, source: 'user' };
  pushUserLog({ lat, lng, ts: new Date(), accuracy: '手动上报' });
  toast('已应用自定义坐标');
  $('#phoneGeoPicker').hidden = true;
  $('#lngInput').value = '';
  $('#latInput').value = '';
  updatePhoneGeoUI();
});

// 派单雷达页"改一下"按钮 —— 复用同一个 picker 的状态
$('#dispatchGeoBtn')?.addEventListener('click', () => {
  // 模拟系统再定位一次（后台）
  pushSysLog();
  // 轮播切到下一个预设，展示效果
  const nextIdx = (currentGeo.idx + 1) % 3;
  applyGeoPreset(nextIdx);
  // 立即重跑派单
  runDispatch();
});

/* ---------------- 后台原始定位日志 ---------------- */
function renderGeoLog() {
  const box = $('#geoLogRows');
  if (!box) return;
  box.innerHTML = rawGeoLog.slice(-8).map((g) => {
    const srcCls = g.source === 'sys' ? 'sys' : 'usr';
    const srcTxt = g.source === 'sys'
      ? `设备返回 · 精度 ${g.accuracy || '—'}`
      : `用户上报 · ${g.accuracy || '手动'}`;
    return `<div class="gl-row">
      <span class="gl-ts">${fmtTime(g.ts)}</span>
      <span class="gl-coord">lng ${g.lng.toFixed(5)} · lat ${g.lat.toFixed(5)}</span>
      <span class="gl-src ${srcCls}">${srcTxt}</span>
    </div>`;
  }).join('');
}

$('#geoLogHead')?.addEventListener('click', () => {
  const head = $('#geoLogHead');
  const body = $('#geoLogBody');
  const open = !head.classList.contains('open');
  head.classList.toggle('open', open);
  body.classList.toggle('open', open);
  if (open) renderGeoLog();
});

/* ---------------- 初始化 ---------------- */
resetWizard();
renderEscrow(escrowStage);
renderOrder();

// 启动时先 fake 两次系统定位，让后台日志有东西可看
pushSysLog();
setTimeout(() => pushSysLog(), 900);
setTimeout(() => { pushSysLog(); renderGeoLog(); }, 1900);

updatePhoneGeoUI();
updateDispatchGeoUI();

/* ---------------- 登录 / 账户（演示） ---------------- */
let loginRole = null; // 'user' | 'village' | null
let loginName = '';

// 村集体台账（示例数据）
const VILLAGE_LEDGER = [
  { name: '张大山', item: '大桃 · 12 装 × 300 箱', amt: 18400, state: '托管中', stage: '分拣验货已过 · 待放 20%' },
  { name: '李秀兰', item: '大桃 · 9 装 × 500 箱', amt: 24500, state: '已放款 60%', stage: '买家已确认收货' },
  { name: '王建国', item: '大桃 · 6 装 × 800 箱', amt: 19600, state: '已结清', stage: '售后期满 · 无争议' },
  { name: '赵桂香', item: '大桃 · 12 装 × 150 箱', amt: 9200, state: '赔付处理中', stage: '坏果 3 箱 · 从尾款赔' },
  { name: '刘志强', item: '大桃 · 9 装 × 400 箱', amt: 19600, state: '已放款 20%', stage: '分拣验货通过' }
];

function updateLoginBtn() {
  const btn = $('#loginBtn');
  if (!btn) return;
  if (loginRole === 'village') { btn.textContent = '村集体账户'; return; }
  if (loginRole === 'user') { btn.textContent = (loginName || '我') + ' · 已实名'; return; }
  btn.textContent = '登录';
}

function doLogin(role) {
  const code = $('#lg-code-' + (role === 'user' ? 1 : 2)).value.trim();
  const name = $('#lg-name-' + (role === 'user' ? 1 : 2)).value.trim();
  if (!/^\d{4}$/.test(code)) { toast('请输入 4 位短信验证码'); return; }
  if (!name) { toast('请填写实名姓名'); return; }
  if (role === 'user' && !/^\d{3,4}[Xx\d]$/.test($('#lg-id-1').value.trim())) { toast('请填写身份证后四位'); return; }
  loginRole = role;
  loginName = name;
  updateLoginBtn();
  toast(role === 'village' ? '村集体账号登录成功（演示）' : '实名登录成功（演示）');
  go('account');
}

function renderAccount() {
  const t = $('#accTitle'), s = $('#accSub');
  const p = $('#accPersonal'), v = $('#accVillage');

  if (!loginRole) {
    t.textContent = '请先登录';
    s.textContent = '用手机号 + 实名登录后，才能查看订单与资金。';
    p.hidden = false; v.hidden = true;
    p.innerHTML = '<div class="card" style="text-align:center;padding:48px 24px"><p class="card-sub" style="margin:0 0 16px">你还没有登录</p><button class="btn btn-primary" data-go="login">去登录</button></div>';
    return;
  }

  if (loginRole === 'user') {
    t.textContent = '我的账户（个人）';
    s.textContent = '实名 ' + loginName + ' · 手机 138****6688';
    p.hidden = false; v.hidden = true;
    p.innerHTML = `
      <div class="card">
        <div class="card-head"><div><h3 class="card-title">我的交易</h3></div><span class="badge">实名认证已通过</span></div>
        <div class="tl-item done"><div class="tl-time">11-08 14:05</div><h5 class="tl-title">大桃 8 吨 · 报货提交</h5><p class="card-sub" style="margin:0">保底价 5.4 元/斤 · 分拣包装 + 冷链 + 数字人直播</p></div>
        <div class="tl-item done" style="margin-top:14px"><div class="tl-time">11-08 14:12</div><h5 class="tl-title">已派单 · 鲜果电商（李强）</h5><p class="card-sub" style="margin:0">预计货款 86,400 元，托管中</p></div>
        <div class="tl-item now" style="margin-top:14px"><div class="tl-time">进行中</div><h5 class="tl-title">分拣点验货已通过 · 待放款 20%</h5><p class="card-sub" style="margin:0">买家确认收货后放 60%，售后期满放最后 20%</p></div>
      </div>`;
    return;
  }

  t.textContent = '村集体账户 · 大华山村';
  s.textContent = '管理员 ' + (loginName || '村委专人') + '。本村所有交易、托管、放款、赔付一屏全见；此数据只有村账号可见。';
  p.hidden = true; v.hidden = false;
  const total = VILLAGE_LEDGER.reduce((a, r) => a + r.amt, 0);
  v.innerHTML = `
    <div class="kpi-strip">
      <div class="kpi"><div class="v">91,300<small>元</small></div><div class="k">托管中 · 待放款</div></div>
      <div class="kpi"><div class="v">${money(total)}<small>元</small></div><div class="k">本月全村交易额</div></div>
      <div class="kpi"><div class="v">5<small>户</small></div><div class="k">在售农户</div></div>
      <div class="kpi"><div class="v">1<small>笔</small></div><div class="k">赔付处理中</div></div>
    </div>
    <div class="card" style="margin-top:18px">
      <div class="card-head"><div><h3 class="card-title">本村交易台账（仅村集体账号可见）</h3></div><span class="badge gold">全量数据</span></div>
      ${VILLAGE_LEDGER.map((r) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:13px 0;border-bottom:1px solid var(--hair)">
          <div>
            <div style="font-weight:600;font-size:14px">${r.name} · <span style="font-weight:400;color:var(--muted)">${r.item}</span></div>
            <div class="card-sub" style="margin:4px 0 0">${r.stage}</div>
          </div>
          <div style="text-align:right">
            <div style="font-family:var(--serif);font-weight:700">${money(r.amt)} 元</div>
            <span class="badge grey" style="margin-top:4px">${r.state}</span>
          </div>
        </div>`).join('')}
      <p class="card-sub" style="margin:14px 0 0">每一行都可点开看详情：托管流水、验货照片、放款记录、争议处理。谁看过、谁导出过，系统都有留痕。</p>
    </div>
    <div class="card" style="background:var(--forest);color:var(--cream);border:none">
      <h3 class="card-title" style="color:#fff">权限怎么分</h3>
      <div class="village-grid">
        <div><div style="font-family:var(--serif);font-size:20px;font-weight:700">个人账号</div><div style="font-size:12px;color:#b6c7b2;margin-top:4px">只看自己的订单和货款，互相看不到</div></div>
        <div><div style="font-family:var(--serif);font-size:20px;font-weight:700">村集体账号</div><div style="font-size:12px;color:#b6c7b2;margin-top:4px">看本村全量交易，专人管理、操作留痕</div></div>
        <div><div style="font-family:var(--serif);font-size:20px;font-weight:700">平台</div><div style="font-size:12px;color:#b6c7b2;margin-top:4px">只做撮合与托管执行，不碰村里数据的管理权</div></div>
      </div>
    </div>`;
}

// 登录事件
document.addEventListener('click', (e) => {
  if (e.target.id === 'doLoginUser') doLogin('user');
  if (e.target.id === 'doLoginVillage') doLogin('village');
  if (e.target.id === 'sendCode1' || e.target.id === 'sendCode2') toast('验证码已发送（演示：任填 4 位数字）');
});

// 复制链接演示
document.addEventListener('click', (e) => {
  if (e.target.id !== 'copyLinkBtn') return;
  // http(s) 打开时用当前域名；双击 file:// 打开时用公网演示地址
  const link = location.protocol.startsWith('http')
    ? location.origin + '/buy.html'
    : 'https://dhsyangtao.loca.lt/buy.html';
  if (navigator.clipboard) navigator.clipboard.writeText(link).catch(() => {});
  toast('链接已复制：' + link + ' · 发到微信，好友点开就是下单页（演示）', 4200);
});
