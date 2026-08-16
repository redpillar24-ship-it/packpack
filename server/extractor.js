// server/extractor.js
// 제품 페이지 URL 하나를 받아서 이름/이미지/가격/무게/특징을 최대한 뽑아내는 모듈.
// 사이트마다 구조가 제각각이라 100% 정확하지는 않음 -> 사용자가 결과를 확인/수정하는 걸 전제로 설계.

const cheerio = require('cheerio');
const { isErrorPageTitle } = require('./error-page-detect');

const WEIGHT_REGEX = /(\d[\d,.]*)\s*(kilograms?|kg|grams?|g|pounds?|lbs?|lb|ounces?|oz)\b/i;
const PRICE_SYMBOL_REGEX = /([₩$€£¥])\s?([\d][\d,.]*)|([\d][\d,.]*)\s?(원|USD|KRW|EUR|JPY|GBP|CNY)/;

// 기호만으로 통화를 표기하는 사이트가 많아서 ISO 코드로 정규화.
// ¥는 엔화/위안화 둘 다 쓰이는데, 국가 감지가 안 될 때는 더 흔한 엔화(JPY)를 기본값으로 삼는다.
const SYMBOL_TO_CURRENCY = { '₩': 'KRW', $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };

// 통화 코드가 전혀 안 잡힐 때 도메인(TLD)으로 대략 추론 (신뢰도는 낮게 취급).
function guessCurrencyFromUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith('.kr')) return 'KRW';
    if (host.endsWith('.jp')) return 'JPY';
    if (host.endsWith('.cn')) return 'CNY';
    if (host.endsWith('.uk') || host.endsWith('.co.uk')) return 'GBP';
    if (/\.(de|fr|es|it|nl|ie|at|fi|pt|be|lu)$/.test(host)) return 'EUR';
    return 'USD'; // .com 등은 기본적으로 달러로 가정
  } catch {
    return null;
  }
}

// 통화별로 "장비 하나 값"으로는 비정상적으로 큰 금액 기준 (초과하면 저신뢰도 처리).
const MAX_REASONABLE_PRICE = {
  KRW: 15_000_000,
  JPY: 1_500_000,
  CNY: 70_000,
  USD: 10_000,
  EUR: 10_000,
  GBP: 10_000,
};

// 일반 브라우저처럼 보이게 하는 헤더. 없으면 많은 쇼핑몰이 요청을 막음.
// 주의: Accept-Language를 ko-KR로 보내면 일부 해외 쇼핑몰(예: Shopify 기반 스토어)이
// 자동으로 원화 환산 가격을 내려주면서도 currency 태그는 그대로 "USD"로 남겨두는 경우가 있어
// 가격이 크게 틀어질 수 있음 (실측: zpacks.com에서 $749 -> "1,085,000 USD"로 오염됨).
// 그래서 일부러 en-US로 고정해 각 사이트의 "기본(canonical)" 통화로 값을 받는다.
const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
};

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: FETCH_HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`페이지를 불러오지 못했습니다 (HTTP ${res.status})`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    throw new Error('이 링크는 HTML 페이지가 아닙니다.');
  }
  return res.text();
}

function extractJsonLd($) {
  const results = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    try {
      const data = JSON.parse(raw);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item && item['@graph']) results.push(...item['@graph']);
        else if (item) results.push(item);
      }
    } catch {
      // 깨진 JSON-LD는 무시
    }
  });
  return results;
}

function findProductLd(ldItems) {
  return ldItems.find((item) => {
    const type = item['@type'];
    if (!type) return false;
    return Array.isArray(type) ? type.includes('Product') : type === 'Product';
  });
}

function extractTitle($, productLd) {
  return (
    (productLd && productLd.name) ||
    $('meta[property="og:title"]').attr('content') ||
    $('meta[name="twitter:title"]').attr('content') ||
    $('title').first().text() ||
    null
  )?.trim() || null;
}

// http:// -> https:// 로 올려주고, "//cdn..." 같은 프로토콜 상대경로도 절대 URL로 만듦
function normalizeImageUrl(url) {
  if (!url) return null;
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://')) return `https://${url.slice(7)}`;
  return url;
}

