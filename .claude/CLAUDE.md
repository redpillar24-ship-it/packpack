# PackPack 개발 가이드 (Claude 세션용)

이 문서는 다음 세션에서 맥락을 빠르게 잡기 위한 문서입니다. 코드에서 바로 알 수 있는 내용(파일 목록 등)은 반복하지 않고, **왜 이렇게 만들었는지 / 어떤 함정을 피해야 하는지**를 기록합니다.

## 한 줄 요약

LighterPack에서 영감을 받은 캠핑/등산 장비 관리 웹앱. 제품 링크를 붙여넣으면 서버가 페이지를 파싱해서 이름/이미지/가격/무게를 자동으로 채워준다. 모든 기능은 무료(유료 API 키 없음)로 동작하도록 설계됨.

## 구조

```
public/          프론트엔드 — 순수 HTML/CSS/JS, 빌드 과정 없음
  index.html
  style.css
  script.js
server/
  server.js      Express: 정적 파일 서빙 + /api/extract, /api/rates
  extractor.js   제품 페이지 파싱 (핵심 로직)
  rates.js       환율 조회 + 캐싱
```

- 실행: `npm install && npm start` → `http://localhost:3000`
- 개발 중 자동 재시작: `npm run dev` (`node --watch`)
- 장비 데이터는 **브라우저 localStorage**에만 저장됨 (`packpack_gears` 키). 서버는 DB를 갖지 않는 stateless 파서 역할만 함.

## 데이터 모델 (localStorage `packpack_gears`)

```js
{
  id, name, category, weight, // weight는 항상 그램(g) 단위로 저장
  officialPrice: { amount, currency },  // 공식/정가
  actualPrice:   { amount, currency },  // 실제 지불한 금액 (할인/중고 등으로 다를 수 있음)
  link, image, addedAt
}
```

두 가격을 분리한 이유: 사용자가 "공식 가격"과 "실구매 가격"을 둘 다 추적하고 싶어함 (예: 세일가/중고가로 산 경우). 자동 채우기는 사이트에 표시된 가격을 `officialPrice`에 넣고, `actualPrice`는 기본으로 같은 값을 채워두되 사용자가 직접 수정하게 함.

## 통화 처리 방식 — 중요

**가격은 원래 통화 그대로 저장한다.** 한국 쇼핑몰 링크면 KRW, 일본이면 JPY, 미국이면 USD로 자동 감지되어 저장되고, 강제로 하나의 통화로 변환해서 저장하지 않는다. 화면에 표시할 때만 필요하면 환산한다.

