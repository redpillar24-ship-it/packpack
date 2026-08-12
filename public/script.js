// public/script.js
// PackPack v3: Claude 앱 스타일 UI + 네이티브 드래그앤드롭 + motion(Framer Motion) 애니메이션

import { animate } from 'https://cdn.jsdelivr.net/npm/motion@11/+esm';

const STORAGE = {
  GEARS: 'packpack_gears',
  PACKS: 'packpack_packs',
};

const CATEGORIES = ['배낭', '쉘터', '침낭', '매트', '의류', '신발', '전자기기', '조리', '기타'];

// 자동채우기로 가져온 제품명/설명 텍스트로 카테고리 추측 (키워드 매칭, 못 맞추면 null)
const CATEGORY_KEYWORDS = [
  ['배낭', /배낭|백팩|팩\b|pack|backpack|rucksack/i],
  ['쉘터', /텐트|타프|쉘터|tent|tarp|shelter/i],
  ['침낭', /침낭|퀼트|sleeping\s*bag|quilt/i],
  ['매트', /매트|에어매트|패드|pad\b|mat\b|mattress/i],
  ['신발', /신발|등산화|샌들|shoes?|boots?|sandals?/i],
  ['전자기기', /랜턴|헤드램프|배터리|전자|gps|light\b|lantern|headlamp|battery|power\s*bank/i],
  ['조리', /버너|코펠|스토브|조리|식기|stove|cookware|burner/i],
  ['의류', /자켓|재킷|바지|장갑|모자|의류|우모복|다운|jacket|pants|glove|down\b|shirt|hoodie/i],
];

function guessCategory(text) {
  if (!text) return null;
  const match = CATEGORY_KEYWORDS.find(([, re]) => re.test(text));
  return match ? match[0] : null;
}

// ============================================
// 상태
// ============================================
let gears = [];
let packs = [];
let selectedPackId = null;
let currentView = 'welcome'; // 'welcome' | 'inventory' | 'pack' | 'share'
let sharedPackPayload = null; // 공유 링크로 열었을 때만 채워짐
let rates = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function loadData() {
  try {
    gears = JSON.parse(localStorage.getItem(STORAGE.GEARS)) || [];
    packs = JSON.parse(localStorage.getItem(STORAGE.PACKS)) || [];
  } catch {
    gears = [];
    packs = [];
  }
}

function saveData() {
  localStorage.setItem(STORAGE.GEARS, JSON.stringify(gears));
  localStorage.setItem(STORAGE.PACKS, JSON.stringify(packs));
}

function formatPrice(amount) {
  return `₩${Number(amount).toLocaleString('ko-KR')}`;
}

function formatWeight(grams) {
  if (grams >= 1000) return `${(grams / 1000).toFixed(2)} kg`;
  return `${grams} g`;
}

