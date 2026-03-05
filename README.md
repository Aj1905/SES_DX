# SES Matching Automation

SES事業におけるエンジニア人材と案件のマッチング業務を自動化するGoogle Apps Scriptアプリケーション。

## 概要

Gmail経由で届くエンジニア人材メール・案件メールを自動的に解析し、既存データベース（Spreadsheet）とマッチングを行い、マッチした候補に対してメール下書きを生成する。

## 処理フロー

```
1. Gmail取得     : 処理中・処理済・処理失敗ラベルのいずれもないスレッドをバッチ取得
2. 取込(INGEST)  : メール内容をrawInboxシートに記録
3. 抽出(PARSE)   : メールから構造化データを抽出（後述「抽出アルゴリズム」参照）
4. 正規化(NORMALIZE) : 統一スキーマに変換し、人材DB or 案件DBに保存
5. マッチング(MATCH)  : 案件↔エンジニアのスコアリング
6. 下書き(DRAFT)      : マッチ候補宛のメール下書きを作成
7. 記録(LOG)          : 全ステージの処理結果をprocessLogに記録
```

## ラベル遷移

```
（ラベルなし） → 処理中 → 処理済
                          → 処理失敗（エラー時）
```

前回バッチでタイムアウト等により処理中のまま残留したスレッドは、次回バッチ開始時にProcessLogを確認し、完了済みなら処理済、未完了なら処理失敗に振り分ける。

## 抽出アルゴリズム（Extraction.gs）

### モード選択

`Extraction.gs` 冒頭の定数 `EXTRACTION_MODE` で切り替える。

| モード | 値 | 概要 |
|--------|-----|------|
| AI丸投げモード | `ai_full` | 分類・抽出を全てAIで行う（AI呼び出し2回） |
| アルゴリズム併用モード | `hybrid` | 可能な限りアルゴリズムで行い、残りをAIで補填 |

### 定数リスト（4つ）

抽出処理の前提となる定数。全て `Extraction.gs` 内で定義。

| # | 定数名 | 役割 |
|---|--------|------|
| 1 | `STRIP_CHARS` | 除去する記号リスト（トークン節約のため不要な記号を除去） |
| 2 | `STRIP_PHRASES` | 除去する定型文リスト（「お世話になっております」等） |
| 3 | `ENGINEER_FIELDS` | 人材メールから取得する情報（氏名, スキル, 最寄駅, 希望単価 等） |
| 4 | `PROJECT_FIELDS` | 案件メールから取得する情報（案件名, 必須スキル, 単価, 勤務地 等） |

### AI丸投げモードの処理フロー

```
[1] 分類
    メールタイトルだけをAIに投げる
    → 「人材メール」or「案件メール」を判定
    → 判定不能なら処理失敗（throw）

    テキスト前処理
    タイトル＋本文を結合
    → STRIP_CHARS の記号を除去
    → STRIP_PHRASES の定型文を除去
    → 連続する空白を1つに潰す

[2] フィールド抽出
    分類結果に応じて ENGINEER_FIELDS or PROJECT_FIELDS を選択
    → クリーニング済みテキスト＋フィールドリストをAIに投げる
    → 各フィールドの値を取得
```

### アルゴリズム併用モードの処理フロー

```
[1] 分類
    アルゴリズムで分類を試みる（現在は未実装 → 常にAIにフォールバック）
    → 判定不能ならAIで分類（AI丸投げモードと同じ）

    テキスト前処理（AI丸投げモードと同じ）

[2] フィールド抽出
    アルゴリズムでフィールド抽出を試みる（現在は未実装 → 全フィールドがAI行き）
    → アルゴリズムで取得できなかったフィールドのみAIで補填
    → アルゴリズム結果を優先し、不足分をAIの結果で埋める
```

アルゴリズム未実装の状態では AI丸投げモードと同等の動作になる。アルゴリズムを追加するほどAI呼び出しのトークン消費が減る設計。

## ファイル構成

