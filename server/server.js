// server/server.js
// PackPack v2: 마스터 장비 리스트 + 팩(Pack) 시스템
//
// 데이터는 localStorage처럼 브라우저 로컬 저장소를 주 저장소로 사용
// 서버는: 링크 파싱, 환율 조회, 스키마 검증만 담당

const path = require('path');
const express = require('express');
const cors = require('cors');
const { extractProductInfo } = require('./extractor');
const { extractFromDynamicSite } = require('./extractor-dynamic');
const { getRates } = require('./rates');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ============================================
// 유틸리티
// ============================================

function isValidHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const DYNAMIC_SITES = ['smartstore.naver.com', 'gmarket.co.kr', 'auction.co.kr'];

// ============================================
// API: 제품 정보 추출 (링크 기반)
// ============================================
/**
 * POST /api/extract
 * 제품 링크에서 정보를 추출합니다.
 *
 * Request: { url: "https://..." }
 * Response: {
 *   sourceUrl: string,
 *   name: string,
 *   image: string | null,
 *   price: { amount: string, currency: "KRW", confidence: "high" | "medium" | "low" },
 *   weight: { grams: number, raw: string, confidence: "high" | "medium" | "low" } | null,
 *   description: string | null,
 *   siteName: string | null
 * }
 */
app.post('/api/extract', async (req, res) => {
  const { url } = req.body || {};

  if (!url || typeof url !== 'string' || !isValidHttpUrl(url)) {
    return res.status(400).json({ error: '올바른 제품 링크(URL)를 입력해 주세요.' });
  }

  try {
    const hostname = getHostname(url);
    let info;

    // 동적 사이트인지 확인
    const isDynamic = DYNAMIC_SITES.some((site) => hostname.includes(site));

    if (isDynamic) {
      console.log(`[extract] 동적 사이트 크롤링: ${hostname}`);
      info = await extractFromDynamicSite(url);
    } else {
      console.log(`[extract] 정적 사이트 파싱: ${hostname}`);
      info = await extractProductInfo(url);
    }

    // 가격을 한화(KRW)로 통일 (환율 이용)
    if (info.price && info.price.currency !== 'KRW') {
      const rates = await getRates();
      if (rates && rates.rates[info.price.currency]) {
        const originalAmount = Number(info.price.amount);
        const krwAmount = Math.round((originalAmount / rates.rates[info.price.currency]) * rates.rates['KRW']);
        info.price_original = { amount: info.price.amount, currency: info.price.currency };
        info.price = { amount: String(krwAmount), currency: 'KRW', confidence: 'low' }; // 환산이라 신뢰도 낮춤
      }
    }

    res.json(info);
  } catch (err) {
    console.error('[extract]', url, err.message);
    res.status(502).json({ error: err.message || '정보를 가져오는 중 오류가 발생했습니다.' });
  }
});

// ============================================
// API: 환율 조회
// ============================================
/**
 * GET /api/rates
 * 현재 환율(USD → KRW)을 반환합니다 (캐시됨, 6시간 유효).
 */
app.get('/api/rates', async (req, res) => {
  try {
    const data = await getRates();
    res.json(data);
  } catch (err) {
    console.error('[rates]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ============================================
// 헬스 체크
// ============================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ============================================
// 에러 핸들링
// ============================================
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

// ============================================
// 서버 시작
// ============================================
app.listen(PORT, () => {
  console.log(`✨ PackPack server running at http://localhost:${PORT}`);
  console.log(`   - API: http://localhost:${PORT}/api/extract`);
  console.log(`   - Rates: http://localhost:${PORT}/api/rates`);
});

// 프로세스 종료 시 Puppeteer 정리
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  const { closeBrowser } = require('./extractor-dynamic');
  await closeBrowser();
  process.exit(0);
});
