const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase 設定
const SUPABASE_URL = 'https://fpusfyatdhftklsywkjo.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_4xz9k7DdCslLgyMMwhEQwQ_ZdY9TV5V';
const sbHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ルートを明示的に返す
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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

    $('.p-saunaItem').each((_, el) => {
      const $el = $(el);
      const href = $el.find('a[href*="/saunas/"]').first().attr('href');
      if (!href) return;
      const idMatch = href.match(/\/saunas\/(\d+)/);
      if (!idMatch) return;
      const saunaId = idMatch[1];
      if (seen.has(saunaId)) return;
      seen.add(saunaId);

      const name = $el.find('h3').first().text().trim();
      if (!name) return;

      const area = $el.find('.p-saunaItem_address').text().replace(/\s+/g, ' ').trim();
      const image = $el.find('.p-saunaItem_image img').attr('src') || null;
      const ikitaiText = $el.text();
      const ikitaiMatch = ikitaiText.match(/イキタイ\s*([\d,]+)/);
      const fullUrl = href.startsWith('http') ? href : `https://sauna-ikitai.com${href}`;

      results.push({ id: saunaId, name, url: fullUrl, image, area, ikitai: ikitaiMatch ? ikitaiMatch[1] : null });
    });

    res.json(results.slice(0, 12));
  } catch (error) {
    console.error('検索エラー:', error.message);
    res.status(500).json({ error: '検索に失敗しました。時間をおいて再試行してください。' });
  }
});

// ---- おすすめ一覧取得 ----
app.get('/api/recommendations', async (_, res) => {
  try {
    const { data } = await axios.get(
      `${SUPABASE_URL}/rest/v1/recommendations?order=created_at.desc`,
      { headers: sbHeaders }
    );
    // フロントが期待するキー名に変換
    const mapped = data.map(r => ({
      id: r.id,
      saunaId: r.sauna_id,
      saunaName: r.sauna_name,
      saunaUrl: r.sauna_url,
      saunaImage: r.sauna_image,
      posterName: r.poster_name,
      saunaType: r.sauna_type,
      waterBath: r.water_bath,
      relaxArea: r.relax_area,
      comment: r.comment,
      createdAt: r.created_at,
    }));
    res.json(mapped);
  } catch (error) {
    console.error('一覧取得エラー:', error.message);
    res.json([]);
  }
});

// ---- おすすめ登録 ----
app.post('/api/recommendations', async (req, res) => {
  try {
    const { saunaId, saunaName, saunaUrl, saunaImage, posterName, saunaType, waterBath, relaxArea, comment } = req.body;

    if (!saunaName || !posterName) {
      return res.status(400).json({ error: '施設名と投稿者名は必須です' });
    }

    const { data } = await axios.post(
      `${SUPABASE_URL}/rest/v1/recommendations`,
      {
        sauna_id: saunaId || null,
        sauna_name: saunaName,
        sauna_url: saunaUrl || null,
        sauna_image: saunaImage || null,
        poster_name: posterName,
        sauna_type: saunaType || null,
        water_bath: waterBath || null,
        relax_area: relaxArea || null,
        comment: comment || '',
      },
      { headers: { ...sbHeaders, 'Prefer': 'return=representation' } }
    );

    const r = data[0];
    res.json({
      id: r.id,
      saunaId: r.sauna_id,
      saunaName: r.sauna_name,
      saunaUrl: r.sauna_url,
      saunaImage: r.sauna_image,
      posterName: r.poster_name,
      saunaType: r.sauna_type,
      waterBath: r.water_bath,
      relaxArea: r.relax_area,
      comment: r.comment,
      createdAt: r.created_at,
    });
  } catch (error) {
    console.error('登録エラー:', error.response?.data || error.message);
    res.status(500).json({ error: '登録に失敗しました' });
  }
});

// ---- おすすめ削除 ----
app.delete('/api/recommendations/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await axios.delete(
      `${SUPABASE_URL}/rest/v1/recommendations?id=eq.${id}`,
      { headers: sbHeaders }
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('削除エラー:', error.message);
    res.status(500).json({ error: '削除に失敗しました' });
  }
});

// ---- 訪問記録一覧取得 ----
app.get('/api/visits', async (_, res) => {
  try {
    const { data } = await axios.get(
      `${SUPABASE_URL}/rest/v1/visits?order=visit_date.desc,created_at.desc`,
      { headers: sbHeaders }
    );
    const mapped = data.map(r => ({
      id: r.id,
      saunaId: r.sauna_id,
      saunaName: r.sauna_name,
      saunaUrl: r.sauna_url,
      saunaImage: r.sauna_image,
      visitorName: r.visitor_name,
      visitDate: r.visit_date,
      timeOfDay: r.time_of_day,
      crowdedness: r.crowdedness,
      saunaTemp: r.sauna_temp,
      waterTemp: r.water_temp,
      outdoorSpace: r.outdoor_space,
      amenities: r.amenities,
      comment: r.comment,
      createdAt: r.created_at,
    }));
    res.json(mapped);
  } catch (error) {
    console.error('訪問記録取得エラー:', error.message);
    res.json([]);
  }
});

// ---- 訪問記録登録 ----
app.post('/api/visits', async (req, res) => {
  try {
    const {
      saunaId, saunaName, saunaUrl, saunaImage,
      visitorName, visitDate, timeOfDay, crowdedness,
      saunaTemp, waterTemp, outdoorSpace, amenities, comment
    } = req.body;

    if (!saunaName || !visitorName || !visitDate) {
      return res.status(400).json({ error: '施設名・訪問者名・訪問日は必須です' });
    }

    const { data } = await axios.post(
      `${SUPABASE_URL}/rest/v1/visits`,
      {
        sauna_id: saunaId || null,
        sauna_name: saunaName,
        sauna_url: saunaUrl || null,
        sauna_image: saunaImage || null,
        visitor_name: visitorName,
        visit_date: visitDate,
        time_of_day: timeOfDay || null,
        crowdedness: crowdedness || null,
        sauna_temp: saunaTemp || null,
        water_temp: waterTemp || null,
        outdoor_space: outdoorSpace || null,
        amenities: amenities || [],
        comment: comment || '',
      },
      { headers: { ...sbHeaders, 'Prefer': 'return=representation' } }
    );

    const r = data[0];
    res.json({
      id: r.id,
      saunaId: r.sauna_id,
      saunaName: r.sauna_name,
      saunaUrl: r.sauna_url,
      saunaImage: r.sauna_image,
      visitorName: r.visitor_name,
      visitDate: r.visit_date,
      timeOfDay: r.time_of_day,
      crowdedness: r.crowdedness,
      saunaTemp: r.sauna_temp,
      waterTemp: r.water_temp,
      outdoorSpace: r.outdoor_space,
      amenities: r.amenities,
      comment: r.comment,
      createdAt: r.created_at,
    });
  } catch (error) {
    console.error('訪問記録登録エラー:', error.response?.data || error.message);
    res.status(500).json({ error: '登録に失敗しました' });
  }
});

// ---- 訪問記録削除 ----
app.delete('/api/visits/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await axios.delete(
      `${SUPABASE_URL}/rest/v1/visits?id=eq.${id}`,
      { headers: sbHeaders }
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('訪問記録削除エラー:', error.message);
    res.status(500).json({ error: '削除に失敗しました' });
  }
});

// ---- どのURLでもindex.htmlを返す ----
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🧖 サウナアプリ起動中！ → http://localhost:${PORT}`);
});