- 통화 감지 우선순위 (`extractor.js`): JSON-LD `Product.offers.priceCurrency` → `og:price:currency` 메타 태그 → 기호(₩/$/€/£/¥) → 그래도 없으면 **도메인 TLD로 추론** (`.kr`→KRW, `.jp`→JPY, `.uk`→GBP, 유럽 TLD→EUR, 그 외→USD 기본값)
- 환율은 `server/rates.js`가 [frankfurter.app](https://frankfurter.app)(ECB 기준, 무료, API 키 불필요)에서 `base=USD`로 한 번만 받아와 6시간 메모리 캐싱. 프론트에서는 USD를 매개로 교차 계산(cross-rate)해서 어떤 통화 조합이든 변환 가능.
  - 코드 형태: `rates.rates[cur]` = "1 USD당 해당 통화 금액". A→B 변환은 `(amount / rates[A]) * rates[B]`.
- 프론트 UI: 상단 "환산 통화" 드롭다운(기본 KRW)으로 **합계(총 공식가/총 실구매가)**는 항상 이 통화로 환산해서 보여줌 (서로 다른 통화를 그냥 더하면 안 되니까). 리스트의 개별 항목은 원래 통화로 보여주다가, 가격 배지(버튼)를 클릭하면 그 항목만 환산 통화로 토글되어 보임 (`convertedBadges` Set, 새로고침하면 초기화되는 세션 상태).

## extractor.js 설계 — 실측으로 찾은 함정들

1. **Accept-Language를 ko-KR로 보내면 안 됨** (또는 그것만으로는 못 막음). 일부 Shopify 스토어(zpacks.com 등)는 **접속 IP의 지역**에 따라 자동으로 다른 통화로 환산된 가격을 내려주면서 `og:price:currency` 태그는 원래 통화("USD")로 잘못 남겨둠. 실측: $749 → "1,085,000"을 "USD"라고 표기. 헤더를 en-US로 고정해도 IP 기반 지역 감지는 못 막는다.
   - 대응: `MAX_REASONABLE_PRICE`로 통화별 "장비 하나 값으로는 비정상적인 금액" 상한을 두고, 넘으면 `confidence: 'low'`로 표시해 사용자가 검증하게 함. 완벽한 해결책은 아님 — 근본적으로 해외 IP 프록시 없이는 100% 막을 수 없는 문제.
2. **무게 정보가 "관련 상품/추천 상품" 섹션에서 잘못 잡히는 문제.** 상품 페이지에는 다른 제품의 스펙(예: 업셀 상품의 무게)이 같이 있는 경우가 많음.
   - 대응: `IRRELEVANT_SECTION_SELECTOR`로 관련상품/리뷰 영역을 먼저 제외하고, `PRODUCT_SECTION_SELECTOR`(본문/스펙 영역으로 추정되는 곳)를 우선 탐색. 거기서 못 찾으면 페이지 전체로 폴백하되 신뢰도를 낮춤.
3. **일부 사이트는 봇을 차단함** (REI, Decathlon 등 → HTTP 403). User-Agent를 일반 브라우저처럼 위장해도 막히는 경우가 있고, 이건 우회하지 않는다 (완전 무료·합법적 스크래핑 범위 내에서만 동작). 실패하면 명확한 에러 메시지를 보여주고 사용자가 수동 입력하게 함.

## 신뢰도(confidence) 시스템

`/api/extract` 응답의 `price.confidence`, `weight.confidence`는 `'high' | 'medium' | 'low'`. 프론트(`script.js`의 `toggleLowConfidence`)는 `low`일 때 해당 입력창 테두리를 주황색(`--color-low-confidence`)으로 표시해서 사용자가 검증하도록 유도한다. **이 신호를 절대 없애지 말 것** — 자동 추출은 본질적으로 부정확할 수 있고, 이게 사용자에게 "확인이 필요하다"는 유일한 신호임.

## 의도적으로 안 만든 것 (로드맵)

- **제품명만으로 검색** (링크 없이 이름만 입력해서 사이트를 자동으로 찾아주는 기능): 무료로 안정적인 검색 수단이 마땅치 않음 (검색엔진 API는 대부분 유료/제한적). 필요해지면 DuckDuckGo HTML 스크래핑 등 조사 필요.
- 여러 개 팩(가방) 관리, 데이터 내보내기/가져오기, 실제 배포 — 아직 미구현.

## 스타일 컨벤션

- 화면에 보이는 텍스트는 전부 한국어.
- 통화 포맷은 `script.js`의 `CURRENCY_META` / `formatMoney()`를 통해서만 하고, 새 통화를 추가할 땐 `CURRENCY_ORDER`와 `CURRENCY_META`에 같이 추가 + `server/rates.js`의 `SYMBOLS`에도 추가해야 환율을 받아올 수 있음.
- 무게는 항상 내부적으로 grams(정수)로 저장하고, 표시할 때만 `formatWeight()`로 1000g 이상이면 kg로 변환.

## 비주얼 디자인 — 울트라라이트 백패킹 정체성

**테마**: 등고선 지형도(topo map) + 실제 등산로 표식(trail blaze) 색상 + 저울 계기판 숫자.

### 팔레트 (CSS 변수 + 다크 모드 지원)
- `--bg-paper` (#EDE7D8): 지형도 용지 톤, 메인 배경
- `--color-primary` (#2F4C3B): 파인 그린, 헤더/버튼/주요 텍스트
- `--color-accent` (#E8590C): 트레일 블레이즈 오렌지, 강조/경고
- `--color-topo` (#C9BFA0): 등고선 갈색, 분할선/테두리
- `--color-low-confidence` (#C99A2E): 머스터드 옐로우, 신뢰도 낮음 표시

### 타이포
- **본문/헤더**: 시스템 폰트(Pretendard 우선) — 한글 가독성
- **모든 숫자** (무게, 가격, 통계): `JetBrains Mono` — "저울 눈금 읽기" 느낌

### 시그니처 요소
1. **헤더 등고선 패턴**: SVG 반복 패턴(페인트칠한 등고선 모양)
2. **카테고리 트레일 블레이즈**: 실제 등산로 색상 코드
   - 쉘터: 파랑(`#2C5F8A`)
   - 수면: 자주(`#6B4A7A`)
   - 조리: 머스터드(`#C99A2E`)
   - 의류: 그레이(`#5C6670`)
   - 신발: 갈색(`#8B5A2B`)
   - 전자: 틸(`#2F7A6B`)
   - 기타: 모랫빛(`#8A8368`)
3. **행택(hang tag) 장비 카드**: 카드 좌상단에 실제 택처럼 움푹한 구멍 SVG 표시 (`.gear-item::before`)

### 다크 모드
자동 지원(`@media prefers-color-scheme: dark`). 용지색 ↔ 어두운 톤으로 반전되고 명도 관계는 유지됨.

### 반응형 세부사항
- 통계 카드: 데스크톱 4열, 모바일 2열
- `JetBrains Mono`는 폰트로 로드하지만 폴백이 있으므로 웹폰트 지연 시에도 서빙 가능
- 모든 인터랙션에 `transition: all 0.2s ease` 적용 — 행택 위 마우스 오버 시 약간 들뜨는 느낌

## 다음 개선 사항

- 더 많은 트레일 블레이즈 카테고리 색상 추가(요청 시)
- 헤더 SVG 등고선을 더 복잡하게 만들기(현재는 기본 4개 원 + 2개 경로)
- 필터 칩의 활성 상태를 카테고리 색상으로 표현(현재는 그린)
