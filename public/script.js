// public/script.js
// 화면 로직 전부. 장비 데이터는 localStorage에 저장하고,
// 환율은 서버(/api/rates)를 통해 받아와 클라이언트에서 변환 계산만 한다.

const STORAGE_KEY = 'packpack_gears';
const BASE_CURRENCY_KEY = 'packpack_base_currency';
const CATEGORIES = ['쉘터', '수면', '조리', '의류', '신발', '전자', '기타'];

// 통화 표기 규칙: 원/엔은 소수점 없이, 그 외는 소수점 둘째 자리까지.
const CURRENCY_META = {
  KRW: { symbol: '₩', decimals: 0, label: 'KRW (원)' },
  USD: { symbol: '$', decimals: 2, label: 'USD (달러)' },
  JPY: { symbol: '¥', decimals: 0, label: 'JPY (엔)' },
  EUR: { symbol: '€', decimals: 2, label: 'EUR (유로)' },
  GBP: { symbol: '£', decimals: 2, label: 'GBP (파운드)' },
  CNY: { symbol: 'CN¥', decimals: 2, label: 'CNY (위안)' },
};
const CURRENCY_ORDER = ['KRW', 'USD', 'JPY', 'EUR', 'GBP', 'CNY'];

const els = {
  linkInput: document.getElementById('linkInput'),
  autoFillBtn: document.getElementById('autoFillBtn'),
  autoFillHint: document.getElementById('autoFillHint'),
  form: document.getElementById('gearForm'),
  nameInput: document.getElementById('nameInput'),
  categoryInput: document.getElementById('categoryInput'),
  weightInput: document.getElementById('weightInput'),
  currencyInput: document.getElementById('currencyInput'),
  officialPriceInput: document.getElementById('officialPriceInput'),
  actualPriceInput: document.getElementById('actualPriceInput'),
  preview: document.getElementById('autoFillPreview'),
  previewImg: document.getElementById('previewImg'),
  previewSite: document.getElementById('previewSite'),
  previewDesc: document.getElementById('previewDesc'),
  baseCurrencySelect: document.getElementById('baseCurrencySelect'),
  rateInfo: document.getElementById('rateInfo'),
  statWeight: document.getElementById('statWeight'),
  statOfficialPrice: document.getElementById('statOfficialPrice'),
  statActualPrice: document.getElementById('statActualPrice'),
  statCount: document.getElementById('statCount'),
  filterButtons: document.getElementById('filterButtons'),
  gearList: document.getElementById('gearList'),
  emptyState: document.getElementById('emptyState'),
};

let gears = loadGears();
let activeFilter = '전체';
let lastFetchedInfo = null; // 자동 채우기로 가져온 원본 정보 (이미지 저장용)
let baseCurrency = localStorage.getItem(BASE_CURRENCY_KEY) || 'KRW';
let rates = null; // { base: 'USD', date, rates: { USD:1, KRW:.., ... } }
// 리스트의 개별 가격 배지를 눌러 "환산 통화로 보기"를 켠 항목들 (새로고침하면 초기화됨).
const convertedBadges = new Set();

function loadGears() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveGears() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(gears));
}

function populateCurrencySelects() {
  const optionsHtml = CURRENCY_ORDER.map((code) => `<option value="${code}">${CURRENCY_META[code].label}</option>`).join('');
  els.currencyInput.innerHTML = optionsHtml;
  els.currencyInput.value = 'KRW';
  els.baseCurrencySelect.innerHTML = optionsHtml;
  els.baseCurrencySelect.value = baseCurrency;
}

els.baseCurrencySelect.addEventListener('change', () => {
  baseCurrency = els.baseCurrencySelect.value;
  localStorage.setItem(BASE_CURRENCY_KEY, baseCurrency);
  render();
});

// ---------- 환율 ----------

async function loadRates() {
  try {
    const res = await fetch('/api/rates');
    if (!res.ok) throw new Error();
    rates = await res.json();
    els.rateInfo.textContent = `${rates.date} 환율 기준`;
  } catch {
    els.rateInfo.textContent = '환율을 가져오지 못했어요 (원래 통화로만 표시돼요)';
  }
  render();
}

// from 통화 금액을 to 통화로 환산. 환율을 못 받아왔으면 null.
function convert(amount, from, to) {
  if (!rates || !rates.rates) return null;
  if (from === to) return amount;
  const rFrom = rates.rates[from];
  const rTo = rates.rates[to];
  if (!rFrom || !rTo) return null;
  const usd = amount / rFrom; // rates.rates[cur] = 1 USD 당 해당 통화 금액
  return usd * rTo;
}

function formatMoney(amount, currency) {
  const meta = CURRENCY_META[currency] || { symbol: `${currency} `, decimals: 2 };
  const n = Number(amount) || 0;
  return `${meta.symbol}${n.toLocaleString('ko-KR', {
    minimumFractionDigits: meta.decimals,
    maximumFractionDigits: meta.decimals,
  })}`;
}

// ---------- 자동 채우기 ----------

