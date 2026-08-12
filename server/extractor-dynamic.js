// server/extractor-dynamic.js
// Puppeteer를 사용한 동적 웹사이트 크롤링
// 네이버 스마트스토어, 지마켓 등 JavaScript 렌더링이 필요한 사이트용

// stealth 플러그인: navigator.webdriver, headless 전용 WebGL/plugin 값 등
// 봇탐지 흔적을 패치해서 로그인벽/차단 확률을 낮춘다 (100% 보장은 아님)
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { isErrorPageTitle } = require('./error-page-detect');
puppeteer.use(StealthPlugin());

// 사이트별 선택자(CSS selector) 정의
const SITE_CONFIGS = {
  'smartstore.naver.com': {
    name: 'Naver SmartStore',
    selectors: {
      title: '[class*="title"]',
      price: '[class*="price"]',
      weight: '[class*="weight"], [class*="option"]',
      image: 'img[alt*="상품"]',
      description: '[class*="description"]',
    },
  },
  'gmarket.co.kr': {
    name: 'G Market',
    selectors: {
      title: 'h1[class*="title"]',
      price: 'span[class*="price"]',
      weight: 'td:contains("무게")',
      image: 'img[class*="product"]',
    },
  },
  'auction.co.kr': {
    name: 'Auction',
    selectors: {
      title: '.itemtitle',
      price: '.num',
      weight: '[data-info*="무게"]',
      image: 'img[class*="thumb"]',
    },
  },
};

let browser = null;

async function initBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: 'new', // 구형 헤드리스보다 실제 크롬에 가까움 (탐지 확률 낮음)
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled', // 자동화 플래그 숨김
        '--window-size=1920,1080',
      ],
    });
  }
  return browser;
}

async function newStealthPage() {
  const page = await (await initBrowser()).newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7' });
  return page;
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

// 제품 페이지 분석해서 이름/이미지/가격 추출
async function extractFromDynamicSite(url) {
  const page = await newStealthPage();
  const timeout = 15000; // 15초로 증가

  try {
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);

    // 더 permissive한 대기 조건
    await page.goto(url, {
      waitUntil: 'domcontentloaded', // networkidle2 대신 더 빠른 옵션
      timeout: 12000,
    }).catch(() => {
      // 로드 실패해도 계속 진행 (일부 페이지는 느릴 수 있음)
      console.log('[extractor-dynamic] 페이지 로드 경고 (계속 진행)');
    });

    // 추가 대기 (JavaScript 렌더링 완료)
    await new Promise(resolve => setTimeout(resolve, 2000)).catch(() => {});

    // 기본 정보 추출
    const pageData = await page.evaluate(() => {
      const getTextContent = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : null;
      };

      return {
        title: document.title,
        ogTitle: document.querySelector('meta[property="og:title"]')?.content,
        ogPrice: document.querySelector('meta[property="og:price:amount"]')?.content,
        ogCurrency: document.querySelector('meta[property="og:price:currency"]')?.content,
        ogImage: document.querySelector('meta[property="og:image"]')?.content,
        ogDescription: document.querySelector('meta[property="og:description"]')?.content,
        bodyText: document.body.innerText.slice(0, 2000), // 2000자까지 확대
      };
    });

    // 로그인벽/차단·에러 페이지에 막혔는지 확인 (stealth 적용해도 뚫리지 않을 수 있음)
    if (!pageData.ogTitle && /로그인.{0,10}(필요|해주세요|후 이용)/.test(pageData.bodyText)) {
      throw new Error('LOGIN_WALL');
    }
    const fallbackTitle = pageData.ogTitle || pageData.title;
    if (isErrorPageTitle(fallbackTitle)) {
      throw new Error('BLOCKED_PAGE');
    }

    // 가격 추출 (숫자 패턴) — 한화 우선
    const krwMatch = pageData.bodyText.match(/[\d,]+(?:원|₩)/);
    const priceMatch = krwMatch || pageData.bodyText.match(/[\d,]+(?:원|₩|\$|€)?/);
    const price = priceMatch ? priceMatch[0].replace(/,/g, '').replace(/원|₩|\$|€/g, '') : null;

    // 결과 조합
    return {
      sourceUrl: url,
      siteName: '네이버 스마트스토어',
      name: pageData.ogTitle || pageData.title || null,
      image: pageData.ogImage,
      price: price ? { amount: price, currency: 'KRW', confidence: 'low' } : null,
      description: pageData.ogDescription,
      weight: null, // 일반적으로 상품 상세에서 수동 입력 필요
    };
  } catch (err) {
    console.error('[extractor-dynamic] 상세 에러:', err);
    throw new Error(`네이버 스마트스토어 크롤링 실패: ${err.message}`);
  } finally {
    try {
      await page.close();
    } catch {}
  }
}

// 특정 사이트의 무게 정보 추출 (더 정교한 파싱)
async function extractWeightFromPage(url) {
  const page = await newStealthPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle2' });

    const weight = await page.evaluate(() => {
      const weightRegex = /(\d[\d,]*)\s*(그램|g|kg|kilograms?)/gi;
      const matches = document.body.innerText.matchAll(weightRegex);
      const results = Array.from(matches);
      return results.length > 0 ? results[0] : null;
    });

    return weight;
  } finally {
    await page.close();
  }
}

module.exports = { extractFromDynamicSite, extractWeightFromPage, closeBrowser };