function isAbsoluteUrl(url) {
  return typeof url === 'string' && /^(https?:)?\/\//i.test(url);
}

function extractImage($, productLd) {
  // 한 페이지에 JSON-LD Product 블록이 여러 개 있고, 그중 하나가 도메인 없는 상대경로("products/x.jpg")
  // 같은 깨진 값을 갖고 있는 경우가 있음(vargooutdoors.com에서 실측 확인) — 절대 URL이 아니면 버리고
  // og:image(항상 절대 URL)로 폴백한다.
  const ldImage = productLd && productLd.image;
  const fromLd = Array.isArray(ldImage) ? ldImage[0] : ldImage;
  if (isAbsoluteUrl(fromLd)) return normalizeImageUrl(fromLd);

  const fromMeta =
    $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || null;
  return normalizeImageUrl(fromMeta);
}

function extractPrice($, productLd) {
  // 1) JSON-LD (가장 신뢰도 높음)
  if (productLd && productLd.offers) {
    const offer = Array.isArray(productLd.offers) ? productLd.offers[0] : productLd.offers;
    if (offer && offer.price) {
      return { value: String(offer.price).replace(/,/g, ''), currency: offer.priceCurrency || null, source: 'jsonld' };
    }
  }

  // 2) meta 태그 (오픈그래프 상품 태그)
  const metaPrice = $('meta[property="product:price:amount"], meta[property="og:price:amount"]').attr('content');
  if (metaPrice) {
    const metaCurrency = $('meta[property="product:price:currency"], meta[property="og:price:currency"]').attr('content');
    return { value: metaPrice.replace(/,/g, ''), currency: metaCurrency || null, source: 'meta' };
  }

  // 3) itemprop="price"
  const itemPropEl = $('[itemprop="price"]').first();
  if (itemPropEl.length) {
    const val = itemPropEl.attr('content') || itemPropEl.text();
    const num = val && val.match(/[\d.]+/);
    if (num) return { value: num[0], currency: null, source: 'itemprop' };
  }

  // 4) class/id에 "price"가 들어간 짧은 텍스트에서 패턴 매칭 (가장 신뢰도 낮음)
  let found = null;
  $('[class*="price" i], [id*="price" i]').each((_, el) => {
    if (found) return;
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if (!text || text.length > 40) return;
    const m = text.match(PRICE_SYMBOL_REGEX);
    if (m) {
      const currency = m[1] ? SYMBOL_TO_CURRENCY[m[1]] : m[4] === '원' ? 'KRW' : m[4] || null;
      found = { value: (m[2] || m[3]).replace(/,/g, ''), currency, source: 'heuristic', raw: m[0] };
    }
  });
  return found;
}

// 페이지 안에는 "관련 상품", "함께 구매하면 좋은 상품" 등 다른 제품 스펙이 같이 있는 경우가 많아서
// 이런 영역은 미리 제거하고 탐색해야 엉뚱한 제품의 무게를 가져오는 걸 줄일 수 있음.
const IRRELEVANT_SECTION_SELECTOR =
  '[class*="related" i], [id*="related" i], [class*="recommend" i], [class*="upsell" i], ' +
  '[class*="cross-sell" i], [class*="you-may-also" i], [class*="also-like" i], [class*="review" i], [id*="review" i]';

// 반대로 이 안에서 찾으면 훨씬 신뢰도가 높은, "상품 본문/스펙" 영역으로 추정되는 곳.
const PRODUCT_SECTION_SELECTOR =
  '[class*="product-info" i], [class*="product-detail" i], [class*="product-single" i], ' +
  '[id*="product-info" i], [id*="product-detail" i], [class*="specification" i], [class*="specs" i], ' +
  '[class*="product-description" i], main';

// "0.2 ounces (7 grams)"처럼 원문에 이미 환산된 g/kg 값이 괄호로 병기된 경우, 그게 제조사가
// 직접 밝힌 값이라 우리가 계산한 환산값(반올림 오차 있음)보다 정확함 — 있으면 그 값을 우선 사용.
const PAREN_METRIC_REGEX = /\(\s*(\d[\d,.]*)\s*(kilograms?|kg|grams?|g)\s*\)/i;

