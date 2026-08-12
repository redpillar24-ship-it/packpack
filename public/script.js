// public/script.js
// 화면 로직 전부. 데이터는 localStorage에 저장 (서버는 /api/extract 정보 조회에만 사용).

const STORAGE_KEY = 'packpack_gears';
const CATEGORIES = ['쉘터', '수면', '조리', '의류', '신발', '전자', '기타'];

const els = {
  linkInput: document.getElementById('linkInput'),
  autoFillBtn: document.getElementById('autoFillBtn'),
  autoFillHint: document.getElementById('autoFillHint'),
  form: document.getElementById('gearForm'),
  nameInput: document.getElementById('nameInput'),
  categoryInput: document.getElementById('categoryInput'),
  weightInput: document.getElementById('weightInput'),
  priceInput: document.getElementById('priceInput'),
  preview: document.getElementById('autoFillPreview'),
  previewImg: document.getElementById('previewImg'),
  previewSite: document.getElementById('previewSite'),
  previewDesc: document.getElementById('previewDesc'),
  statWeight: document.getElementById('statWeight'),
  statPrice: document.getElementById('statPrice'),
  statCount: document.getElementById('statCount'),
  filterButtons: document.getElementById('filterButtons'),
  gearList: document.getElementById('gearList'),
  emptyState: document.getElementById('emptyState'),
};

let gears = loadGears();
let activeFilter = '전체';
let lastFetchedInfo = null; // 자동 채우기로 가져온 원본 정보 (이미지/링크 저장용)

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
  if (data.price && data.price.amount) els.priceInput.value = data.price.amount;

  if (data.image || data.description || data.siteName) {
    els.preview.hidden = false;
    els.previewImg.src = data.image || '';
    els.previewImg.style.visibility = data.image ? 'visible' : 'hidden';
    els.previewSite.textContent = data.siteName ? `출처: ${data.siteName}` : '';
    els.previewDesc.textContent = data.description || '';
  }

  // 낮은 신뢰도 필드는 눈에 띄게 표시
  toggleLowConfidence(els.weightInput, data.weight && data.weight.confidence === 'low');
  toggleLowConfidence(els.priceInput, data.price && data.price.confidence === 'low');
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

  const gear = {
    id: crypto.randomUUID(),
    name,
    category: els.categoryInput.value,
    weight: Number(els.weightInput.value) || 0,
    price: Number(els.priceInput.value) || 0,
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
  els.preview.hidden = true;
  els.previewImg.src = '';
  toggleLowConfidence(els.weightInput, false);
  toggleLowConfidence(els.priceInput, false);
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

  const totalWeight = gears.reduce((sum, g) => sum + (g.weight || 0), 0);
  const totalPrice = gears.reduce((sum, g) => sum + (g.price || 0), 0);
  els.statWeight.textContent = formatWeight(totalWeight);
  els.statPrice.textContent = `$${totalPrice.toFixed(2)}`;
  els.statCount.textContent = gears.length;
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
  meta.innerHTML = `
    <span class="gear-tag">${escapeHtml(gear.category)}</span>
    <span>${formatWeight(gear.weight)}</span>
    <span>$${Number(gear.price).toFixed(2)}</span>
  `;

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

function editGear(id) {
  const gear = gears.find((g) => g.id === id);
  if (!gear) return;

  const newName = prompt('제품명', gear.name);
  if (newName === null) return;
  const newWeight = prompt('무게 (g)', gear.weight);
  if (newWeight === null) return;
  const newPrice = prompt('가격 ($)', gear.price);
  if (newPrice === null) return;

  gear.name = newName.trim() || gear.name;
  gear.weight = Number(newWeight) || 0;
  gear.price = Number(newPrice) || 0;

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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

render();
