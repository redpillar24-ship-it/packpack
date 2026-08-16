// public/script.js
// PackPack v3: Claude 앱 스타일 UI + 네이티브 드래그앤드롭 + motion(Framer Motion) 애니메이션

import { animate } from 'https://cdn.jsdelivr.net/npm/motion@11/+esm';

const STORAGE = {
  GEARS: 'packpack_gears',
  PACKS: 'packpack_packs',
};

// 백패킹 실사용 기준 세분화된 카테고리 — "기타"로 뭉뚱그리지 않도록 위생/도구/부속품까지 분리
const CATEGORIES = [
  '배낭',
  '배낭 액세서리',
  '쉘터',
  '쉘터 부속품',
  '침낭',
  '매트',
  '의류',
  '신발',
  '조리',
  '물',
  '전자기기',
  '위생용품',
  '응급/도구',
  '기타',
];

// "부속품/액세서리" 카테고리는 팩 화면에서 부모 카테고리 밑에 붙여서(중첩) 보여줌 —
// 물통 파우치·힙벨트 파우치는 배낭에, 스테이크·폴은 쉘터에 실제로 장착하는 물건이니까
const ACCESSORY_PARENT_CATEGORY = {
  '배낭 액세서리': '배낭',
  '쉘터 부속품': '쉘터',
};

// 자동채우기로 가져온 제품명/설명 텍스트로 카테고리 추측 (키워드 매칭, 못 맞추면 null)
// 순서 중요: 겹치는 단어(예: "power pack"·"tent stake")가 엉뚱한 카테고리로 안 빠지도록
// 더 구체적인 카테고리를 먼저 검사하고, "배낭"처럼 넓은 단어는 맨 뒤에 둠.
const CATEGORY_KEYWORDS = [
  ['쉘터 부속품', /스테이크|팩핀|가이라인|기라인|폴대|peg\b|stake|guyline|guy\s*line|tent\s*pole/i],
  ['배낭 액세서리', /힙벨트\s*파우치|웨이스트\s*파우치|숄더\s*파우치|배낭\s*파우치|hip\s*belt\s*pouch|hip\s*pouch|waist\s*pouch|shoulder\s*strap\s*pouch|accessory\s*pouch/i],
  ['위생용품', /칫솔|치약|휴지|티슈|귀마개|세면|화장품|선크림|비누|toothbrush|toothpaste|tissue|earplug|sunscreen|soap/i],
  ['응급/도구', /멀티툴|응급|구급|나침반|수리\s*키트|리페어|칼\b|multitool|first\s*aid|compass|repair\s*kit|knife/i],
  ['물', /정수|필터|물통|워터백|블래더|water\s*filter|bladder|water\s*bottle|\bbottle\b/i],
  // "light"는 이 도메인(초경량 백패킹)에서 "packing light"처럼 무게 얘기에 워낙 흔하게 섞여 나와서
  // 오분류가 잦아 일부러 뺌 — 랜턴류는 lantern/headlamp 같은 더 구체적인 단어로만 판별
  ['전자기기', /랜턴|헤드램프|배터리|파워뱅크|무선충전|전자기기|gps|lantern|headlamp|battery|power\s*bank/i],
  ['조리', /버너|코펠|스토브|조리|식기|stove|cookware|burner|\bpot\b|\bpan\b/i],
  ['신발', /신발|등산화|샌들|shoes?|boots?|sandals?/i],
  ['의류', /자켓|재킷|바지|장갑|모자|양말|의류|우모복|다운|jacket|pants|glove|down\b|shirt|hoodie|sock/i],
  ['매트', /매트|에어매트|패드|pad\b|mat\b|mattress/i],
  ['침낭', /침낭|퀼트|sleeping\s*bag|quilt/i],
  ['쉘터', /텐트|타프|쉘터|비비색|tent|tarp|shelter|bivy/i],
  // "pack"을 경계 없이 매칭하면 "packing"/"unpacking" 같은 흔한 단어에도 걸려서 오분류가
  // 잦았음(예: "perfect for packing light") — 독립된 단어일 때만 매칭
  ['배낭', /배낭|백팩|팩|\bpack\b|backpack|rucksack/i],
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
let draggedPackId = null; // 사이드바 팩 목록 드래그 재정렬용
let inventoryFilterCategory = null; // null=내 장비 전체, '의류'=내 옷만 (별도 데이터가 아니라 필터 뷰)

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
  if (grams >= 1000) return `${(grams / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })} kg`;
  return `${Number(grams).toLocaleString('ko-KR')} g`;
}

// 숫자 입력창에 타이핑하는 대로 천단위 콤마를 붙여준다 (무게/가격 입력용)
function formatNumberInput(el) {
  const digitsOnly = el.value.replace(/[^\d]/g, '');
  el.value = digitsOnly ? Number(digitsOnly).toLocaleString('ko-KR') : '';
}