function findWeightCandidates($, $root) {
  const candidates = [];
  $root.find('tr, li, dt, dd, th, td, p, span').each((_, el) => {
    const $el = $(el);
    if ($el.closest(IRRELEVANT_SECTION_SELECTOR).length) return;
    const text = $el.text().trim().replace(/\s+/g, ' ');
    if (!text || text.length > 120) return;
    if (!/weight|무게|중량/i.test(text)) return;
    const m = text.match(WEIGHT_REGEX);
    if (!m) return;
    const paren = text.match(PAREN_METRIC_REGEX);
    candidates.push({
      raw: m[0],
      value: m[1].replace(/,/g, ''),
      unit: normalizeUnit(m[2]),
      context: text,
      explicitMetric: paren ? { value: paren[1].replace(/,/g, ''), unit: normalizeUnit(paren[2]) } : null,
    });
  });
  candidates.sort((a, b) => a.context.length - b.context.length);
  return candidates;
}

function extractWeight($) {
  // 1) 상품 본문/스펙 영역으로 보이는 곳부터 우선 탐색 (신뢰도 높음)
  const scoped = $(PRODUCT_SECTION_SELECTOR);
  if (scoped.length) {
    const scopedCandidates = findWeightCandidates($, scoped);
    if (scopedCandidates.length) return { ...scopedCandidates[0], scoped: true };
  }
  // 2) 못 찾았으면 페이지 전체에서 탐색 (신뢰도 낮음, 관련상품 등 오염 가능)
  const bodyCandidates = findWeightCandidates($, $('body'));
  return bodyCandidates.length ? { ...bodyCandidates[0], scoped: false } : null;
}

function normalizeUnit(unit) {
  const u = unit.toLowerCase();
  if (u.startsWith('kilogram') || u === 'kg') return 'kg';
  if (u.startsWith('gram') || u === 'g') return 'g';
  if (u.startsWith('pound') || u === 'lb' || u === 'lbs') return 'lb';
  if (u.startsWith('ounce') || u === 'oz') return 'oz';
  return u;
}

// lb, oz -> g 로 통일 (앱 내부 저장 단위는 g)
function toGrams({ value, unit }) {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return null;
  switch (unit) {
    case 'kg':
      return Math.round(n * 1000);
    case 'g':
      return Math.round(n);
    case 'lb':
      return Math.round(n * 453.592);
    case 'oz':
      return Math.round(n * 28.3495);
    default:
      return Math.round(n);
  }
}

function extractBrand($, productLd) {
  const ldBrand = productLd && productLd.brand;
  if (ldBrand) {
    if (typeof ldBrand === 'string') return ldBrand.trim();
    if (ldBrand.name) return String(ldBrand.name).trim();
  }
  const metaBrand = $('meta[property="product:brand"], meta[property="og:brand"]').attr('content');
  return metaBrand ? metaBrand.trim() : null;
}

function extractDescription($, productLd) {
  const desc =
    (productLd && productLd.description) ||
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    null;
  return desc ? desc.trim().slice(0, 400) : null;
}

