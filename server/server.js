// server/server.js
// 아주 가벼운 Express 서버. 두 가지 일만 함:
// 1) public 폴더(화면)를 그대로 보여줌
// 2) POST /api/extract 로 제품 링크를 받아서 정보를 추출해 돌려줌

const path = require('path');
const express = require('express');
const cors = require('cors');
const { extractProductInfo } = require('./extractor');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function isValidHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

app.post('/api/extract', async (req, res) => {
  const { url } = req.body || {};

  if (!url || typeof url !== 'string' || !isValidHttpUrl(url)) {
    return res.status(400).json({ error: '올바른 제품 링크(URL)를 입력해 주세요.' });
  }

  try {
    const info = await extractProductInfo(url);
    res.json(info);
  } catch (err) {
    console.error('[extract]', url, err.message);
    res.status(502).json({ error: err.message || '정보를 가져오는 중 오류가 발생했습니다.' });
  }
});

app.listen(PORT, () => {
  console.log(`PackPack server running at http://localhost:${PORT}`);
});