| ファイル | 責務 |
|---------|------|
| `Main.gs` | エントリーポイント（setupApp / runBatch） |
| `Config.gs` | スクリプトプロパティの読み込みとバリデーション |
| `Bootstrap.gs` | Gmailラベル・シート・トリガーの初期セットアップ |
| `Extraction.gs` | 抽出パイプライン（AI丸投げ / アルゴリズム併用） |
| `AiClients.gs` | AIプロバイダのAPIアダプタ |
| `Normalization.gs` | 抽出データの正規化 |
| `Processing.gs` | 処理フロー全体の統括 |
| `Matcher.gs` | マッチングスコアリング |
| `Repositories.gs` | Gmail・Spreadsheetの永続化層 |
| `DraftsAndAlerts.gs` | メール下書き生成・エラー通知 |
| `Utils.gs` | 共通ユーティリティ |

## セットアップ

### 1. スクリプトプロパティの設定

GASエディタの「プロジェクトの設定」→「スクリプトプロパティ」に以下を設定する。

| プロパティ | 必須 | 説明 | 例 |
|-----------|------|------|----|
| `SPREADSHEET_ID` | Yes | データ保存先SpreadsheetのID | `1abc...xyz` |
| `MANAGER_ALERT_EMAIL` | Yes | エラー通知先メールアドレス | `manager@example.com` |
| `AI_PROVIDER` | Yes | AIプロバイダ種別 | `openai_compatible` |
| `AI_API_URL` | Yes | AI APIエンドポイント | `https://api.openai.com/v1/chat/completions` |
| `AI_API_KEY` | Yes | AI APIキー | `sk-...` |
| `AI_MODEL` | Yes | 使用モデル名 | `gpt-4o-mini` |
| `PROCESSING_LABEL` | Yes | 処理中ラベル名 | `処理中` |
| `PROCESSED_LABEL` | Yes | 処理済ラベル名 | `処理済` |
| `ERROR_LABEL` | Yes | 処理失敗ラベル名 | `処理失敗` |
| `RAW_INBOX_SHEET_NAME` | Yes | 取込データシート名 | `raw_inbox` |
| `PARSED_ENTITIES_SHEET_NAME` | Yes | 抽出データシート名 | `parsed_entities` |
| `ENGINEER_DB_SHEET_NAME` | Yes | 人材データシート名 | `人材DB` |
| `PROJECT_DB_SHEET_NAME` | Yes | 案件データシート名 | `案件DB` |
| `MATCHES_SHEET_NAME` | Yes | マッチ結果シート名 | `matches` |
| `PROCESS_LOG_SHEET_NAME` | Yes | 処理ログシート名 | `process_log` |
| `BATCH_SIZE` | No | 1バッチの最大取得数（デフォルト: 20） | `20` |
| `LOOKBACK_DAYS` | No | 検索対象期間（デフォルト: 30日） | `30` |
| `POLL_MINUTES` | No | 実行間隔（1/5/10/15/30分、デフォルト: 5） | `5` |
| `MATCH_THRESHOLD` | No | マッチスコア閾値（デフォルト: 35） | `35` |
| `MAX_DRAFTS_PER_ITEM` | No | 1エンティティあたりの最大下書き数（デフォルト: 5） | `5` |
| `DRAFT_SENDER_NAME` | No | 下書きの送信者名（デフォルト: `SES Matching Bot`） | `SES Matching Bot` |

### 2. 初期化の実行

GASエディタで `setupApp` を実行する。以下が自動作成される：

- Gmailラベル（処理中 / 処理済 / 処理失敗）
- Spreadsheetシート（6種）
- 定期実行トリガー

### 3. 運用開始

処理中・処理済・処理失敗のいずれのラベルも付いていないメールが、次回のバッチ実行時に自動処理される。

## スコアリング基準

| 条件 | 加算スコア |
|------|-----------|
| スキル一致（1件あたり） | +15 |
| リモート形態一致 | +10 |
| 勤務地一致 | +10 |
| 単価範囲の重なり | +10〜20 |
