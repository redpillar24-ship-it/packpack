// server/error-page-detect.js
// 봇탐지/차단 페이지가 정상 상품 페이지처럼 파싱되는 걸 막기 위한 공용 판별기.
// 크롤러가 이런 페이지의 <title>을 "상품명"으로 잘못 채워넣는 사고를 방지한다.

const ERROR_PAGE_PATTERNS = [
  /에러\s*페이지/,
  /시스템\s*오류/,
  /페이지를\s*찾을\s*수\s*없/,
  /접근이?\s*거부/,
  /일시적\s*(으로)?\s*(접속|이용)\s*(이)?\s*(제한|불가)/,
  /just a moment/i,
  /attention required/i,
  /access denied/i,
  /404\s*not\s*found/i,
  /forbidden/i,
];

function isErrorPageTitle(title) {
  if (!title) return false;
  return ERROR_PAGE_PATTERNS.some((re) => re.test(title));
}

module.exports = { isErrorPageTitle };