function setNumberInputValue(el, rawNumber) {
  el.value = rawNumber || rawNumber === 0 ? Number(rawNumber).toLocaleString('ko-KR') : '';
}

function parseNumberInput(el) {
  return Number(el.value.replace(/[^\d]/g, '')) || 0;
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
// 뷰 전환
// ============================================
function showView(view) {
  currentView = view;
  $('#welcomeView').hidden = view !== 'welcome';
  $('#inventoryView').hidden = view !== 'inventory';
  $('#packView').hidden = view !== 'pack';
  $('#shareView').hidden = view !== 'share';
  // 공유받은 팩은 독립된 페이지로 보여줌 — 내 사이드바/다른 팩 목록이 섞여 보이면 안 되고,
  // 프린트했을 때도 그 팩 정보만 나와야 함
  document.body.classList.toggle('share-mode', view === 'share');
  renderNav();
}

// ============================================
// 네비게이션 렌더링
// ============================================
function renderNav() {
  $('#gearCountBadge').textContent = gears.length;
  $('#clothesCountBadge').textContent = gears.filter((g) => g.category === '의류').length;
  $('#showInventoryBtn').classList.toggle('active', currentView === 'inventory' && !inventoryFilterCategory);
  $('#showClothesBtn').classList.toggle('active', currentView === 'inventory' && inventoryFilterCategory === '의류');

  const list = $('#packList');
  list.innerHTML = '';

  if (packs.length === 0) {
    list.innerHTML = '<li class="empty-hint">아직 팩이 없어요</li>';
    return;
  }

  // packs 배열 순서 = 표시 순서 (드래그로 사용자가 직접 재정렬 가능, 최신순 자동정렬 없음)
  packs.forEach((p) => {
    const li = document.createElement('li');
    li.className = `nav-pack-item ${currentView === 'pack' && p.id === selectedPackId ? 'active' : ''}`;
    li.draggable = true;
    li.dataset.packId = p.id;
    li.innerHTML = `
      <span class="nav-pack-name">${escapeHtml(p.name || '(제목 없음)')}</span>
      <button class="nav-pack-menu-btn" title="팩 메뉴" type="button">⋮</button>
      <div class="nav-pack-menu" hidden>
        <button type="button" data-action="rename">이름 변경</button>
        <button type="button" data-action="delete">삭제</button>
      </div>
    `;

    li.querySelector('.nav-pack-name').addEventListener('click', () => openPack(p.id));

    const menuBtn = li.querySelector('.nav-pack-menu-btn');
    const menu = li.querySelector('.nav-pack-menu');
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasHidden = menu.hidden;
      closeAllPackMenus();
      menu.hidden = !wasHidden;
    });
    menu.querySelector('[data-action="rename"]').addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = true;
      startRenamePackItem(li, p);
    });
    menu.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = true;
      deletePack(p.id);
    });

    li.addEventListener('dragstart', () => {
      draggedPackId = p.id;
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    li.addEventListener('dragover', (e) => e.preventDefault());
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!draggedPackId || draggedPackId === p.id) return;
      reorderPacks(draggedPackId, p.id);
      draggedPackId = null;
    });

    list.appendChild(li);
  });
}

function closeAllPackMenus() {
  $$('.nav-pack-menu').forEach((m) => (m.hidden = true));
}
document.addEventListener('click', closeAllPackMenus);

function startRenamePackItem(li, pack) {
  const nameEl = li.querySelector('.nav-pack-name');
  nameEl.contentEditable = 'true';
  nameEl.spellcheck = false;
  nameEl.focus();
  document.execCommand('selectAll', false, null);

  const save = () => {
    nameEl.contentEditable = 'false';
    const newName = nameEl.textContent.trim() || '(제목 없음)';
    pack.name = newName;
    saveData();
    renderNav();
    if (pack.id === selectedPackId) $('#packName').textContent = newName;
  };
  nameEl.addEventListener('blur', save, { once: true });
  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      nameEl.blur();
    }
  });
}