els.autoFillBtn.addEventListener('click', async () => {
  const url = els.linkInput.value.trim();
  if (!url) {
    setHint('제품 링크를 먼저 입력해 주세요.', 'error');
    return;
  }

  setHint('정보를 가져오는 중...', '');
  els.autoFillBtn.disabled = true;
  els.autoFillBtn.textContent = '⏳ 검색 중...';

  try {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || '정보를 가져오지 못했습니다.');
    }

    lastFetchedInfo = data;
    applyFetchedInfo(data);
    setHint('가져온 정보를 확인하고, 필요하면 직접 수정해 주세요.', 'success');
  } catch (err) {
    setHint(err.message, 'error');
  } finally {
    els.autoFillBtn.disabled = false;
    els.autoFillBtn.textContent = '🔍 자동 채우기';
  }
});

function applyFetchedInfo(data) {
  if (data.name && !els.nameInput.value) els.nameInput.value = data.name;
  if (data.weight && data.weight.grams) els.weightInput.value = data.weight.grams;

  if (data.price && data.price.amount) {
    if (data.price.currency && CURRENCY_META[data.price.currency]) {
      els.currencyInput.value = data.price.currency;
    }
    els.officialPriceInput.value = data.price.amount;
    // 실구매가는 보통 공식가와 같으니 기본값으로 채워두고, 다르면 사용자가 직접 수정.
    if (!els.actualPriceInput.value) els.actualPriceInput.value = data.price.amount;
  }

  if (data.image || data.description || data.siteName) {
    els.preview.hidden = false;
    els.previewImg.src = data.image || '';
    els.previewImg.style.visibility = data.image ? 'visible' : 'hidden';
    els.previewSite.textContent = data.siteName ? `출처: ${data.siteName}` : '';
    els.previewDesc.textContent = data.description || '';
  }

  // 낮은 신뢰도 필드는 눈에 띄게 표시
  toggleLowConfidence(els.weightInput, data.weight && data.weight.confidence === 'low');
  toggleLowConfidence(els.officialPriceInput, data.price && data.price.confidence === 'low');
}

function toggleLowConfidence(input, isLow) {
  input.style.borderColor = isLow ? 'var(--color-low-confidence)' : '';
}

function setHint(message, type) {
  els.autoFillHint.textContent = message;
  els.autoFillHint.className = 'hint' + (type ? ` ${type}` : '');
}

// ---------- 추가 폼 ----------

els.form.addEventListener('submit', (e) => {
  e.preventDefault();

  const name = els.nameInput.value.trim();
  if (!name) return;

  const currency = els.currencyInput.value;
  const officialAmount = Number(els.officialPriceInput.value) || 0;
  const actualAmount = els.actualPriceInput.value !== '' ? Number(els.actualPriceInput.value) || 0 : officialAmount;

  const gear = {
    id: crypto.randomUUID(),
    name,
    category: els.categoryInput.value,
    weight: Number(els.weightInput.value) || 0,
    officialPrice: { amount: officialAmount, currency },
    actualPrice: { amount: actualAmount, currency },
    link: els.linkInput.value.trim() || null,
    image: lastFetchedInfo && lastFetchedInfo.image ? lastFetchedInfo.image : null,
    addedAt: Date.now(),
  };

  gears.push(gear);
  saveGears();
  resetForm();
  render();
});

function resetForm() {
  els.form.reset();
  els.linkInput.value = '';
  els.currencyInput.value = 'KRW';
  els.preview.hidden = true;
  els.previewImg.src = '';
  toggleLowConfidence(els.weightInput, false);
  toggleLowConfidence(els.officialPriceInput, false);
  setHint('', '');
  lastFetchedInfo = null;
}

// ---------- 필터 ----------

function renderFilters() {
  const all = ['전체', ...CATEGORIES];
  els.filterButtons.innerHTML = '';
  all.forEach((cat) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'filter-chip' + (cat === activeFilter ? ' active' : '');
    btn.textContent = cat;
    btn.addEventListener('click', () => {
      activeFilter = cat;
      render();
    });
    els.filterButtons.appendChild(btn);
  });
}

// ---------- 리스트 / 통계 ----------

function render() {
  renderFilters();

  const visible = activeFilter === '전체' ? gears : gears.filter((g) => g.category === activeFilter);

  els.gearList.innerHTML = '';
  els.emptyState.classList.toggle('visible', visible.length === 0);

  visible
    .slice()
    .sort((a, b) => b.addedAt - a.addedAt)
    .forEach((gear) => els.gearList.appendChild(renderGearItem(gear)));

  renderStats();
}

function renderStats() {
  const totalWeight = gears.reduce((sum, g) => sum + (g.weight || 0), 0);
  els.statWeight.textContent = formatWeight(totalWeight);
  els.statCount.textContent = gears.length;

  if (!gears.length) {
    els.statOfficialPrice.textContent = formatMoney(0, baseCurrency);
    els.statActualPrice.textContent = formatMoney(0, baseCurrency);
    return;
  }

  const totals = sumConverted(gears);
  els.statOfficialPrice.textContent = totals.ok
    ? formatMoney(totals.official, baseCurrency)
    : '환율 로딩 중...';
  els.statActualPrice.textContent = totals.ok
    ? formatMoney(totals.actual, baseCurrency)
    : '환율 로딩 중...';
}

