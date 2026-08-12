// ===== 설정 =====
const STORAGE_KEY = 'packpack_gears';
let gears = [];
let filteredGears = [];
let currentFilter = 'all';

// ===== 초기화 =====
document.addEventListener('DOMContentLoaded', () => {
    loadGearsFromStorage();
    setupEventListeners();
    renderGearList();
    updateStats();
    updateLastUpdated();
});

// ===== 이벤트 리스너 설정 =====
function setupEventListeners() {
    // 폼 제출
    document.getElementById('gearForm').addEventListener('submit', handleAddGear);

    // 필터 버튼
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', handleFilterChange);
    });

    // 이미지 파일 입력 미리보기
    document.getElementById('image').addEventListener('change', handleImageSelect);
}

// ===== 장비 추가 =====
function handleAddGear(e) {
    e.preventDefault();

    const name = document.getElementById('productName').value.trim();
    const category = document.getElementById('category').value;
    const weight = parseFloat(document.getElementById('weight').value) || 0;
    const price = parseFloat(document.getElementById('price').value) || 0;
    const quantity = parseInt(document.getElementById('quantity').value) || 1;
    const description = document.getElementById('description').value.trim();
    const imageInput = document.getElementById('image');

    // 이미지 처리
    let imageData = null;
    if (imageInput.files && imageInput.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => {
            imageData = e.target.result;
            addGear(name, category, weight, price, quantity, description, imageData);
            resetForm();
        };
        reader.readAsDataURL(imageInput.files[0]);
    } else {
        addGear(name, category, weight, price, quantity, description, null);
        resetForm();
    }
}

function addGear(name, category, weight, price, quantity, description, image) {
    const gear = {
        id: 'gear-' + Date.now(),
        name,
        category,
        weight,
        price,
        quantity,
        description,
        image,
        createdAt: new Date().toISOString().split('T')[0]
    };

    gears.push(gear);
    saveGearsToStorage();
    renderGearList();
    updateStats();
    updateLastUpdated();
}

// ===== 폼 리셋 =====
function resetForm() {
    document.getElementById('gearForm').reset();
    document.getElementById('quantity').value = '1';
}

// ===== 장비 삭제 =====
function deleteGear(id) {
    if (confirm('정말 삭제하시겠습니까?')) {
        gears = gears.filter(g => g.id !== id);
        saveGearsToStorage();
        renderGearList();
        updateStats();
    }
}

// ===== 장비 편집 =====
function editGear(id) {
    const gear = gears.find(g => g.id === id);
    if (!gear) return;

    // 폼에 데이터 채우기
    document.getElementById('productName').value = gear.name;
    document.getElementById('category').value = gear.category;
    document.getElementById('weight').value = gear.weight;
    document.getElementById('price').value = gear.price;
    document.getElementById('quantity').value = gear.quantity;
    document.getElementById('description').value = gear.description;

    // 스크롤해서 폼으로 이동
    document.querySelector('.form-section').scrollIntoView({ behavior: 'smooth' });

    // 기존 장비 삭제 후 추가하도록 함
    gears = gears.filter(g => g.id !== id);
    saveGearsToStorage();
    renderGearList();
    updateStats();
}

// ===== 필터 변경 =====
function handleFilterChange(e) {
    // 활성 버튼 업데이트
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    e.target.classList.add('active');

    currentFilter = e.target.getAttribute('data-category');
    renderGearList();
}

// ===== 리스트 렌더링 =====
function renderGearList() {
    const listContainer = document.getElementById('gearList');

    // 필터 적용
    if (currentFilter === 'all') {
        filteredGears = gears;
    } else {
        filteredGears = gears.filter(g => g.category === currentFilter);
    }

    // 렌더링
    if (filteredGears.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <p>${currentFilter === 'all'
                    ? '아직 추가된 장비가 없습니다. 첫 번째 장비를 추가해보세요! 🚀'
                    : '이 카테고리에 장비가 없습니다.'}</p>
            </div>
        `;
        return;
    }

    listContainer.innerHTML = filteredGears.map(gear => `
        <div class="gear-item">
            ${gear.image
                ? `<img src="${gear.image}" alt="${gear.name}" class="gear-image">`
                : `<div class="gear-image placeholder">📦</div>`
            }
            <div class="gear-info">
                <div class="gear-name">${escapeHtml(gear.name)}</div>
                <div class="gear-category">${gear.category}</div>
                ${gear.description ? `<div class="gear-description">"${escapeHtml(gear.description)}"</div>` : ''}
                <div class="gear-details">
                    <div class="detail-item">
                        <span class="detail-label">무게:</span>
                        <span>${(gear.weight * gear.quantity / 1000).toFixed(2)} kg</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">가격:</span>
                        <span>$${(gear.price * gear.quantity).toFixed(2)}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">수량:</span>
                        <span>${gear.quantity}</span>
                    </div>
                </div>
            </div>
            <div class="gear-actions">
                <button class="btn btn-small btn-edit" onclick="editGear('${gear.id}')">✏️ 편집</button>
                <button class="btn btn-small btn-delete" onclick="deleteGear('${gear.id}')">🗑️ 삭제</button>
            </div>
        </div>
    `).join('');
}

// ===== 통계 업데이트 =====
function updateStats() {
    let totalWeight = 0;
    let totalPrice = 0;
    let totalItems = 0;

    gears.forEach(gear => {
        totalWeight += gear.weight * gear.quantity;
        totalPrice += gear.price * gear.quantity;
        totalItems += gear.quantity;
    });

    // 무게를 kg으로 변환
    const weightInKg = (totalWeight / 1000).toFixed(2);

    document.getElementById('totalWeight').textContent = `${weightInKg} kg`;
    document.getElementById('totalPrice').textContent = `$${totalPrice.toFixed(2)}`;
    document.getElementById('totalItems').textContent = totalItems;
}

// ===== 마지막 업데이트 표시 =====
function updateLastUpdated() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    document.getElementById('lastUpdated').textContent = `Last updated: ${dateStr}`;
}

// ===== LocalStorage 저장/로드 =====
function saveGearsToStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gears));
}

function loadGearsFromStorage() {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
        try {
            gears = JSON.parse(data);
        } catch (e) {
            console.error('Failed to load gears from storage:', e);
            gears = [];
        }
    }
}

// ===== 이미지 선택 처리 =====
function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    // 파일 크기 확인 (5MB 이상이면 경고)
    if (file.size > 5 * 1024 * 1024) {
        alert('파일이 너무 큽니다. 5MB 이하의 이미지를 선택해주세요.');
        e.target.value = '';
    }
}

// ===== 보안: HTML 이스케이프 =====
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}