function reorderPacks(draggedId, targetId) {
  const fromIdx = packs.findIndex((p) => p.id === draggedId);
  const toIdx = packs.findIndex((p) => p.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  const [moved] = packs.splice(fromIdx, 1);
  packs.splice(toIdx, 0, moved);
  saveData();
  renderNav();
}

// ============================================
// 인벤토리(내 장비) 화면
// ============================================
function openInventory(categoryFilter = null) {
  inventoryFilterCategory = categoryFilter;
  showView('inventory');

  const isClothes = categoryFilter === '의류';
  $('#inventoryTitle').textContent = isClothes ? '내 옷' : '내 장비';
  $('#inventorySubtitle').textContent = isClothes
    ? '소유한 아웃도어 의류. 팩을 만들면 여기서 끌어다 놓을 수 있어요.'
    : '소유한 모든 장비. 팩을 만들면 여기서 끌어다 놓을 수 있어요.';
  $('#addGearBtnMain').textContent = isClothes ? '+ 옷 추가' : '+ 장비 추가';

  renderInventoryView();
}

function renderInventoryView(filter = '') {
  const grid = $('#inventoryGrid');
  grid.innerHTML = '';

  const q = filter.trim().toLowerCase();
  const scoped = inventoryFilterCategory ? gears.filter((g) => g.category === inventoryFilterCategory) : gears;
  const visible = scoped.filter((g) => g.name.toLowerCase().includes(q) || (g.brand && g.brand.toLowerCase().includes(q)));

  if (scoped.length === 0) {
    const label = inventoryFilterCategory ? '옷' : '장비';
    grid.innerHTML = `<p class="empty-note">등록된 ${label}가 없어요. "+ ${label} 추가"로 시작해보세요.</p>`;
    return;
  }
  if (visible.length === 0) {
    grid.innerHTML = '<p class="empty-note">검색 결과가 없어요.</p>';
    return;
  }

  const byCategory = {};
  visible.forEach((g) => {
    if (!byCategory[g.category]) byCategory[g.category] = [];
    byCategory[g.category].push(g);
  });

  Object.entries(byCategory).forEach(([category, catGears]) => {
    const group = document.createElement('div');
    group.className = 'inv-cat-group';
    group.innerHTML = `<h3>${category}<span class="inv-cat-count">${catGears.length}</span></h3>`;

    const catGrid = document.createElement('div');
    catGrid.className = 'inv-cat-grid';

    catGears.forEach((g) => {
      const card = document.createElement('div');
      card.className = 'inv-card';
      card.innerHTML = `
        <div class="inv-card-top">
          <div class="inv-thumb${g.image ? ' lightbox-trigger' : ''}" ${g.image ? `data-image="${g.image}"` : ''}>${g.image ? `<img src="${g.image}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">` : '🎒'}</div>
          <div style="min-width:0">
            ${g.brand ? `<div class="inv-card-brand">${escapeHtml(g.brand)}</div>` : ''}
            ${g.source_url ? `<a class="gear-name-link" href="${g.source_url}" target="_blank" rel="noopener"><div class="inv-card-name">${escapeHtml(g.name)}</div></a>` : `<div class="inv-card-name">${escapeHtml(g.name)}</div>`}
          </div>
        </div>
        <div class="inv-card-meta">
          <span>${formatWeight(g.weight)} · ${formatPrice(g.price_krw)}</span>
          <span class="inv-card-actions">
            <button class="icon-btn inv-card-edit" title="수정">✏️</button>
            <button class="icon-btn inv-card-del" title="삭제">🗑️</button>
          </span>
        </div>
      `;
      card.querySelector('.inv-card-edit').addEventListener('click', () => openAddGearModal(g));
      card.querySelector('.inv-card-del').addEventListener('click', () => deleteGear(g.id));
      catGrid.appendChild(card);
      fadeInEl(card);
    });

    group.appendChild(catGrid);
    grid.appendChild(group);
  });

  bindLightboxTriggers();
}

$('#inventorySearch').addEventListener('input', (e) => renderInventoryView(e.target.value));

function deleteGear(gearId) {
  if (!confirm('이 장비를 삭제할까요? 모든 팩에서도 제거됩니다.')) return;
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

// ============================================
// 새 팩 만들기 마법사 (토스 스타일: 어디로/언제/며칠 세 질문에 답하면 이름을 자동으로 지어줌)
// ============================================
let wizardStep = 1;
const wizardData = { destination: '', date: '', days: null };
let calViewDate = new Date();

// 고정 양력 공휴일만 반영 (설날·추석 등 음력 공휴일은 매년 날짜가 달라져서 별도 라이브러리 없이는
// 정확히 계산 불가 — 지금은 범위 밖으로 남겨둠)
const KR_FIXED_HOLIDAYS = {
  '01-01': '신정',
  '03-01': '삼일절',
  '05-05': '어린이날',
  '06-06': '현충일',
  '08-15': '광복절',
  '10-03': '개천절',
  '10-09': '한글날',
  '12-25': '성탄절',
};

function toISODate(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function setWizardDate(iso) {
  wizardData.date = iso;
  $('#wizardDateBtn').textContent = iso;
}

function renderCalendar() {
  const y = calViewDate.getFullYear();
  const m = calViewDate.getMonth();
  $('#calMonthLabel').textContent = `${y}년 ${m + 1}월`;

  const grid = $('#calDaysGrid');
  grid.innerHTML = '';

  const firstDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  for (let i = 0; i < firstDow; i++) grid.appendChild(document.createElement('span'));

  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(y, m, d).getDay();
    const mmdd = `${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const holidayName = KR_FIXED_HOLIDAYS[mmdd];
    const iso = toISODate(y, m, d);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cal-day';
    if (dow === 0 || holidayName) btn.classList.add('cal-day--sun'); // 공휴일도 일요일과 같은 빨강으로 쉬는 날 표시
    else if (dow === 6) btn.classList.add('cal-day--sat');
    if (iso === wizardData.date) btn.classList.add('cal-day--selected');
    if (holidayName) btn.title = holidayName;
    btn.textContent = d;
    btn.addEventListener('click', () => {
      setWizardDate(iso);
      $('#wizardCalendar').hidden = true;
    });
    grid.appendChild(btn);
  }
}

function openNewPackWizard() {
  wizardStep = 1;
  wizardData.destination = '';
  wizardData.days = null;
  $('#wizardDestInput').value = '';
  $('#wizardDaysInput').value = '';
  $('#wizardCalendar').hidden = true;

  calViewDate = new Date();
  setWizardDate(calViewDate.toISOString().slice(0, 10));

  showWizardStep(1);
  $('#newPackModal').hidden = false;
  requestAnimationFrame(() => $('#wizardDestInput').focus());
}

function closeNewPackWizard() {
  $('#newPackModal').hidden = true;
}

function showWizardStep(step) {
  wizardStep = step;
  $$('.wizard-step').forEach((el) => {
    el.hidden = Number(el.dataset.step) !== step;
  });
  $$('.wizard-dot').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.step) <= step);
  });
  if (step === 2) renderCalendar();
  const focusInput = { 1: '#wizardDestInput', 3: '#wizardDaysInput' }[step];
  if (focusInput) requestAnimationFrame(() => $(focusInput)?.focus());
}

function wizardGoNext() {
  if (wizardStep === 1) {
    wizardData.destination = $('#wizardDestInput').value.trim();
    if (!wizardData.destination) return $('#wizardDestInput').focus();
  }
  showWizardStep(wizardStep + 1);
}

$('#wizardDateBtn').addEventListener('click', () => {
  $('#wizardCalendar').hidden = !$('#wizardCalendar').hidden;
});
$('#calPrevBtn').addEventListener('click', () => {
  calViewDate.setMonth(calViewDate.getMonth() - 1);
  renderCalendar();
});
$('#calNextBtn').addEventListener('click', () => {
  calViewDate.setMonth(calViewDate.getMonth() + 1);
  renderCalendar();
});

// 날짜 범위를 "8월 16-19일" / "8월 30일-9월 2일" 처럼 자연스러운 한 줄로
function formatDateRange(start, end) {
  const mm = start.getMonth() + 1;
  const d1 = start.getDate();
  const endMM = end.getMonth() + 1;
  const d2 = end.getDate();
  if (d1 === d2 && mm === endMM) return `${mm}월 ${d1}일`;
  if (mm === endMM) return `${mm}월 ${d1}-${d2}`;
  return `${mm}월 ${d1}일-${endMM}월 ${d2}일`;
}

function finishWizard(days) {
  const finalDays = days || Number($('#wizardDaysInput').value);
  if (!finalDays || finalDays < 1) return $('#wizardDaysInput').focus();
  wizardData.days = finalDays;

  const start = new Date(wizardData.date);
  const end = new Date(start);
  end.setDate(start.getDate() + finalDays - 1);

  const baseName = `${start.getFullYear()}년 ${formatDateRange(start, end)} ${wizardData.destination} 장비 준비물`;

  // 이름이 겹치면 유저에게 다시 물어보지 않고 번호를 붙여서 자동으로 구분함
  let name = baseName;
  let n = 2;
  while (packs.some((p) => p.name === name)) {
    name = `${baseName} #${n}`;
    n++;
  }

  const newPack = { id: crypto.randomUUID(), name, items: [], created_at: new Date().toISOString() };
  packs.unshift(newPack);
  saveData();
  closeNewPackWizard();
  openPack(newPack.id);
}

$('#newPackBtn').addEventListener('click', openNewPackWizard);
$$('[data-wizard-cancel]').forEach((btn) => btn.addEventListener('click', closeNewPackWizard));
$$('[data-wizard-back]').forEach((btn) => btn.addEventListener('click', () => showWizardStep(wizardStep - 1)));
$$('[data-wizard-next]').forEach((btn) => btn.addEventListener('click', wizardGoNext));
$$('.wizard-chip').forEach((chip) => chip.addEventListener('click', () => finishWizard(Number(chip.dataset.days))));
$('#finishWizardBtn').addEventListener('click', () => finishWizard());
$('#wizardDestInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') wizardGoNext();
});
$('#wizardDaysInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') finishWizard();
});

