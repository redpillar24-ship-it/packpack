// server/rates.js
// 실시간(정확히는 매일 갱신되는) 환율을 무료로 제공하는 frankfurter.app(ECB 기준)을 사용.
// API 키가 필요 없고, 서버 메모리에 6시간 캐싱해서 과도한 외부 호출을 막는다.
//
// 전략: 항상 base=USD 로 한 번만 받아온 뒤, 클라이언트에서 필요한 통화쌍을
// USD를 거쳐 교차 계산(cross-rate)한다. 그러면 통화 조합마다 별도 호출이 필요 없다.

const SYMBOLS = 'KRW,USD,JPY,EUR,GBP,CNY,AUD,CAD,HKD,SGD,TWD,THB';
const TTL_MS = 6 * 60 * 60 * 1000; // 6시간
const FETCH_TIMEOUT_MS = 8000;

let cache = null; // { base, date, rates, fetchedAt }

async function getRates() {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) return cache;

  try {
    const res = await fetch(`https://api.frankfurter.app/latest?base=USD&symbols=${SYMBOLS}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`환율 API 응답 오류 (HTTP ${res.status})`);
    const data = await res.json();

    cache = {
      base: 'USD',
      date: data.date, // 환율 기준일 (frankfurter는 평일 기준 최신 ECB 환율)
      rates: { USD: 1, ...data.rates },
      fetchedAt: now,
    };
    return cache;
  } catch (err) {
    if (cache) return cache; // 실패해도 기존 캐시가 있으면 그거라도 반환 (완전 무료 API라 가끔 불안정할 수 있음)
    throw new Error('환율 정보를 가져오지 못했습니다.');
  }
}

module.exports = { getRates };
