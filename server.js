require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// Slack 設定
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '';
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

// Anthropic 設定
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

// Supabase 設定
const SUPABASE_URL = 'https://fpusfyatdhftklsywkjo.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_4xz9k7DdCslLgyMMwhEQwQ_ZdY9TV5V';
const sbHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

app.use(cors());
// Slack署名検証用にrawBodyを保存
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf.toString(); },
}));
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
      saunaArea: r.sauna_area,
      posterName: r.poster_name,
      saunaType: r.sauna_type,
      waterBath: r.water_bath,
      relaxArea: r.relax_area,
      comment: r.comment,
      likes: r.likes || 0,
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
    const { saunaId, saunaName, saunaUrl, saunaImage, saunaArea, posterName, saunaType, waterBath, relaxArea, comment } = req.body;

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
        sauna_area: saunaArea || null,
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
      saunaArea: r.sauna_area,
      posterName: r.poster_name,
      saunaType: r.sauna_type,
      waterBath: r.water_bath,
      relaxArea: r.relax_area,
      comment: r.comment,
      likes: r.likes || 0,
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

// ---- いいねトグル ----
app.post('/api/recommendations/:id/like', async (req, res) => {
  try {
    const id = req.params.id;
    const { delta } = req.body; // +1 or -1

    // 現在の値を取得
    const { data: current } = await axios.get(
      `${SUPABASE_URL}/rest/v1/recommendations?id=eq.${id}&select=likes`,
      { headers: sbHeaders }
    );
    if (!current.length) return res.status(404).json({ error: '見つかりません' });

    const newLikes = Math.max(0, (current[0].likes || 0) + (delta || 1));

    const { data } = await axios.patch(
      `${SUPABASE_URL}/rest/v1/recommendations?id=eq.${id}`,
      { likes: newLikes },
      { headers: { ...sbHeaders, 'Prefer': 'return=representation' } }
    );

    res.json({ likes: data[0].likes });
  } catch (error) {
    console.error('いいねエラー:', error.response?.data || error.message);
    res.status(500).json({ error: 'いいねに失敗しました' });
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
      saunaArea: r.sauna_area,
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
      saunaId, saunaName, saunaUrl, saunaImage, saunaArea,
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
        sauna_area: saunaArea || null,
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
      saunaArea: r.sauna_area,
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

// ---- Slack署名検証 ----
function verifySlackSignature(req) {
  if (!SLACK_SIGNING_SECRET) return true; // ローカルテスト用
  const timestamp = req.headers['x-slack-request-timestamp'];
  const sig = req.headers['x-slack-signature'];
  if (!timestamp || !sig) return !SLACK_SIGNING_SECRET; // ヘッダーなし＆Secret未設定ならローカルテスト通す
  // 5分以上古いリクエストは拒否
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const base = `v0:${timestamp}:${req.rawBody}`;
  const hash = 'v0=' + crypto.createHmac('sha256', SLACK_SIGNING_SECRET).update(base).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(sig));
}

// ---- Slackイベント受信 ----
app.post('/api/slack/events', async (req, res) => {
  // URL verification (Slack初回設定時)
  if (req.body.type === 'url_verification') {
    return res.json({ challenge: req.body.challenge });
  }

  // 署名検証
  if (!verifySlackSignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // イベント処理（非同期で応答は先に返す）
  res.status(200).send('ok');

  try {
    const event = req.body.event;
    if (!event || event.type !== 'message' || event.subtype || event.bot_id) return;

    // 対象チャンネルチェック
    if (SLACK_CHANNEL_ID && event.channel !== SLACK_CHANNEL_ID) return;

    const text = event.text || '';
    if (!text.trim()) return;

    // 重複チェック（slack_ts）
    const { data: existing } = await axios.get(
      `${SUPABASE_URL}/rest/v1/sauna_events?slack_ts=eq.${event.ts}&select=id`,
      { headers: sbHeaders }
    );
    if (existing && existing.length > 0) return;

    // Slackユーザー名を取得
    let posterName = 'unknown';
    try {
      const userRes = await axios.get(`https://slack.com/api/users.info?user=${event.user}`, {
        headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` },
      });
      if (userRes.data.ok) {
        posterName = userRes.data.user.profile.display_name || userRes.data.user.real_name || 'unknown';
      }
    } catch { /* ignore */ }

    // Claude APIでサウナ情報を抽出
    const extracted = await extractSaunaEvent(text);
    if (!extracted) return; // サウナ関連じゃない投稿はスキップ

    // SlackメッセージURL生成
    const messageUrl = `https://beartail.slack.com/archives/${event.channel}/p${event.ts.replace('.', '')}`;

    // Supabaseに保存
    await axios.post(
      `${SUPABASE_URL}/rest/v1/sauna_events`,
      {
        sauna_name: extracted.saunaName || null,
        location: extracted.location || null,
        event_date: extracted.eventDate || null,
        meet_time: extracted.meetTime || null,
        end_time: extracted.endTime || null,
        poster_name: posterName,
        slack_message_url: messageUrl,
        slack_ts: event.ts,
        raw_text: text.slice(0, 500),
      },
      { headers: { ...sbHeaders, 'Prefer': 'return=representation' } }
    );
    console.log('サウナイベント保存:', extracted.saunaName || '(名称不明)');
  } catch (error) {
    console.error('Slackイベント処理エラー:', error.response?.data || error.message);
  }
});

// ---- Claude APIでサウナ情報抽出 ----
async function extractSaunaEvent(text) {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `以下のSlack投稿からサウナの予定情報を抽出してください。
サウナに関係ない投稿の場合は "null" とだけ返してください。

投稿内容：
${text}

以下のJSON形式で返してください（該当しない項目はnull）：
{"saunaName":"施設名","location":"場所（都道府県・市区町村）","eventDate":"YYYY-MM-DD","meetTime":"HH:MM","endTime":"HH:MM"}`,
      }],
    });

    const content = response.content[0].text.trim();
    if (content === 'null' || content === '"null"') return null;

    // JSONを抽出
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error('AI抽出エラー:', error.message);
    return null;
  }
}

// ---- サウナイベント手動登録 ----
app.post('/api/events', async (req, res) => {
  try {
    const { saunaName, location, eventDate, meetTime, endTime, posterName } = req.body;

    if (!saunaName || !eventDate || !posterName) {
      return res.status(400).json({ error: 'サウナ名・日付・投稿者名は必須です' });
    }

    const { data } = await axios.post(
      `${SUPABASE_URL}/rest/v1/sauna_events`,
      {
        sauna_name: saunaName,
        location: location || null,
        event_date: eventDate,
        meet_time: meetTime || null,
        end_time: endTime || null,
        poster_name: posterName,
      },
      { headers: { ...sbHeaders, 'Prefer': 'return=representation' } }
    );

    const r = data[0];
    res.json({
      id: r.id,
      saunaName: r.sauna_name,
      location: r.location,
      eventDate: r.event_date,
      meetTime: r.meet_time,
      endTime: r.end_time,
      posterName: r.poster_name,
      createdAt: r.created_at,
    });
  } catch (error) {
    console.error('イベント登録エラー:', error.response?.data || error.message);
    res.status(500).json({ error: '登録に失敗しました' });
  }
});

// ---- サウナイベント一覧取得 ----
app.get('/api/events', async (_, res) => {
  try {
    const { data } = await axios.get(
      `${SUPABASE_URL}/rest/v1/sauna_events?order=event_date.desc.nullslast,created_at.desc`,
      { headers: sbHeaders }
    );
    const mapped = data.map(r => ({
      id: r.id,
      saunaName: r.sauna_name,
      location: r.location,
      eventDate: r.event_date,
      meetTime: r.meet_time,
      endTime: r.end_time,
      posterName: r.poster_name,
      slackMessageUrl: r.slack_message_url,
      rawText: r.raw_text,
      createdAt: r.created_at,
    }));
    res.json(mapped);
  } catch (error) {
    console.error('イベント取得エラー:', error.message);
    res.json([]);
  }
});

// ---- どのURLでもindex.htmlを返す ----
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🧖 サウナアプリ起動中！ → http://localhost:${PORT}`);
});