// ============================================
// 공유 링크 인코딩/디코딩 (서버 저장 없음 — gzip 압축 후 URL에 그대로 넣음)
// ============================================
async function encodeSharePayload(obj) {
  const json = JSON.stringify(obj);
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  let binary = '';
  new Uint8Array(buf).forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function decodeSharePayload(encoded) {
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return JSON.parse(new TextDecoder().decode(buf));
}

function fadeInEl(el) {
  animate(el, { opacity: [0, 1], transform: ['scale(0.94)', 'scale(1)'] }, { duration: 0.22, easing: 'ease-out' });
}

// ============================================
// 환율
// ============================================
async function loadRates() {
  try {
    const res = await fetch('/api/rates');
    if (res.ok) {
      rates = await res.json();
      $('#rateDisplay').textContent = `기준환율 USD→KRW ${rates.rates.KRW.toFixed(0)} (${rates.date})`;
    }
  } catch {
    $('#rateDisplay').textContent = '환율 로드 실패';
  }
}

// ============================================
// 뷰 전환
// ============================================
function showView(view) {
  currentView = view;
  $('#welcomeView').hidden = view !== 'welcome';
  $('#inventoryView').hidden = view !== 'inventory';
  $('#packView').hidden = view !== 'pack';
  $('#shareView').hidden = view !== 'share';
  renderNav();
}

// ============================================
// 네비게이션 렌더링
// ============================================
function renderNav() {
  $('#gearCountBadge').textContent = gears.length;
  $('#showInventoryBtn').classList.toggle('active', currentView === 'inventory');

  const list = $('#packList');
  list.innerHTML = '';

  if (packs.length === 0) {
    list.innerHTML = '<li class="empty-hint">아직 팩이 없어요</li>';
    return;
  }

  packs
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .forEach((p) => {
      const li = document.createElement('li');
      li.textContent = p.name || '(제목 없음)';
      li.className = currentView === 'pack' && p.id === selectedPackId ? 'active' : '';
      li.addEventListener('click', () => openPack(p.id));
      list.appendChild(li);
    });
}

// ============================================
// 인벤토리(마스터 리스트) 화면
// ============================================
function openInventory() {
  showView('inventory');
  renderInventoryView();
}

function renderInventoryView(filter = '') {
  const grid = $('#inventoryGrid');
  grid.innerHTML = '';

  const q = filter.trim().toLowerCase();
  const visible = gears.filter((g) => g.name.toLowerCase().includes(q));

  if (gears.length === 0) {
    grid.innerHTML = '<p class="empty-note">등록된 장비가 없어요. "+ 장비 추가"로 시작해보세요.</p>';
    return;
  }
  if (visible.length === 0) {
    grid.innerHTML = '<p class="empty-note">검색 결과가 없어요.</p>';
    return;
  }

  visible.forEach((g) => {
    const card = document.createElement('div');
    card.className = 'inv-card';
    card.innerHTML = `
      <div class="inv-card-top">
        <div class="inv-thumb">${g.image ? `<img src="${g.image}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">` : '🎒'}</div>
        <div style="min-width:0">
          <span class="inv-card-cat">${g.category}</span>
          <div class="inv-card-name">${escapeHtml(g.name)}</div>
        </div>
      </div>
      <div class="inv-card-meta">
        <span>${formatWeight(g.weight)} · ${formatPrice(g.price_krw)}</span>
        <button class="inv-card-del" title="삭제">🗑️</button>
      </div>
    `;
    card.querySelector('.inv-card-del').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteGear(g.id);
    });
    card.addEventListener('click', () => openAddGearModal(g));
    grid.appendChild(card);
    fadeInEl(card);
  });
}

$('#inventorySearch').addEventListener('input', (e) => renderInventoryView(e.target.value));

function deleteGear(gearId) {
  if (!confirm('이 장비를 마스터 리스트에서 삭제할까요? 모든 팩에서도 제거됩니다.')) return;
  gears = gears.filter((g) => g.id !== gearId);
  packs.forEach((p) => {
    p.items = p.items.filter((i) => i.gear_id !== gearId);
  });
  saveData();
  renderNav();
  if (currentView === 'inventory') renderInventoryView($('#inventorySearch').value);
  if (currentView === 'pack') renderPackDetail();
}

// ============================================
// 팩 열기 / 생성
// ============================================
function openPack(packId) {
  selectedPackId = packId;
  showView('pack');
  renderPackDetail();
}

function createNewPack() {
  const today = new Date();
  const yy = String(today.getFullYear()).slice(2);
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');

  const newPack = {
    id: crypto.randomUUID(),
    name: `${yy}${mm}${dd} 새 팩`,
    items: [],
    created_at: new Date().toISOString(),
  };

  packs.push(newPack);
  saveData();
  openPack(newPack.id);

  // 이름 바로 편집 가능하도록 포커스 + 전체 선택
  requestAnimationFrame(() => {
    const h1 = $('#packName');
    h1.focus();
    document.execCommand('selectAll', false, null);
  });
}

function deletePack() {
  if (!confirm('이 팩을 삭제할까요? (마스터 리스트의 장비는 그대로 남아요)')) return;
  packs = packs.filter((p) => p.id !== selectedPackId);
  saveData();
  selectedPackId = null;
  if (packs.length > 0) {
    openPack(packs[0].id);
  } else {
    openInventory();
  }
}

