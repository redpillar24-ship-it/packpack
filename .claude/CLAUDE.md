# PackPack v2 개발 가이드

이 문서는 다음 세션에서 맥락을 빠르게 잡기 위한 문서입니다. **제품 방향/아직 논의 중인 것은 [SPEC.md](../SPEC.md) 참고** — 이 파일엔 코드 관련 내용만 유지하고 제품 스펙 내용은 중복해서 넣지 않는다.

## 한 줄 요약

**LighterPack.com을 참고한 백패킹 장비 세트 관리 앱.**

사용자는 자신이 소유한 장비를 **마스터 리스트**에 한 번 등록하고, 여행을 계획할 때마다 그 리스트에서 필요한 장비를 선택해서 **팩(Pack)**을 만든다. 각 팩의 총 무게와 가격이 자동으로 계산되고, 카테고리별로 시각화된다.

## 핵심 기능

### 1. 마스터 장비 리스트
- 사용자가 소유한 모든 장비를 등록 (링크로 자동 추출 또는 수동 입력)
- localStorage에 저장
- 카테고리별로 관리 (쉘터, 침낭, 매트, 의류, 신발, 전자기기, 조리, 기타)

### 2. 팩(Pack) 만들기
- "260815 울릉도 주말백패킹" 같은 팩 생성
- 마스터 리스트에서 필요한 장비를 팩에 추가 (수량 조정 가능)
- 팩마다 자동으로 계산: 총 무게, 총 가격, 장비 수

### 3. 시각화
- 도넛 차트: 카테고리별 무게 비율
- 카테고리별 테이블: 각 항목의 무게, 가격, 수량
- 요약 통계: 총 무게, 총 가격

## 아키텍처

### 프론트엔드 (public/)
```
index.html      레이아웃 (좌측 사이드바 + 중앙 메인)
style.css       LighterPack 스타일 (밝고 깔끔함)
script.js       모든 로직 (localStorage 기반)
```

**특징:**
- 마스터 리스트: 좌측 사이드바 (카테고리별 폴더 구조)
- 팩 목록: 좌측 사이드바 (클릭으로 선택)
- 팩 상세: 중앙 (도넛 차트 + 테이블)
- 데이터는 100% 브라우저 localStorage에 저장

### 백엔드 (server/)
```
server.js           Express 서버 (API 엔드포인트)
extractor.js        Cheerio 기반 정적 HTML 파싱
extractor-dynamic.js  Puppeteer 기반 동적 사이트 크롤링
rates.js            환율 조회 (frankfurter.app, 캐시 6시간)
```

**API 엔드포인트:**
- `POST /api/extract` — 제품 링크에서 정보 추출 (Cheerio 또는 Puppeteer)
- `GET /api/rates` — 환율 조회 (USD → KRW)

## 데이터 모델 (localStorage)

### 마스터 장비 (packpack_gears)
```js
[
  {
    id,             // UUID
    name,           // 제품명
    category,       // 쉘터/침낭/매트/의류/신발/전자기기/조리/기타
    weight,         // 무게 (그램, 정수)
    price_krw,      // 가격 (한화, 정수)
    source_url,     // 제품 링크 (선택)
    image,          // 제품 이미지 URL (선택)
    created_at      // 등록일 ISO 문자열
  }
]
```

### 팩 (packpack_packs)
```js
[
  {
    id,             // UUID
    name,           // 팩 이름 (예: "260815 울릉도")
    items: [        // 팩에 포함된 장비
      { gear_id, quantity }
    ],
    created_at,     // 생성일
    trip_date       // 여행 날짜 (선택)
  }
]
```

## 환율 처리

**원칙:** 모든 가격을 **한화(KRW)로 통일해서 저장**.

1. 사용자가 링크를 붙여넣으면 서버가 파싱해서 `price.currency`를 감지
2 `currency !== 'KRW'`이면 frankfurter.app 환율로 즉시 변환해서 저장
3. 화면에는 한화만 표시
4. 좌측 사이드바 하단에 "기준환율" 표시 (참고용)

**Puppeteer 동적 크롤링:**
- 네이버 스마트스토어, 지마켓, 옥션 등 JS 렌더링 필요한 사이트는 Puppeteer로 처리
- Cheerio (정적 파싱)보다 느리지만 더 많은 사이트 지원 가능

## 주의사항

### 1. 환율 자동 변환
- 서버에서 모든 가격을 KRW로 변환해서 저장
- 원래 통화 정보는 `price_original` 필드에 참고용으로만 저장
- 프론트에서는 환율 선택 UI 없음 (한화만)

### 2. 드래그앤드롭 (아직 미구현)
- 현재는 "추가 버튼"으로 팩에 장비를 추가
- v2.1에서 드래그앤드롭 구현 예정 (좌측 마스터 리스트 → 중앙 테이블)

### 3. 이미지
- 자동 추출은 불안정할 수 있음 (신뢰도 낮음)
- 없으면 기본 🎒 이모지 표시

### 4. 모바일
- 태블릿 이하 해상도에서는 사이드바가 상단으로 이동 (flex-direction: column)

## 다음 단계

### Phase 2.1: UI 개선
- [ ] 드래그앤드롭 (좌측 → 중앙)
- [ ] 팩 복제 기능
- [ ] 장비 수정 UI

### Phase 2.2: 기능 확장
- [ ] 팩 공유 (링크/QR)
- [ ] 데이터 내보내기 (JSON, CSV, PDF)
- [ ] 여행 날짜 기반 필터링

### Phase 3: 배포
- [ ] Vercel/Render 무료 배포
- [ ] 도메인 등록

## 개발 팁

**테스트 데이터 추가:**
```js
const testGears = [
  {id: crypto.randomUUID(), name: 'Zpacks Duplex', category: '쉘터', weight: 505, price_krw: 999770, ...},
  {id: crypto.randomUUID(), name: 'Western Mountaineering', category: '침낭', weight: 680, price_krw: 463670, ...}
];
localStorage.setItem('packpack_gears', JSON.stringify(testGears));
location.reload();
```

**로컬 개발:**
```bash
npm install
npm run dev  # node --watch server/server.js
# 또는
npm start    # node server/server.js
```

## 알려진 문제

- REI, Decathlon 등 일부 사이트는 봇 차단 (HTTP 403)
- Puppeteer는 무겁고 느림 (대안 검토 필요)
- 모바일에서 도넛 차트가 작을 수 있음