function deletePack(packId = selectedPackId) {
  const pack = packs.find((p) => p.id === packId);
  if (!pack) return;
  if (!confirm(`"${pack.name}" 팩을 삭제할까요? (내 장비의 장비는 그대로 남아요)`)) return;
  packs = packs.filter((p) => p.id !== packId);
  saveData();
  if (packId === selectedPackId) {
    selectedPackId = null;
    if (packs.length > 0) {
      openPack(packs[0].id);
    } else {
      openInventory();
    }
  } else {
    renderNav();
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

  // 장비가 하나도 없으면 요약(그래프+통계) 자체를 안 보여줌 — 빈 데이터로 레이아웃만 차지할 필요 없음
  $('.pack-summary').hidden = packItems.length === 0;

  $('#totalWeight').textContent = formatWeight(totalWeight);
  $('#totalPrice').textContent = formatPrice(totalPrice);
  $('#itemCount').textContent = packItems.length;

  if (packItems.length > 0) renderChart(packItems);
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
          backgroundColor: [
            '#5b5bd6', '#2f9e6e', '#dc3b3b', '#b8791e', '#3f8fd1', '#c94f7c',
            '#1f7a54', '#78787f', '#3d3daa', '#a8a8ec', '#8686e0', '#8a5a2b', '#4a4a52',
          ],
          borderColor: '#f7f7f8',
          borderWidth: 2,
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
// 소스 리스트 (드래그 가능한 내 장비, 팩 화면 좌측)
// ============================================
function renderSourceList(filter = '') {
  const container = $('#sourceList');
  container.innerHTML = '';
  $('#sourceCountBadge').textContent = gears.length;

  const q = filter.trim().toLowerCase();
  const visible = gears.filter((g) => g.name.toLowerCase().includes(q) || (g.brand && g.brand.toLowerCase().includes(q)));

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
        <div class="source-item-thumb${g.image ? ' lightbox-trigger' : ''}" ${g.image ? `data-image="${g.image}"` : ''}>${g.image ? `<img src="${g.image}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">` : '🎒'}</div>
        <div class="source-item-info">
          ${g.brand ? `<span class="source-item-brand">${escapeHtml(g.brand)}</span>` : ''}
          <span class="source-item-name">${escapeHtml(g.name)}</span>
        </div>
        <span class="source-item-weight">${formatWeight(g.weight)}</span>
      `;
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', g.id);
        e.dataTransfer.effectAllowed = 'copy';
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => item.classList.remove('dragging'));
      // 클릭으로 실수로 잘못 추가되는 일이 없도록 일부러 클릭 추가는 안 만듦 — 드래그앤드롭만 지원
      group.appendChild(item);
    });

    container.appendChild(group);
  });

  bindLightboxTriggers();
}

$('#sourceSearch').addEventListener('input', (e) => renderSourceList(e.target.value));

// ============================================
// 경계선 간격 조절 — 고무줄처럼 당겼다가 놓으면 원래 자리로 튕겨 돌아감
// (자리는 저장 안 함: 기능적 리사이즈가 아니라 잠깐 넓게 보고 싶을 때 쓰는 제스처)
// 팩 화면 좌/우 분할, 사이드바(내 장비·내 옷·내 팩) 폭 둘 다 같은 방식으로 동작
// ============================================
function initElasticResizeHandle({ targetEl, handleEl, varName, baseW, minW, maxW }) {
  if (!targetEl || !handleEl) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let dragging = false;
  let startX = 0;
  let startW = baseW;
  let rafId = null;

  function setWidth(px) {
    targetEl.style.setProperty(varName, `${px}px`);
  }

  function currentWidth() {
    const v = getComputedStyle(targetEl).getPropertyValue(varName);
    return parseFloat(v) || baseW;
  }

  // easeOutBack 느낌의 커브 — 목표 지점을 살짝 지나쳤다가 돌아오는 탄성 있는 착지감
  function elasticEase(t) {
    const c1 = 1.4;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  }

  function springTo(from, to, duration = 420) {
    if (prefersReducedMotion) {
      setWidth(to);
      return;
    }
    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      setWidth(from + (to - from) * elasticEase(t));
      if (t < 1) rafId = requestAnimationFrame(tick);
    }
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }

  function onPointerDown(clientX) {
    if (rafId) cancelAnimationFrame(rafId);
    dragging = true;
    startX = clientX;
    startW = currentWidth();
    handleEl.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function onPointerMove(clientX) {
    if (!dragging) return;
    const target = startW + (clientX - startX);
    let width;
    if (target < minW) {
      width = minW - Math.sqrt(minW - target) * 6; // 한계 밖으로 갈수록 점점 더 안 늘어나는 고무줄 저항
    } else if (target > maxW) {
      width = maxW + Math.sqrt(target - maxW) * 6;
    } else {
      width = target;
    }
    setWidth(width);
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    handleEl.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    springTo(currentWidth(), baseW); // 놓으면 항상 원래 자리로
  }

  handleEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    onPointerDown(e.clientX);
  });
  window.addEventListener('mousemove', (e) => onPointerMove(e.clientX));
  window.addEventListener('mouseup', onPointerUp);

  handleEl.addEventListener('touchstart', (e) => onPointerDown(e.touches[0].clientX), { passive: true });
  window.addEventListener(
    'touchmove',
    (e) => {
      if (dragging) onPointerMove(e.touches[0].clientX);
    },
    { passive: true }
  );
  window.addEventListener('touchend', onPointerUp);
}

initElasticResizeHandle({
  targetEl: $('#splitLayout'),
  handleEl: $('#splitResizeHandle'),
  varName: '--split-w',
  baseW: 300,
  minW: 200,
  maxW: 480,
});

initElasticResizeHandle({
  targetEl: document.documentElement,
  handleEl: $('#navResizeHandle'),
  varName: '--nav-w',
  baseW: 260,
  minW: 200,
  maxW: 400,
});

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

let lastAddedGearId = null; // 방금 드롭된 장비 — 무게감 있는 착지 애니메이션을 딱 이 줄에만 적용하기 위해

function addGearToPack(packId, gearId) {
  const pack = packs.find((p) => p.id === packId);
  if (!pack) return;
  const existing = pack.items.find((i) => i.gear_id === gearId);
  if (existing) {
    existing.quantity += 1;
  } else {
    pack.items.push({ gear_id: gearId, quantity: 1 });
    lastAddedGearId = gearId;
  }
  saveData();
  renderPackDetail();
}

// 무거운 장비일수록 쿵 하고 눌렸다가 천천히 안착하고, 가벼울수록 톡 튀듯 빠르게 자리잡음 —
// 이 앱의 핵심이 "무게"인 만큼 그 감각을 손끝으로도 느끼게 하려는 장치
function dropLandAnimation(el, grams) {
  const heavy = Math.min(1, grams / 2000); // 2kg 이상이면 가장 무거운 착지감
  const squashY = 0.86 - heavy * 0.16;
  const squashX = 1 + (1 - squashY) * 0.7;
  const duration = 0.3 + heavy * 0.3;
  animate(
    el,
    {
      transform: ['scale(0.5)', `scaleY(${squashY}) scaleX(${squashX})`, 'scale(1.03)', 'scale(1)'],
      opacity: [0, 1, 1, 1],
    },
    { duration, easing: heavy > 0.5 ? [0.32, 1.1, 0.4, 1] : [0.34, 1.8, 0.64, 1] }
  );
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

// 버튼을 여러 번 눌러야 하는 불편함 없이 키보드로 수량을 바로 입력할 수 있게 함 (예: 100개)
function setQtyAbsolute(packId, gearId, rawValue) {
  const pack = packs.find((p) => p.id === packId);
  if (!pack) return;
  const item = pack.items.find((i) => i.gear_id === gearId);
  if (!item) return;
  const qty = Math.max(1, Math.floor(Number(rawValue)) || 1);
  item.quantity = qty;
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

function categoryRowsHtml(categoryItems) {
  return categoryItems
    .map(
      (item) => `
    <tr data-gear-id="${item.id}">
      ${productCellsHtml(item)}
      <td>
        <span class="qty-controls">
          <button class="qty-btn" data-action="dec" data-gear-id="${item.id}">−</button>
          <input type="number" class="qty-input" min="1" value="${item.quantity}" data-gear-id="${item.id}" />
          <button class="qty-btn" data-action="inc" data-gear-id="${item.id}">+</button>
        </span>
      </td>
      <td>${formatWeight(item.weight)}</td>
      <td>${formatPrice(item.price_krw)}</td>
      <td><button class="icon-btn remove-btn" data-gear-id="${item.id}">🗑️</button></td>
    </tr>
  `
    )
    .join('');
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

  // 액세서리 카테고리(배낭 액세서리·쉘터 부속품)가 이 팩에 있고 그 부모 카테고리도 있으면,
  // 별도 섹션으로 안 만들고 부모 섹션 아래에 "장착된" 형태로 중첩해서 보여줌
  const nestedUnder = {}; // parentCategory -> [[accCategory, items], ...]
  const nestedCategories = new Set();
  Object.entries(ACCESSORY_PARENT_CATEGORY).forEach(([accCat, parentCat]) => {
    if (byCategory[accCat] && byCategory[parentCat]) {
      nestedUnder[parentCat] = nestedUnder[parentCat] || [];
      nestedUnder[parentCat].push([accCat, byCategory[accCat]]);
      nestedCategories.add(accCat);
    }
  });

  Object.entries(byCategory).forEach(([category, categoryItems]) => {
    if (nestedCategories.has(category)) return; // 부모 섹션 아래에서 이미 그려짐

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
        <thead><tr><th>이미지</th><th>브랜드</th><th>제품명</th><th>스펙</th><th>수량</th><th>무게</th><th>가격</th><th></th></tr></thead>
        <tbody>${categoryRowsHtml(categoryItems)}</tbody>
      </table>
      ${(nestedUnder[category] || [])
        .map(
          ([accCategory, accItems]) => `
        <div class="accessory-subsection">
          <div class="accessory-subsection-label">⤷ ${accCategory}에 장착</div>
          <table class="category-table category-table--accessory">
            <tbody>${categoryRowsHtml(accItems)}</tbody>
          </table>
        </div>
      `
        )
        .join('')}
    `;
    container.appendChild(section);
  });

  bindLightboxTriggers();

  $$('.qty-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const delta = btn.dataset.action === 'inc' ? 1 : -1;
      changeQty(packId, btn.dataset.gearId, delta);
    });
  });
  $$('.qty-input').forEach((input) => {
    input.addEventListener('change', () => setQtyAbsolute(packId, input.dataset.gearId, input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
  });
  $$('.remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => removeGearFromPack(packId, btn.dataset.gearId));
  });
  $$('.category-table tbody tr').forEach((row) => {
    const gearId = row.dataset.gearId;
    if (gearId && gearId === lastAddedGearId) {
      const gear = items.find((i) => i.id === gearId);
      dropLandAnimation(row, gear ? gear.weight : 0);
    } else {
      fadeInEl(row);
    }
  });
  lastAddedGearId = null;
}