// ============================================
// 팩 상세 렌더링
// ============================================
function renderPackDetail() {
  const pack = packs.find((p) => p.id === selectedPackId);
  if (!pack) return;

  $('#packName').textContent = pack.name;

  const packItems = pack.items
    .map((item) => {
      const gear = gears.find((g) => g.id === item.gear_id);
      return gear ? { ...gear, quantity: item.quantity } : null;
    })
    .filter(Boolean);

  const totalWeight = packItems.reduce((s, g) => s + g.weight * g.quantity, 0);
  const totalPrice = packItems.reduce((s, g) => s + g.price_krw * g.quantity, 0);

  $('#totalWeight').textContent = formatWeight(totalWeight);
  $('#totalPrice').textContent = formatPrice(totalPrice);
  $('#itemCount').textContent = packItems.length;

  renderChart(packItems);
  renderSourceList($('#sourceSearch').value);
  renderDropZone(packItems, pack.id);
}

// 팩 이름 인라인 편집 저장
$('#packName').addEventListener('blur', () => {
  const pack = packs.find((p) => p.id === selectedPackId);
  if (!pack) return;
  const newName = $('#packName').textContent.trim() || '(제목 없음)';
  pack.name = newName;
  saveData();
  renderNav();
});
$('#packName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('#packName').blur();
  }
});

// ============================================
// 도넛 차트
// ============================================
function renderChart(items) {
  const byCategory = {};
  items.forEach((item) => {
    byCategory[item.category] = (byCategory[item.category] || 0) + item.weight * item.quantity;
  });

  const ctx = $('#categoryChart').getContext('2d');
  if (window.chartInstance) window.chartInstance.destroy();

  if (Object.keys(byCategory).length === 0) return;

  window.chartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(byCategory),
      datasets: [
        {
          data: Object.values(byCategory),
          backgroundColor: ['#5b8fb0', '#c2603d', '#4e8c6b', '#6b7fd7', '#c99a2e', '#8b5cf6', '#2f7a6b', '#c1443a', '#8a8578'],
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '65%',
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
    },
  });
}

// ============================================
// 소스 리스트 (드래그 가능한 마스터 리스트, 팩 화면 좌측)
// ============================================
function renderSourceList(filter = '') {
  const container = $('#sourceList');
  container.innerHTML = '';
  $('#sourceCountBadge').textContent = gears.length;

  const q = filter.trim().toLowerCase();
  const visible = gears.filter((g) => g.name.toLowerCase().includes(q));

  if (visible.length === 0) {
    container.innerHTML = `<p class="empty-note">${gears.length === 0 ? '등록된 장비가 없어요' : '검색 결과 없음'}</p>`;
    return;
  }

  const byCategory = {};
  visible.forEach((g) => {
    if (!byCategory[g.category]) byCategory[g.category] = [];
    byCategory[g.category].push(g);
  });

  Object.entries(byCategory).forEach(([cat, items]) => {
    const group = document.createElement('div');
    group.className = 'source-cat-group';
    group.innerHTML = `<h3>${cat}</h3>`;

    items.forEach((g) => {
      const item = document.createElement('div');
      item.className = 'source-item';
      item.draggable = true;
      item.dataset.gearId = g.id;
      item.innerHTML = `
        <span class="drag-handle">⠿</span>
        <span class="source-item-name">${escapeHtml(g.name)}</span>
        <span class="source-item-weight">${formatWeight(g.weight)}</span>
      `;
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', g.id);
        e.dataTransfer.effectAllowed = 'copy';
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => item.classList.remove('dragging'));
      item.addEventListener('click', () => addGearToPack(selectedPackId, g.id));
      group.appendChild(item);
    });

    container.appendChild(group);
  });
}

$('#sourceSearch').addEventListener('input', (e) => renderSourceList(e.target.value));

// ============================================
// 드롭 존 (팩 내용물)
// ============================================
const dropZone = $('#dropZone');

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', (e) => {
  if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const gearId = e.dataTransfer.getData('text/plain');
  if (gearId) addGearToPack(selectedPackId, gearId);
});

function addGearToPack(packId, gearId) {
  const pack = packs.find((p) => p.id === packId);
  if (!pack) return;
  const existing = pack.items.find((i) => i.gear_id === gearId);
  if (existing) {
    existing.quantity += 1;
  } else {
    pack.items.push({ gear_id: gearId, quantity: 1 });
  }
  saveData();
  renderPackDetail();
}