// Shopify 테마 다수가 <script> 안에 현재 보고 있는 상품의 실제 가격/통화/브랜드를 심어둠
// (Shop Pay·Meta Pixel 연동용 initData). og:price 계열 메타태그보다 신뢰도가 훨씬 높음 —
// 일부 테마(zpacks.com에서 실측 확인, 2026-08-12)는 접속 지역에 따라 자동환산된 가격을
// 원래 통화 라벨(예: USD)인 채로 og:price:amount에 잘못 내려버려서, 그 값을 다시 환산하면
// 실제 가격의 몇백~몇천 배로 틀어짐. 상품명이 일치하는 항목만 신뢰해서 관련상품 오염을 막음.
const SHOPIFY_VARIANT_REGEX = /"price":\{"amount":([\d.]+),"currencyCode":"([A-Z]{3})"\},"product":\{"title":"([^"]*)","vendor":"([^"]*)"/g;

function extractShopifyProductData(html, expectedTitle) {
  const normalizedExpected = expectedTitle ? expectedTitle.trim().toLowerCase() : null;
  let fallback = null;
  let m;
  SHOPIFY_VARIANT_REGEX.lastIndex = 0;
  while ((m = SHOPIFY_VARIANT_REGEX.exec(html))) {
    const entry = { amount: m[1], currency: m[2], title: m[3], brand: m[4] || null };
    if (!fallback) fallback = entry;
    if (normalizedExpected && entry.title.trim().toLowerCase() === normalizedExpected) return entry;
  }
  return fallback;
}

// 카테고리별로 봤을 때 "아 이런 장비였지"를 바로 알아볼 수 있는 핵심 스펙 키워드.
// 무게는 이미 별도 weight 필드로 저장하므로 스펙에서는 항상 제외한다(중복 표시 방지).
const CATEGORY_SPEC_HINTS = {
  의류: /size\b|사이즈|small|medium|large|허리|기장|inseam|waist/i,
  신발: /size\b|사이즈|us\s*\d|eu\s*\d|mm\b|볼\s*너비/i,
  침낭: /fill\s*power|down\s*fill|fill\s*weight|comfort|limit|temperature|필파워|충전량|충전\s*중량|컴포트|리밋|온도/i,
  매트: /r-?value|thickness|size|두께|사이즈|알\s*값/i,
  쉘터: /capacity|floor\s*size|footprint|peak\s*height|length|width|height|dimensions?|용량|치수|사이즈|가로|세로|높이|바닥/i,
  '쉘터 부속품': /length|material|dimensions?|size\b|길이|재질|소재|사이즈/i,
  배낭: /capacity|volume|torso|frame\s*size|용량|토르소|프레임/i,
  '배낭 액세서리': /capacity|volume|material|size\b|용량|재질|소재|사이즈/i,
  조리: /capacity|volume|material|용량|재질|소재/i,
  물: /capacity|volume|material|용량|재질|소재/i,
  전자기기: /capacity|mah|battery|watt|용량|배터리|출력/i,
  위생용품: /size|용량|사이즈/i,
  '응급/도구': /size|length|material|사이즈|길이|재질/i,
};

// 카테고리를 못 정했을 때 쓰는 범용 힌트 (무게 제외)
const GENERIC_SPEC_HINT = /capacity|material|dimensions?|volume|size\b|colou?r|fabric|denier|frame\s*height|용량|사이즈|재질|소재|치수|칫수/i;
// "총 무게" 자체만 제외한다 (이미 별도 weight 필드가 있어서 중복) — 라벨 전체가 무게 그 자체일 때만 매치.
// "Fill Weight"/"충전 중량"처럼 침낭 필파워 스펙은 무게가 들어간 이름이어도 성격이 다르므로 살려둔다.
const TOTAL_WEIGHT_LABEL_HINT = /^(total\s*|item\s*|product\s*)?weight$|^(제품\s*)?무게$|^중량$/i;

// "Made from HDPE, a super light-weight material perfect for..." 같은 마케팅 문장에서
// 앞의 군더더기("Made from" 등)를 떼고 첫 콤마/마침표 앞까지만 남겨서 "HDPE"처럼 핵심만 남김.
function cleanSpecValue(value) {
  let v = value.replace(/^(made\s+(from|of|with)|crafted\s+(from|of)|constructed\s+(from|of|with)|built\s+(from|of))\s+/i, '');
  // 소수점(예: "0.12 mm")은 문장부호가 아니므로 숫자 뒤에 오는 마침표는 자르지 않음
  const cutAt = v.search(/,|;|\.(?!\d)/);
  if (cutAt > 1) v = v.slice(0, cutAt);
  return v.trim();
}

function extractSpecBullets($, category) {
  const labelHint = (category && CATEGORY_SPEC_HINTS[category]) || GENERIC_SPEC_HINT;
  const scoped = $(PRODUCT_SECTION_SELECTOR);
  const root = scoped.length ? scoped : $('body');
  const bullets = [];
  const seenLabels = new Set(); // 같은 라벨이 페이지 여러 곳(관련상품 등)에 또 나오면 첫 값만 채택

  const tryPush = (label, value) => {
    if (bullets.length >= 3) return;
    if (TOTAL_WEIGHT_LABEL_HINT.test(label.trim())) return; // 총 무게는 별도 필드가 있으니 스펙엔 안 넣음
    const key = label.toLowerCase();
    if (seenLabels.has(key)) return;
    seenLabels.add(key);
    bullets.push(`${label}: ${value}`);
  };

  // 1순위: <li>라벨: 값</li> 형태의 스펙 목록 (vargooutdoors.com 등에서 흔함) — 이미 라벨+값이
  // 한 줄로 정리돼 있어서 그대로 쓰면 됨.
  root.find('li').each((_, el) => {
    if (bullets.length >= 3) return;
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const m = text.match(/^([^:]{2,30}):\s*(.+)$/);
    if (!m) return;
    const label = m[1].trim();
    if (!labelHint.test(label)) return;
    let value = cleanSpecValue(m[2].trim());
    if (value.length > 40) value = `${value.slice(0, 40).trim()}…`;
    tryPush(label, value);
  });

  // 2순위: <strong>라벨:</strong> 값 형태 (li 목록이 없을 때만)
  if (bullets.length === 0) {
    root.find('strong, b, dt').each((_, el) => {
      if (bullets.length >= 3) return;
      const label = $(el).text().replace(/:\s*$/, '').trim();
      if (!label || label.length > 30 || !labelHint.test(label)) return;

      let value = $(el).parent().clone().find('strong, b, dt').remove().end().text().replace(/\s+/g, ' ').trim();
      if (!value) value = $(el).next('dd').text().replace(/\s+/g, ' ').trim();
      if (!value) return;

      value = cleanSpecValue(value);
      if (value.length > 30) value = `${value.slice(0, 30).trim()}…`;
      tryPush(label, value);
    });
  }

  // 3순위: 라벨 없는 마케팅 문장 안에 알려진 재질명이 언급돼 있으면 그 단어만 뽑아옴.
  // 배낭처럼 원단(본체)과 프레임 재질이 따로 있는 장비는 뭉뚱그려 "재질: X"라고 하면 뭘 말하는지
  // 알 수 없으므로("재질: 카본파이버"만 있으면 원단이 뭔지 모름), "frame/프레임" 근처는 프레임 재질로,
  // 나머지는 원단 재질로 구분해서 최대 2개까지 남긴다. 구분이 안 되면 그냥 "재질"로 표시.
  if (bullets.length === 0) {
    const bodyText = root.text();
    const frameMaterial = findMaterialNearContext(bodyText, FRAME_MATERIALS, /frame|프레임/i);
    const fabricMaterial = findKnownMaterial(bodyText, FABRIC_MATERIALS, frameMaterial);

    if (fabricMaterial) bullets.push(`원단: ${fabricMaterial}`);
    if (frameMaterial && bullets.length < 3) bullets.push(`프레임: ${frameMaterial}`);

    if (bullets.length === 0) {
      const material = findKnownMaterial(bodyText, GENERIC_MATERIALS);
      if (material) bullets.push(`재질: ${material}`);
    }
  }

  return bullets.length ? bullets.join(' · ') : null;
}

// 라벨 없는 문장에서라도 최소한 재질명 정도는 건질 수 있게 하는 알려진 소재 사전.
// 완벽한 목록은 아니고, 실제 백패킹 장비 스펙에 자주 등장하는 것 위주로만.
const FABRIC_MATERIALS = [
  'Ultra 200X', 'Ultra 100X', 'UltraX', 'Dyneema Composite Fabric', 'DCF', 'Dyneema', 'Cuben Fiber',
  'Silnylon', 'Silpoly', 'Robic Nylon', 'Cordura', 'X-Pac', 'Ecopak', 'Ripstop Nylon', 'Ripstop',
  'Gore-Tex', 'eVent', 'HDPE', 'LDPE', 'Tritan', 'TPU', 'Merino Wool',
];
const FRAME_MATERIALS = ['Carbon Fiber', 'Titanium', 'Aluminum', 'Aluminium', 'Stainless Steel', 'DAC', 'Easton'];
const GENERIC_MATERIALS = [...FABRIC_MATERIALS, ...FRAME_MATERIALS, 'Nylon', 'Polyester', 'Down'];

function findKnownMaterial(text, list, exclude = null) {
  if (!text) return null;
  for (const material of list) {
    if (exclude && material.toLowerCase() === exclude.toLowerCase()) continue;
    const escaped = material.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(text)) return material;
  }
  return null;
}

// contextRegex(예: "frame"/"프레임")가 등장하는 위치 앞뒤 80자 안에서만 재질 키워드를 찾음 —
// 문서 전체에서 아무렇게나 매칭하면 원단 재질을 "프레임 재질"로 착각할 수 있음.
function findMaterialNearContext(text, list, contextRegex) {
  if (!text) return null;
  const idx = text.search(contextRegex);
  if (idx === -1) return null;
  const window = text.slice(Math.max(0, idx - 80), idx + 80);
  return findKnownMaterial(window, list);
}

// public/script.js의 CATEGORY_KEYWORDS와 같은 목적 — 서버는 브라우저 모듈을 import 못 하므로
// 우선순위 로직만 최소한으로 복제. 스펙 힌트 선택에만 쓰이고 실제 저장 카테고리는 프론트에서 결정.
const CATEGORY_GUESS_KEYWORDS = [
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

function guessCategoryServer(text) {
  if (!text) return null;
  const match = CATEGORY_GUESS_KEYWORDS.find(([, re]) => re.test(text));
  return match ? match[0] : null;
}

// 일부 해외 쇼핑몰(특히 Shopify Markets)은 접속 IP의 지역에 따라 자동으로 다른 통화로
// 환산된 가격을 내려주면서도 currency 태그는 원래 통화("USD" 등)로 잘못 남겨두는 경우가 있음.
// 완전히 막을 방법은 없어서, 통화 대비 금액이 비정상적으로 큰 경우는 신뢰도를 낮춰서
// 사용자가 직접 확인하도록 함. 통화 자체가 안 잡히면 도메인으로 추론하되 저신뢰도로 표시.
function buildPriceResult(price, url) {
  const amount = Number(price.value);
  let currency = price.currency;
  let confidence = price.source === 'jsonld' || price.source === 'meta' || price.source === 'shopify' ? 'high' : 'low';

  if (!currency) {
    currency = guessCurrencyFromUrl(url);
    confidence = 'low';
  }

  const max = MAX_REASONABLE_PRICE[currency];
  if (max && amount > max) confidence = 'low';

  return { amount: price.value, currency, confidence };
}

function extractSiteName($, url) {
  const og = $('meta[property="og:site_name"]').attr('content');
  if (og) return og.trim();
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

async function extractProductInfo(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const ldItems = extractJsonLd($);
  const productLd = findProductLd(ldItems);

  const title = extractTitle($, productLd);
  if (isErrorPageTitle(title)) {
    throw new Error('BLOCKED_PAGE');
  }
  const image = extractImage($, productLd);
  const weight = extractWeight($);
  const description = extractDescription($, productLd);
  const guessedCategory = guessCategoryServer(`${title || ''} ${description || ''}`);
  const spec = extractSpecBullets($, guessedCategory);
  const siteName = extractSiteName($, url);

  const shopifyData = extractShopifyProductData(html, title);
  const price = shopifyData
    ? { value: shopifyData.amount, currency: shopifyData.currency, source: 'shopify' }
    : extractPrice($, productLd);
  const brand = extractBrand($, productLd) || (shopifyData && shopifyData.brand) || null;

  return {
    sourceUrl: url,
    siteName,
    name: title,
    brand,
    image,
    description,
    spec,
    price: price ? buildPriceResult(price, url) : null,
    weight: weight
      ? {
          grams: toGrams(weight.explicitMetric || weight),
          raw: weight.raw,
          confidence: weight.scoped ? 'medium' : 'low',
        }
      : null,
  };
}

module.exports = { extractProductInfo, MAX_REASONABLE_PRICE };