function sumConverted(list) {
  let official = 0;
  let actual = 0;
  for (const g of list) {
    const co = convert(g.officialPrice.amount, g.officialPrice.currency, baseCurrency);
    const ca = convert(g.actualPrice.amount, g.actualPrice.currency, baseCurrency);
    if (co === null || ca === null) return { ok: false };
    official += co;
    actual += ca;
  }
  return { ok: true, official, actual };
}

function renderGearItem(gear) {
  const li = document.createElement('li');
  li.className = 'gear-item';

  const thumb = document.createElement(gear.image ? 'img' : 'div');
  thumb.className = 'gear-thumb' + (gear.image ? '' : ' placeholder');
  if (gear.image) {
    thumb.src = gear.image;
    thumb.alt = '';
  } else {
    thumb.textContent = '🎒';
  }

  const main = document.createElement('div');
  main.className = 'gear-main';

  const nameEl = document.createElement('p');
  nameEl.className = 'gear-name';
  if (gear.link) {
    const a = document.createElement('a');
    a.href = gear.link;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = gear.name;
    nameEl.appendChild(a);
  } else {
    nameEl.textContent = gear.name;
  }

  const meta = document.createElement('div');
  meta.className = 'gear-meta';

  const categoryTag = document.createElement('span');
  categoryTag.className = 'gear-tag';
  categoryTag.textContent = gear.category;
  meta.appendChild(categoryTag);

  const weightTag = document.createElement('span');
  weightTag.textContent = formatWeight(gear.weight);
  meta.appendChild(weightTag);

  meta.appendChild(makePriceBadge(gear, 'official', '공식'));
  meta.appendChild(makePriceBadge(gear, 'actual', '실구매'));

  main.appendChild(nameEl);
  main.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'gear-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'icon-btn';
  editBtn.title = '수정';
  editBtn.textContent = '✏️';
  editBtn.addEventListener('click', () => editGear(gear.id));

  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn delete';
  delBtn.title = '삭제';
  delBtn.textContent = '🗑️';
  delBtn.addEventListener('click', () => deleteGear(gear.id));

  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  li.appendChild(thumb);
  li.appendChild(main);
  li.appendChild(actions);
  return li;
}

// 가격 배지: 기본은 원래 통화로 표시하고, 클릭하면 상단에서 고른 "환산 통화"로 오늘 환율 기준
// 변환해서 보여준다. 다시 누르면 원래 통화로 되돌아간다.
function makePriceBadge(gear, field, label) {
  const priceInfo = gear[field === 'official' ? 'officialPrice' : 'actualPrice'];
  const key = `${gear.id}:${field}`;
  const isConverted = convertedBadges.has(key) && priceInfo.currency !== baseCurrency;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'price-badge' + (isConverted ? ' converted' : '');

  let displayText;
  if (isConverted) {
    const converted = convert(priceInfo.amount, priceInfo.currency, baseCurrency);
    displayText = converted === null ? '환율 로딩 중' : formatMoney(converted, baseCurrency);
    btn.title = `원래 가격: ${formatMoney(priceInfo.amount, priceInfo.currency)} (클릭하면 원래 통화로)`;
  } else {
    displayText = formatMoney(priceInfo.amount, priceInfo.currency);
    btn.title =
      priceInfo.currency === baseCurrency
        ? '이미 환산 통화와 같아요'
        : `클릭하면 오늘 환율로 ${baseCurrency} 환산 가격을 볼 수 있어요`;
  }

  btn.innerHTML = `<span class="price-label">${label}</span>${displayText}`;

  btn.addEventListener('click', () => {
    if (priceInfo.currency === baseCurrency) return; // 변환할 필요 없음
    if (convertedBadges.has(key)) convertedBadges.delete(key);
    else convertedBadges.add(key);
    render();
  });

  return btn;
}

function editGear(id) {
  const gear = gears.find((g) => g.id === id);
  if (!gear) return;

  const newName = prompt('제품명', gear.name);
  if (newName === null) return;
  const newWeight = prompt('무게 (g)', gear.weight);
  if (newWeight === null) return;
  const newOfficial = prompt(`공식 가격 (${gear.officialPrice.currency})`, gear.officialPrice.amount);
  if (newOfficial === null) return;
  const newActual = prompt(`실구매 가격 (${gear.actualPrice.currency})`, gear.actualPrice.amount);
  if (newActual === null) return;

  gear.name = newName.trim() || gear.name;
  gear.weight = Number(newWeight) || 0;
  gear.officialPrice.amount = Number(newOfficial) || 0;
  gear.actualPrice.amount = Number(newActual) || 0;

  saveGears();
  render();
}

function deleteGear(id) {
  if (!confirm('이 장비를 삭제할까요?')) return;
  gears = gears.filter((g) => g.id !== id);
  saveGears();
  render();
}

function formatWeight(grams) {
  if (grams >= 1000) return `${(grams / 1000).toFixed(2)} kg`;
  return `${grams} g`;
}

populateCurrencySelects();
render();
loadRates();