// ============================================
// 장비 추가/수정 모달
// ============================================
let autoFillImage = null;
let editingGearId = null; // null이면 새 장비 추가, 있으면 그 장비 수정 중

function openAddGearModal(gear = null, presetCategory = null) {
  editingGearId = gear ? gear.id : null;

  $('#gearModalTitle').textContent = gear ? '장비 수정' : '장비 추가';
  $('#gearSubmitBtn').textContent = gear ? '저장' : '추가';

  if (gear) {
    $('#linkInput').value = gear.source_url || '';
    $('#brandInput').value = gear.brand || '';
    $('#nameInput').value = gear.name;
    $('#specInput').value = gear.spec || '';
    $('#categoryInput').value = gear.category;
    setNumberInputValue($('#weightInput'), gear.weight);
    setNumberInputValue($('#priceInput'), gear.price_krw);
    autoFillImage = gear.image || null;
  } else if (presetCategory) {
    $('#categoryInput').value = presetCategory;
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
  $('#priceFormRow').classList.remove('needs-input');
  $('#gearModalTitle').textContent = '장비 추가';
  $('#gearSubmitBtn').textContent = '추가';
  editingGearId = null;
  autoFillImage = null;
}

$('#weightInput').addEventListener('input', (e) => formatNumberInput(e.target));
$('#priceInput').addEventListener('input', (e) => formatNumberInput(e.target));

$('#showInventoryBtn').addEventListener('click', () => openInventory());
$('#showClothesBtn').addEventListener('click', () => openInventory('의류'));
$('#welcomeNewPackBtn').addEventListener('click', openNewPackWizard);
$('#addGearBtnMain').addEventListener('click', () => openAddGearModal(null, inventoryFilterCategory));
$('#welcomeAddGearBtn').addEventListener('click', () => openAddGearModal());
$('#closeModalBtn').addEventListener('click', closeAddGearModal);

$('#sharePackBtn').addEventListener('click', async () => {
  const pack = packs.find((p) => p.id === selectedPackId);
  if (!pack) return;

  const packItems = pack.items
    .map((item) => {
      const gear = gears.find((g) => g.id === item.gear_id);
      return gear
        ? {
            name: gear.name,
            brand: gear.brand || null,
            spec: gear.spec || null,
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
    window.open(url, '_blank', 'noopener');
    hint.textContent = '읽기전용 공유 링크를 클립보드에 복사하고 새 창으로 열었어요!';
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

// ============================================
// 팩 CSV(엑셀) 내보내기 — 브라우저에서 바로 다운로드, 서버 왕복 없음
// ============================================
function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

$('#exportPackBtn').addEventListener('click', () => {
  const pack = packs.find((p) => p.id === selectedPackId);
  if (!pack) return;

  const packItems = pack.items
    .map((item) => {
      const gear = gears.find((g) => g.id === item.gear_id);
      return gear ? { ...gear, quantity: item.quantity } : null;
    })
    .filter(Boolean);

  if (packItems.length === 0) {
    alert('내보낼 장비가 없어요. 팩에 장비를 먼저 담아주세요.');
    return;
  }

  const header = ['브랜드', '제품명', '스펙', '카테고리', '수량', '무게(g)', '가격(원)'];
  const rows = packItems.map((g) => [
    csvCell(g.brand),
    csvCell(g.name),
    csvCell(g.spec),
    csvCell(g.category),
    csvCell(g.quantity),
    csvCell(g.weight),
    csvCell(g.price_krw),
  ]);
  // 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM을 붙임
  const csv = '﻿' + [header, ...rows].map((r) => r.join(',')).join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${pack.name || 'pack'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

async function runAutoFill() {
  const url = $('#linkInput').value;
  const hint = $('#autoFillHint');
  const btn = $('#autoFillBtn');
  const label = $('#autoFillBtnLabel');
  const progress = $('#autoFillProgress');
  const retryBtn = $('#autoFillRetryBtn');

  $('#weightFormRow').classList.remove('needs-input');
  $('#priceFormRow').classList.remove('needs-input');
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
    $('#brandInput').value = data.brand || '';
    if (data.spec) {
      $('#specInput').value = data.spec;
    } else if (data.description) {
      $('#specInput').value = data.description.length > 60 ? `${data.description.slice(0, 60).trim()}…` : data.description;
    }
    if (data.weight && data.weight.grams) setNumberInputValue($('#weightInput'), data.weight.grams);
    if (data.price && data.price.amount) setNumberInputValue($('#priceInput'), data.price.amount);
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
      if (missing.includes('가격')) $('#priceFormRow').classList.add('needs-input');
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
    brand: $('#brandInput').value || null,
    spec: $('#specInput').value || null,
    category: $('#categoryInput').value,
    weight: parseNumberInput($('#weightInput')),
    price_krw: parseNumberInput($('#priceInput')),
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
// 공유받은 팩 (읽기전용) 렌더링 — 인쇄용, 그래프/가져오기 없음
// ============================================
function renderShareView(payload) {
  $('#sharePackName').textContent = payload.name || '(제목 없음)';
  const items = payload.items;

  const totalWeight = items.reduce((s, g) => s + g.weight * g.quantity, 0);
  const totalPrice = items.reduce((s, g) => s + g.price_krw * g.quantity, 0);
  $('#shareTotalWeight').textContent = formatWeight(totalWeight);
  $('#shareTotalPrice').textContent = formatPrice(totalPrice);

  renderShareCategoryTables(items);
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
        <thead><tr><th>이미지</th><th>브랜드</th><th>제품명</th><th>스펙</th><th>수량</th><th>무게</th><th>가격</th></tr></thead>
        <tbody>
          ${categoryItems
            .map(
              (item) => `
            <tr>
              ${productCellsHtml(item)}
              <td>${item.quantity}</td>
              <td>${formatWeight(item.weight)}</td>
              <td>${formatPrice(item.price_krw)}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    `;
    container.appendChild(section);
  });

  bindLightboxTriggers();
}

// ============================================
// 이미지 확대 보기 (라이트박스)
// ============================================
// 팩/공유뷰 테이블 공통 컬럼: 이미지 | 브랜드명 | 제품명 | 제품 스펙
function productCellsHtml(item) {
  const thumbContent = item.image
    ? `<img src="${item.image}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`
    : '🎒';
  const thumbClass = item.image ? 'gear-thumb lightbox-trigger' : 'gear-thumb';
  const thumbAttr = item.image ? `data-image="${item.image}"` : '';
  const nameHtml = escapeHtml(item.name);
  const nameEl = item.source_url
    ? `<a class="gear-name-link" href="${item.source_url}" target="_blank" rel="noopener">${nameHtml}</a>`
    : nameHtml;
  const brandHtml = item.brand ? escapeHtml(item.brand) : '<span class="cell-empty">—</span>';
  const specHtml = item.spec ? escapeHtml(item.spec) : '<span class="cell-empty">—</span>';
  const specTitleAttr = item.spec ? `title="${escapeHtml(item.spec)}"` : '';
  return `
    <td class="gear-thumb-cell"><div class="${thumbClass}" ${thumbAttr}>${thumbContent}</div></td>
    <td class="gear-brand-cell">${brandHtml}</td>
    <td class="gear-name-cell">${nameEl}</td>
    <td class="gear-spec-cell" ${specTitleAttr}>${specHtml}</td>
  `;
}

function bindLightboxTriggers() {
  $$('.lightbox-trigger').forEach((el) => {
    el.addEventListener('click', () => openLightbox(el.dataset.image));
  });
}

function openLightbox(src) {
  if (!src) return;
  $('#lightboxImg').src = src;
  $('#imageLightbox').hidden = false;
}

function closeLightbox() {
  $('#imageLightbox').hidden = true;
  $('#lightboxImg').src = '';
}

$('#imageLightbox').addEventListener('click', (e) => {
  if (e.target.id === 'imageLightbox') closeLightbox();
});
$('#lightboxCloseBtn').addEventListener('click', closeLightbox);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#imageLightbox').hidden) closeLightbox();
});

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
renderNav();

const shareParam = new URLSearchParams(location.search).get('share');
if (shareParam) {
  decodeSharePayload(shareParam)
    .then((payload) => {
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