function changeQty(packId, gearId, delta) {
  const pack = packs.find((p) => p.id === packId);
  if (!pack) return;
  const item = pack.items.find((i) => i.gear_id === gearId);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) {
    pack.items = pack.items.filter((i) => i.gear_id !== gearId);
  }
  saveData();
  renderPackDetail();
}

function removeGearFromPack(packId, gearId) {
  const pack = packs.find((p) => p.id === packId);
  if (!pack) return;

  const row = $(`tr[data-gear-id="${gearId}"]`);
  if (row) {
    animate(row, { opacity: [1, 0], transform: ['scale(1)', 'scale(0.96)'] }, { duration: 0.16, easing: 'ease-in' }).finished.then(() => {
      pack.items = pack.items.filter((i) => i.gear_id !== gearId);
      saveData();
      renderPackDetail();
    });
  } else {
    pack.items = pack.items.filter((i) => i.gear_id !== gearId);
    saveData();
    renderPackDetail();
  }
}

function renderDropZone(items, packId) {
  const container = $('#categoryTables');
  const emptyMsg = $('#dropZoneEmpty');
  container.innerHTML = '';

  emptyMsg.hidden = items.length !== 0;
  if (items.length === 0) return;

  const byCategory = {};
  items.forEach((item) => {
    if (!byCategory[item.category]) byCategory[item.category] = [];
    byCategory[item.category].push(item);
  });

  Object.entries(byCategory).forEach(([category, categoryItems]) => {
    const totalW = categoryItems.reduce((s, i) => s + i.weight * i.quantity, 0);
    const totalP = categoryItems.reduce((s, i) => s + i.price_krw * i.quantity, 0);

    const section = document.createElement('div');
    section.className = 'category-section';
    section.innerHTML = `
      <div class="category-header">
        <span>${category}</span>
        <span>${formatWeight(totalW)} · ${formatPrice(totalP)}</span>
      </div>
      <table class="category-table">
        <thead><tr><th>상품</th><th>무게</th><th>가격</th><th>수량</th><th></th></tr></thead>
        <tbody>
          ${categoryItems
            .map(
              (item) => `
            <tr data-gear-id="${item.id}">
              <td class="gear-name">
                <div class="gear-thumb">${item.image ? `<img src="${item.image}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">` : '🎒'}</div>
                <div class="gear-info">
                  <strong>${escapeHtml(item.name)}</strong>
                  ${item.source_url ? `<a href="${item.source_url}" target="_blank" rel="noopener">보기 →</a>` : ''}
                </div>
              </td>
              <td>${formatWeight(item.weight)}</td>
              <td>${formatPrice(item.price_krw)}</td>
              <td>
                <span class="qty-controls">
                  <button class="qty-btn" data-action="dec" data-gear-id="${item.id}">−</button>
                  ${item.quantity}
                  <button class="qty-btn" data-action="inc" data-gear-id="${item.id}">+</button>
                </span>
              </td>
              <td><button class="icon-btn remove-btn" data-gear-id="${item.id}">🗑️</button></td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    `;
    container.appendChild(section);
  });

  $$('.qty-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const delta = btn.dataset.action === 'inc' ? 1 : -1;
      changeQty(packId, btn.dataset.gearId, delta);
    });
  });
  $$('.remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => removeGearFromPack(packId, btn.dataset.gearId));
  });
  $$('.category-table tbody tr').forEach((row) => fadeInEl(row));
}

// ============================================
// 장비 추가/수정 모달
// ============================================
let autoFillImage = null;
let editingGearId = null; // null이면 새 장비 추가, 있으면 그 장비 수정 중

function openAddGearModal(gear = null) {
  editingGearId = gear ? gear.id : null;

  $('#gearModalTitle').textContent = gear ? '장비 수정' : '장비 추가';
  $('#gearSubmitBtn').textContent = gear ? '저장' : '추가';
  $('#deleteGearBtn').hidden = !gear;

  if (gear) {
    $('#linkInput').value = gear.source_url || '';
    $('#nameInput').value = gear.name;
    $('#categoryInput').value = gear.category;
    $('#weightInput').value = gear.weight;
    $('#priceInput').value = gear.price_krw;
    autoFillImage = gear.image || null;

    const viewLink = $('#viewSourceLink');
    if (gear.source_url) {
      viewLink.href = gear.source_url;
      viewLink.hidden = false;
    } else {
      viewLink.hidden = true;
    }
  }

  $('#addGearModal').hidden = false;
  const modal = $('.modal-content');
  animate(modal, { opacity: [0, 1], transform: ['scale(0.96)', 'scale(1)'] }, { duration: 0.18, easing: 'ease-out' });
}

function closeAddGearModal() {
  $('#addGearModal').hidden = true;
  $('#addGearForm').reset();
  $('#autoFillHint').textContent = '';
  $('#autoFillProgress').hidden = true;
  $('#autoFillRetryBtn').hidden = true;
  $('#weightFormRow').classList.remove('needs-input');
  $('#viewSourceLink').hidden = true;
  $('#deleteGearBtn').hidden = true;
  $('#gearModalTitle').textContent = '장비 추가';
  $('#gearSubmitBtn').textContent = '추가';
  editingGearId = null;
  autoFillImage = null;
}

$('#deleteGearBtn').addEventListener('click', () => {
  if (!editingGearId) return;
  const idToDelete = editingGearId;
  closeAddGearModal();
  deleteGear(idToDelete);
});

$('#showInventoryBtn').addEventListener('click', openInventory);
$('#newPackBtn').addEventListener('click', createNewPack);
$('#welcomeNewPackBtn').addEventListener('click', createNewPack);
$('#addGearBtnMain').addEventListener('click', openAddGearModal);
$('#addGearBtnPack').addEventListener('click', openAddGearModal);
$('#welcomeAddGearBtn').addEventListener('click', openAddGearModal);
$('#closeModalBtn').addEventListener('click', closeAddGearModal);
$('#cancelBtn').addEventListener('click', closeAddGearModal);
$('#deletePackBtn').addEventListener('click', deletePack);
$('#importSharedBtn').addEventListener('click', importSharedPack);

$('#sharePackBtn').addEventListener('click', async () => {
  const pack = packs.find((p) => p.id === selectedPackId);
  if (!pack) return;

  const packItems = pack.items
    .map((item) => {
      const gear = gears.find((g) => g.id === item.gear_id);
      return gear
        ? {
            name: gear.name,
            category: gear.category,
            weight: gear.weight,
            price_krw: gear.price_krw,
            quantity: item.quantity,
            image: gear.image || null,
            source_url: gear.source_url || null,
          }
        : null;
    })
    .filter(Boolean);

  const hint = $('#shareHint');
  if (packItems.length === 0) {
    hint.textContent = '공유할 장비가 없어요. 팩에 장비를 먼저 담아주세요.';
    hint.className = 'hint error';
    hint.hidden = false;
    return;
  }

  const btn = $('#sharePackBtn');
  const original = btn.textContent;
  btn.textContent = '생성 중...';
  btn.disabled = true;

  try {
    const encoded = await encodeSharePayload({ name: pack.name, items: packItems });
    const url = `${location.origin}${location.pathname}?share=${encoded}`;
    await navigator.clipboard.writeText(url);
    hint.textContent = '읽기전용 공유 링크를 클립보드에 복사했어요!';
    hint.className = 'hint success';
    hint.hidden = false;
  } catch (err) {
    hint.textContent = `공유 링크 생성에 실패했어요: ${err.message}`;
    hint.className = 'hint error';
    hint.hidden = false;
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
});

$('#resetDataBtn').addEventListener('click', () => {
  if (!confirm('모든 장비와 팩 데이터를 삭제할까요? 되돌릴 수 없어요.')) return;
  localStorage.removeItem(STORAGE.GEARS);
  localStorage.removeItem(STORAGE.PACKS);
  gears = [];
  packs = [];
  selectedPackId = null;
  showView('welcome');
});

async function runAutoFill() {
  const url = $('#linkInput').value;
  const hint = $('#autoFillHint');
  const btn = $('#autoFillBtn');
  const label = $('#autoFillBtnLabel');
  const progress = $('#autoFillProgress');
  const retryBtn = $('#autoFillRetryBtn');

  $('#weightFormRow').classList.remove('needs-input');
  retryBtn.hidden = true;

  if (!url) {
    hint.textContent = '링크를 입력해주세요.';
    hint.className = 'hint error';
    return;
  }

  btn.classList.add('autofill-loading');
  label.textContent = '가져오는 중...';
  btn.disabled = true;
  progress.hidden = false;
  hint.textContent = '정보를 가져오는 중이에요. 사이트에 따라 최대 15초 정도 걸릴 수 있어요.';
  hint.className = 'hint';

  try {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    $('#nameInput').value = data.name || '';
    if (data.weight && data.weight.grams) $('#weightInput').value = data.weight.grams;
    if (data.price && data.price.amount) $('#priceInput').value = data.price.amount;
    autoFillImage = data.image || null;

    const guessedCategory = guessCategory(`${data.name || ''} ${data.description || ''}`);
    if (guessedCategory) $('#categoryInput').value = guessedCategory;

    const missing = [];
    if (!data.name) missing.push('이름');
    if (!data.weight || !data.weight.grams) missing.push('무게');
    if (!data.price || !data.price.amount) missing.push('가격');

    if (missing.length === 0) {
      hint.textContent = '이름·무게·가격을 모두 가져왔어요. 한 번 더 확인해주세요.';
      hint.className = 'hint success';
    } else {
      if (missing.includes('무게')) $('#weightFormRow').classList.add('needs-input');
      hint.textContent = `${missing.join('·')}은(는) 찾지 못했어요. 직접 입력해주세요.`;
      hint.className = 'hint warning';
    }
  } catch (err) {
    const isLoginWall = err.message.includes('LOGIN_WALL');
    const isBlocked = err.message.includes('BLOCKED_PAGE');
    hint.textContent = isLoginWall
      ? '로그인이 필요한 페이지라 가져오지 못했어요. 이름·무게·가격을 직접 입력하거나 다시 시도해보세요.'
      : isBlocked
      ? '사이트가 접근을 막아서 가져오지 못했어요. 잠시 후 다시 시도하거나 직접 입력해주세요.'
      : `정보를 가져오지 못했어요: ${err.message} — 직접 입력해주세요.`;
    hint.className = 'hint error';
    retryBtn.hidden = false;
  } finally {
    btn.classList.remove('autofill-loading');
    label.textContent = '자동 채우기';
    btn.disabled = false;
    progress.hidden = true;
  }
}

$('#autoFillBtn').addEventListener('click', runAutoFill);
$('#autoFillRetryBtn').addEventListener('click', runAutoFill);

$('#addGearForm').addEventListener('submit', (e) => {
  e.preventDefault();

  const fields = {
    name: $('#nameInput').value,
    category: $('#categoryInput').value,
    weight: Number($('#weightInput').value),
    price_krw: Number($('#priceInput').value),
    source_url: $('#linkInput').value || null,
    image: autoFillImage,
  };

  if (editingGearId) {
    const gear = gears.find((g) => g.id === editingGearId);
    if (gear) Object.assign(gear, fields);
    saveData();
    closeAddGearModal();
    if (currentView === 'inventory') renderInventoryView($('#inventorySearch').value);
    if (currentView === 'pack') renderPackDetail();
    renderNav();
    return;
  }

  const newGear = { id: crypto.randomUUID(), ...fields, created_at: new Date().toISOString() };
  gears.push(newGear);
  saveData();
  closeAddGearModal();

  if (currentView === 'pack' && selectedPackId) {
    addGearToPack(selectedPackId, newGear.id);
  } else {
    openInventory();
  }
  renderNav();
});

// ============================================
// 공유받은 팩 (읽기전용) 렌더링 + 가져오기
// ============================================
function renderShareView(payload) {
  $('#sharePackName').textContent = payload.name || '(제목 없음)';
  const items = payload.items;

  const totalWeight = items.reduce((s, g) => s + g.weight * g.quantity, 0);
  const totalPrice = items.reduce((s, g) => s + g.price_krw * g.quantity, 0);
  $('#shareTotalWeight').textContent = formatWeight(totalWeight);
  $('#shareTotalPrice').textContent = formatPrice(totalPrice);
  $('#shareItemCount').textContent = items.length;

  renderShareChart(items);
  renderShareCategoryTables(items);
}

function renderShareChart(items) {
  const byCategory = {};
  items.forEach((item) => {
    byCategory[item.category] = (byCategory[item.category] || 0) + item.weight * item.quantity;
  });

  const ctx = $('#shareChart').getContext('2d');
  if (window.shareChartInstance) window.shareChartInstance.destroy();
  if (Object.keys(byCategory).length === 0) return;

  window.shareChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(byCategory),
      datasets: [
        {
          data: Object.values(byCategory),
          backgroundColor: ['#5b8fb0', '#c2603d', '#4e8c6b', '#6b7fd7', '#c99a2e', '#8b5cf6', '#2f7a6b', '#c1443a', '#8a8578'],
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '65%',
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
    },
  });
}

function renderShareCategoryTables(items) {
  const container = $('#shareCategoryTables');
  container.innerHTML = '';

  const byCategory = {};
  items.forEach((item) => {
    if (!byCategory[item.category]) byCategory[item.category] = [];
    byCategory[item.category].push(item);
  });

  Object.entries(byCategory).forEach(([category, categoryItems]) => {
    const totalW = categoryItems.reduce((s, i) => s + i.weight * i.quantity, 0);
    const totalP = categoryItems.reduce((s, i) => s + i.price_krw * i.quantity, 0);

    const section = document.createElement('div');
    section.className = 'category-section';
    section.innerHTML = `
      <div class="category-header">
        <span>${category}</span>
        <span>${formatWeight(totalW)} · ${formatPrice(totalP)}</span>
      </div>
      <table class="category-table">
        <thead><tr><th>상품</th><th>무게</th><th>가격</th><th>수량</th></tr></thead>
        <tbody>
          ${categoryItems
            .map(
              (item) => `
            <tr>
              <td class="gear-name">
                <div class="gear-thumb">${item.image ? `<img src="${item.image}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">` : '🎒'}</div>
                <div class="gear-info">
                  <strong>${escapeHtml(item.name)}</strong>
                  ${item.source_url ? `<a href="${item.source_url}" target="_blank" rel="noopener">보기 →</a>` : ''}
                </div>
              </td>
              <td>${formatWeight(item.weight)}</td>
              <td>${formatPrice(item.price_krw)}</td>
              <td>${item.quantity}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    `;
    container.appendChild(section);
  });
}

function importSharedPack() {
  if (!sharedPackPayload) return;

  const items = sharedPackPayload.items.map((item) => {
    const newGear = {
      id: crypto.randomUUID(),
      name: item.name,
      category: item.category,
      weight: item.weight,
      price_krw: item.price_krw,
      source_url: item.source_url || null,
      image: item.image || null,
      created_at: new Date().toISOString(),
    };
    gears.push(newGear);
    return { gear_id: newGear.id, quantity: item.quantity };
  });

  const newPack = {
    id: crypto.randomUUID(),
    name: `${sharedPackPayload.name || '공유받은 팩'} (가져옴)`,
    items,
    created_at: new Date().toISOString(),
  };
  packs.push(newPack);
  saveData();

  history.replaceState(null, '', location.pathname); // ?share= 파라미터 제거
  sharedPackPayload = null;
  openPack(newPack.id);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================
// 초기화
// ============================================
function initNormalView() {
  if (gears.length === 0 && packs.length === 0) {
    showView('welcome');
  } else if (packs.length > 0) {
    openPack(packs.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0].id);
  } else {
    openInventory();
  }
}

loadData();
loadRates();
renderNav();

const shareParam = new URLSearchParams(location.search).get('share');
if (shareParam) {
  decodeSharePayload(shareParam)
    .then((payload) => {
      sharedPackPayload = payload;
      showView('share');
      renderShareView(payload);
    })
    .catch(() => {
      alert('공유 링크를 읽을 수 없어요. 링크가 손상됐거나 만료됐을 수 있어요.');
      history.replaceState(null, '', location.pathname);
      initNormalView();
    });
} else {
  initNormalView();
}
