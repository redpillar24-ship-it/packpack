// public/script.js
// PackPack v2: 마스터 리스트 + 팩 시스템

const STORAGE = {
  GEARS: 'packpack_gears',
  PACKS: 'packpack_packs',
};

// ============================================
// 상태 관리
// ============================================
let gears = []; // 마스터 장비 리스트
let packs = []; // 팩 목록
let selectedPackId = null; // 현재 선택된 팩
let rates = null; // 환율 정보

// ============================================
// 유틸리티
// ============================================
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

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
// 환율 로드
// ============================================
async function loadRates() {
  try {
    const res = await fetch('/api/rates');
    if (res.ok) {
      rates = await res.json();
      $('#rateDisplay').textContent = `USD → KRW ${rates.rates.KRW.toFixed(0)}\n(${rates.date})`;
    }
  } catch {
    $('#rateDisplay').textContent = '환율 로드 실패';
  }
}

// ============================================
// UI: 마스터 리스트 렌더링
// ============================================
function renderGearList() {
  const list = $('#gearList');
  list.innerHTML = '';
  $('#gearCountBadge').textContent = gears.length;

  if (gears.length === 0) {
    list.innerHTML = '<li class="empty">등록된 장비가 없어요</li>';
    return;
  }

  // 카테고리별 그룹화
  const byCategory = {};
  gears.forEach((g) => {
    if (!byCategory[g.category]) byCategory[g.category] = [];
    byCategory[g.category].push(g);
  });

  Object.entries(byCategory).forEach(([cat, items]) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <strong>${cat}</strong>
      <div class="gear-sublist">
        ${items.map((g) => `
          <div class="gear-item">
            <span>${g.name}</span>
            <span class="gear-meta">${formatWeight(g.weight)} | ${formatPrice(g.price_krw)}</span>
          </div>
        `).join('')}
      </div>
    `;
    list.appendChild(li);
  });
}

// ============================================
// UI: 팩 목록 렌더링
// ============================================
function renderPackList() {
  const list = $('#packList');
  list.innerHTML = '';
  $('#packCountBadge').textContent = packs.length;

  packs.forEach((p) => {
    const li = document.createElement('li');
    li.textContent = p.name;
    li.className = p.id === selectedPackId ? 'active' : '';
    li.addEventListener('click', () => selectPack(p.id));
    list.appendChild(li);
  });
}

// ============================================
// UI: 팩 상세 화면
// ============================================
function selectPack(packId) {
  selectedPackId = packId;
  const pack = packs.find((p) => p.id === packId);

  if (!pack) {
    $('#packDetail').hidden = true;
    $('#emptyState').hidden = false;
    renderPackList();
    return;
  }

  $('#emptyState').hidden = true;
  $('#packDetail').hidden = false;
  $('#packName').textContent = pack.name;

  // 팩의 장비 아이템들
  const packItems = pack.items
    .map((item) => {
      const gear = gears.find((g) => g.id === item.gear_id);
      return gear ? { ...gear, quantity: item.quantity } : null;
    })
    .filter(Boolean);

  // 통계 계산
  const totalWeight = packItems.reduce((sum, g) => sum + g.weight * g.quantity, 0);
  const totalPrice = packItems.reduce((sum, g) => sum + g.price_krw * g.quantity, 0);

  $('#totalWeight').textContent = formatWeight(totalWeight);
  $('#totalPrice').textContent = formatPrice(totalPrice);
  $('#itemCount').textContent = packItems.length;

  // 도넛 차트
  renderChart(packItems);

  // 카테고리별 테이블
  renderCategoryTables(packItems, pack.id);

  renderPackList();
}

// ============================================
// 도넛 차트 렌더링
// ============================================
function renderChart(items) {
  const byCategory = {};
  items.forEach((item) => {
    if (!byCategory[item.category]) byCategory[item.category] = 0;
    byCategory[item.category] += item.weight * item.quantity;
  });

  const labels = Object.keys(byCategory);
  const data = Object.values(byCategory);

  const ctx = $('#categoryChart').getContext('2d');

  // 기존 차트 제거
  if (window.chartInstance) window.chartInstance.destroy();

  window.chartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: [
            '#3b82f6',
            '#ef4444',
            '#10b981',
            '#8b5cf6',
            '#f59e0b',
            '#06b6d4',
            '#f97316',
            '#6366f1',
          ],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
        },
      },
    },
  });
}

// ============================================
// 카테고리별 테이블 렌더링
// ============================================
function renderCategoryTables(items, packId) {
  const container = $('#categoryTables');
  container.innerHTML = '';

  const byCategory = {};
  items.forEach((item) => {
    if (!byCategory[item.category]) byCategory[item.category] = [];
    byCategory[item.category].push(item);
  });

  Object.entries(byCategory).forEach(([category, categoryItems]) => {
    const totalCategoryWeight = categoryItems.reduce((s, i) => s + i.weight * i.quantity, 0);
    const totalCategoryPrice = categoryItems.reduce((s, i) => s + i.price_krw * i.quantity, 0);

    const section = document.createElement('div');
    section.className = 'category-section';
    section.innerHTML = `
      <div class="category-header">
        <span>${category}</span>
        <span>${formatWeight(totalCategoryWeight)} | ${formatPrice(totalCategoryPrice)}</span>
      </div>
      <table class="category-table">
        <thead>
          <tr>
            <th>상품</th>
            <th>무게</th>
            <th>가격</th>
            <th>수량</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${categoryItems.map((item) => `
            <tr>
              <td class="gear-name">
                ${item.image ? `<img src="${item.image}" class="gear-thumb">` : '<div class="gear-thumb" style="background: #f0f0f0">🎒</div>'}
                <div class="gear-info">
                  <strong>${item.name}</strong>
                  ${item.source_url ? `<a href="${item.source_url}" target="_blank" style="font-size: 0.8rem; color: #3b82f6;">보기 →</a>` : ''}
                </div>
              </td>
              <td>${formatWeight(item.weight)}</td>
              <td>${formatPrice(item.price_krw)}</td>
              <td>${item.quantity}</td>
              <td>
                <button class="icon-btn remove-btn" data-pack-id="${packId}" data-gear-id="${item.id}">🗑️</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    container.appendChild(section);
  });

  // 삭제 버튼 이벤트
  $$('.remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const packId = btn.dataset.packId;
      const gearId = btn.dataset.gearId;
      removeGearFromPack(packId, gearId);
    });
  });
}

// ============================================
// 액션: 팩에서 장비 제거
// ============================================
function removeGearFromPack(packId, gearId) {
  const pack = packs.find((p) => p.id === packId);
  if (!pack) return;

  pack.items = pack.items.filter((item) => item.gear_id !== gearId);
  saveData();
  selectPack(packId);
}

// ============================================
// 액션: 새 팩 생성
// ============================================
async function createNewPack() {
  const name = prompt('팩 이름을 입력하세요:');
  if (!name) return;

  const newPack = {
    id: crypto.randomUUID(),
    name,
    items: [],
    created_at: new Date().toISOString(),
  };

  packs.push(newPack);
  saveData();
  selectPack(newPack.id);
  renderPackList();
}

// ============================================
// 액션: 장비 추가 (모달)
// ============================================
async function openAddGearModal() {
  $('#addGearModal').hidden = false;
}

function closeAddGearModal() {
  $('#addGearModal').hidden = true;
  $('#addGearForm').reset();
}

// ============================================
// 이벤트 리스너
// ============================================

// 새 팩 버튼
$('#newPackBtn').addEventListener('click', createNewPack);

// 장비 추가 버튼
$('#addGearBtn').addEventListener('click', openAddGearModal);

// 모달 닫기
$('#closeModalBtn').addEventListener('click', closeAddGearModal);
$('#cancelBtn').addEventListener('click', closeAddGearModal);

// 자동 채우기 버튼
$('#autoFillBtn').addEventListener('click', async () => {
  const url = $('#linkInput').value;
  if (!url) {
    $('#autoFillHint').textContent = '링크를 입력해주세요.';
    $('#autoFillHint').className = 'hint error';
    return;
  }

  $('#autoFillBtn').textContent = '검색 중...';
  $('#autoFillBtn').disabled = true;

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
    if (data.price && data.price.amount) {
      // 가격은 자동으로 한화(KRW)로 변환되어 들어옴
      $('#priceInput').value = data.price.amount;
    }

    $('#autoFillHint').textContent = '✅ 정보를 가져왔습니다.';
    $('#autoFillHint').className = 'hint success';
  } catch (err) {
    $('#autoFillHint').textContent = `❌ ${err.message}`;
    $('#autoFillHint').className = 'hint error';
  } finally {
    $('#autoFillBtn').textContent = '자동 채우기';
    $('#autoFillBtn').disabled = false;
  }
});

// 장비 추가 폼 제출
$('#addGearForm').addEventListener('submit', (e) => {
  e.preventDefault();

  const newGear = {
    id: crypto.randomUUID(),
    name: $('#nameInput').value,
    category: $('#categoryInput').value,
    weight: Number($('#weightInput').value),
    price_krw: Number($('#priceInput').value),
    source_url: $('#linkInput').value || null,
    image: null, // TODO: 자동 채우기에서 이미지 저장
    created_at: new Date().toISOString(),
  };

  gears.push(newGear);
  saveData();
  closeAddGearModal();
  renderGearList();

  // 현재 팩이 선택되어 있으면 자동으로 추가
  if (selectedPackId) {
    const pack = packs.find((p) => p.id === selectedPackId);
    if (pack) {
      pack.items.push({ gear_id: newGear.id, quantity: 1 });
      saveData();
      selectPack(selectedPackId);
    }
  }
});

// ============================================
// 초기화
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  loadRates();
  renderGearList();
  renderPackList();

  if (packs.length > 0) {
    selectPack(packs[0].id);
  }
});
