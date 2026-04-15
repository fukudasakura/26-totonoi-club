const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'saunas.json');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ---- サウナ行きたいを検索 ----
app.get('/api/search', async (req, res) => {
  try {
    const { keyword } = req.query;
    if (!keyword || keyword.trim() === '') return res.json([]);

    const url = `https://sauna-ikitai.com/search?keyword=${encodeURIComponent(keyword)}`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.5',
        'Referer': 'https://sauna-ikitai.com/',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);
    const results = [];
    const seen = new Set();

    // 構造: .p-saunaItem > a[href] (空) + .p-saunaItem_header > h3
    //                              + .p-saunaItem_content > .p-saunaItem_image > img
    $('.p-saunaItem').each((_, el) => {
      const $el = $(el);

      // リンク（空の a タグ）
      const href = $el.find('a[href*="/saunas/"]').first().attr('href');
      if (!href) return;
      const idMatch = href.match(/\/saunas\/(\d+)/);
      if (!idMatch) return;
      const saunaId = idMatch[1];
      if (seen.has(saunaId)) return;
      seen.add(saunaId);

      // 施設名
      const name = $el.find('h3').first().text().trim();
      if (!name) return;

      // エリア
      const area = $el.find('.p-saunaItem_address').text().replace(/\s+/g, ' ').trim();

      // 画像
      const image = $el.find('.p-saunaItem_image img').attr('src') || null;

      // イキタイ数
      const ikitaiEl = $el.find('[class*="ikitai"], [class*="Ikitai"]');
      const ikitaiText = $el.text();
      const ikitaiMatch = ikitaiText.match(/イキタイ\s*([\d,]+)/);

      const fullUrl = href.startsWith('http')
        ? href
        : `https://sauna-ikitai.com${href}`;

      results.push({
        id: saunaId,
        name,
        url: fullUrl,
        image,
        area,
        ikitai: ikitaiMatch ? ikitaiMatch[1] : null,
      });
    });

    res.json(results.slice(0, 12));
  } catch (error) {
    console.error('検索エラー:', error.message);
    res.status(500).json({ error: '検索に失敗しました。時間をおいて再試行してください。' });
  }
});

// ---- おすすめ一覧取得 ----
app.get('/api/recommendations', (_, res) => {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    res.json([...data].reverse()); // 新しい順
  } catch {
    res.json([]);
  }
});

// ---- おすすめ登録 ----
app.post('/api/recommendations', (req, res) => {
  try {
    const { saunaId, saunaName, saunaUrl, saunaImage, posterName, saunaType, waterBath, relaxArea, comment } = req.body;

    if (!saunaName || !posterName) {
      return res.status(400).json({ error: '施設名と投稿者名は必須です' });
    }

    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);

    const newRec = {
      id: Date.now(),
      saunaId: saunaId || null,
      saunaName,
      saunaUrl: saunaUrl || null,
      saunaImage: saunaImage || null,
      posterName,
      saunaType: saunaType || null,
      waterBath: waterBath || null,
      relaxArea: relaxArea || null,
      comment: comment || '',
      createdAt: new Date().toISOString(),
    };

    data.push(newRec);
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    res.json(newRec);
  } catch (error) {
    console.error('登録エラー:', error.message);
    res.status(500).json({ error: '登録に失敗しました' });
  }
});

// ---- おすすめ削除 ----
app.delete('/api/recommendations/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    const filtered = data.filter(r => r.id !== id);
    fs.writeFileSync(DATA_FILE, JSON.stringify(filtered, null, 2));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: '削除に失敗しました' });
  }
});

app.listen(PORT, () => {
  console.log(`🧖 サウナアプリ起動中！ → http://localhost:${PORT}`);
});
