# ♨️26卒整い倶楽部🧖 — CLAUDE.md

beartailの26卒新入社員が「おすすめのサウナ」を共有するための内輪アプリ。

## 技術スタック

| 役割 | 技術 |
|------|------|
| バックエンド | Node.js + Express |
| フロントエンド | Vanilla HTML / CSS / JS（`public/index.html` 1ファイル） |
| DB | Supabase（REST API経由で読み書き） |
| サウナ検索 | サウナ行きたい（sauna-ikitai.com）をスクレイピング |
| AIアシスタント | Anthropic Claude API（サウナクロちゃん） |
| デプロイ | Render |
| リポジトリ | GitHub: fukudasakura/26-totonoi-club |

## ファイル構成

```
サウナアプリ/
├── server.js          # Express サーバー（APIルート）
├── public/
│   └── index.html     # フロントエンド全体（CSS・JS込みの1ファイル）
├── data/
│   └── saunas.json    # Supabase移行前の旧データ（参照用）
├── package.json
└── CLAUDE.md
```

## APIルート

| メソッド | パス | 内容 |
|---------|------|------|
| GET | `/api/search?keyword=...` | sauna-ikitai.comをスクレイピングして施設検索 |
| GET | `/api/recommendations` | Supabaseからおすすめ一覧取得 |
| POST | `/api/recommendations` | おすすめを登録 |
| DELETE | `/api/recommendations/:id` | おすすめを削除 |
| POST | `/api/chat` | サウナクロちゃん（Claude API）チャット |

## 環境変数

```
SUPABASE_KEY=...        # Supabase APIキー（publishable）
ANTHROPIC_API_KEY=...   # Claude API キー
PORT=3000               # デフォルト3000
```

Renderの「Environment Variables」に設定する。ローカルでは `.env` ファイルに書いてもOK。

## フロントエンドのデザイン

- テーマカラー：水色・ブルー系（`--green-dark: #0058a8` など ※変数名がgreenだがブルー）
- CSS変数は `public/index.html` の `:root` で定義
- 浮かぶ絵文字アニメーション・タイトル波アニメーションあり
- レスポンシブ対応（`@media (max-width: 500px)`）

## サウナクロちゃん（AIチャット）

- 右下フローティングの ♨️ ボタンをクリックで開く
- `POST /api/chat` → Supabaseのおすすめ一覧をContextに渡してClaudeが回答
- 会話履歴はブラウザ側で保持（マルチターン対応）
- モデル: `claude-opus-4-6`

## Supabaseテーブル（recommendations）

| カラム | 型 | 内容 |
|--------|----|------|
| id | bigint | 自動採番 |
| sauna_id | text | sauna-ikitai.comのID |
| sauna_name | text | 施設名 |
| sauna_url | text | sauna-ikitai.comのURL |
| sauna_image | text | 画像URL |
| poster_name | text | 投稿者名 |
| sauna_type | text | dry / mist / both |
| water_bath | text | yes / no |
| relax_area | text | yes / no |
| comment | text | ひとことコメント |
| created_at | timestamptz | 作成日時 |

## 過去の主な変更履歴

1. `26卒整い倶楽部 初回リリース` — JSONファイルにデータ保存
2. `fix: Render向けに静的ファイルのパスを修正` — `path.join(__dirname, 'public')`
3. `fix: キャッチオールルートをAPIより後ろに移動` — API前にcatch-allを置いてしまうバグ修正
4. `fix: ルートパスを明示的に返す` — `/` を明示的に返すよう追加
5. `feat: データ保存をSupabaseに移行` — ファイルシステムから永続DBへ
6. サウナクロちゃん追加 — `@anthropic-ai/sdk` 導入、チャットUI実装

## ローカルで動かすには

```bash
npm install
SUPABASE_KEY=xxx ANTHROPIC_API_KEY=xxx npm start
# → http://localhost:3000
```
