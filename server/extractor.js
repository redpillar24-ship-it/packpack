// server/extractor.js
// 제품 페이지 URL 하나를 받아서 이름/이미지/가격/무게/특징을 최대한 뽑아내는 모듈.
// 사이트마다 구조가 제각각이라 100% 정확하지는 않음 -> 사용자가 결과를 확인/수정하는 걸 전제로 설계.

const cheerio = require('cheerio');

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

function extractImage($, productLd) {
  const ldImage = productLd && productLd.image;
  const fromLd = Array.isArray(ldImage) ? ldImage[0] : ldImage;
  return (
    fromLd ||
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    null
  );
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

function findWeightCandidates($, $root) {
  const candidates = [];
  $root.find('tr, li, dt, dd, th, td, p, span').each((_, el) => {
    const $el = $(el);
    if ($el.closest(IRRELEVANT_SECTION_SELECTOR).length) return;
    const text = $el.text().trim().replace(/\s+/g, ' ');
    if (!text || text.length > 120) return;
    if (!/weight|무게|중량/i.test(text)) return;
    const m = text.match(WEIGHT_REGEX);
    if (m) candidates.push({ raw: m[0], value: m[1].replace(/,/g, ''), unit: normalizeUnit(m[2]), context: text });
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

function extractDescription($, productLd) {
  const desc =
    (productLd && productLd.description) ||
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    null;
  return desc ? desc.trim().slice(0, 400) : null;
}

// 일부 해외 쇼핑몰(특히 Shopify Markets)은 접속 IP의 지역에 따라 자동으로 다른 통화로
// 환산된 가격을 내려주면서도 currency 태그는 원래 통화("USD" 등)로 잘못 남겨두는 경우가 있음.
// 완전히 막을 방법은 없어서, 통화 대비 금액이 비정상적으로 큰 경우는 신뢰도를 낮춰서
// 사용자가 직접 확인하도록 함. 통화 자체가 안 잡히면 도메인으로 추론하되 저신뢰도로 표시.
function buildPriceResult(price, url) {
  const amount = Number(price.value);
  let currency = price.currency;
  let confidence = price.source === 'jsonld' || price.source === 'meta' ? 'high' : 'low';

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
  const image = extractImage($, productLd);
  const price = extractPrice($, productLd);
  const weight = extractWeight($);
  const description = extractDescription($, productLd);
  const siteName = extractSiteName($, url);

  return {
    sourceUrl: url,
    siteName,
    name: title,
    image,
    description,
    price: price ? buildPriceResult(price, url) : null,
    weight: weight
      ? { grams: toGrams(weight), raw: weight.raw, confidence: weight.scoped ? 'medium' : 'low' }
      : null,
  };
}

module.exports = { extractProductInfo };
