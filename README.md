# SES Matching Automation

SES事業におけるエンジニア人材と案件のマッチング業務を自動化するGoogle Apps Scriptアプリケーション。

## 概要

Gmail経由で届くエンジニア人材メール・案件メールを自動的に解析し、既存データベース（Spreadsheet）とマッチングを行い、マッチした候補に対してメール下書きを生成する。

## 処理フロー

```
1. Gmail取得     : 未処理ラベルのスレッドをバッチ取得
2. 取込(INGEST)  : メール内容をrawInboxシートに記録
3. 抽出(PARSE)   : Regex → AI のパイプラインで構造化データを抽出
4. 正規化(NORMALIZE) : 統一スキーマに変換
5. マッチング(MATCH)  : 案件↔エンジニアのスコアリング
6. 下書き(DRAFT)      : マッチ候補宛のメール下書きを作成
7. 記録(LOG)          : 全ステージの処理結果をprocessLogに記録
```

## ラベル遷移

```
未処理 → 処理中 → 処理済
                 → 処理失敗（エラー時）
```

前回バッチでタイムアウト等により処理中のまま残留したスレッドは、次回バッチ開始時にProcessLogを確認し、完了済みなら処理済、未完了なら処理失敗に振り分ける。

## ファイル構成

| ファイル | 責務 |
|---------|------|
| `Main.gs` | エントリーポイント（setupApp / runBatch） |
| `Config.gs` | スクリプトプロパティの読み込みとバリデーション |
| `Bootstrap.gs` | Gmailラベル・シート・トリガーの初期セットアップ |
| `Extraction.gs` | 抽出パイプライン（Regex + AI） |
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
| `UNPROCESSED_LABEL` | Yes | 未処理ラベル名 | `未処理` |
| `PROCESSING_LABEL` | Yes | 処理中ラベル名 | `処理中` |
| `PROCESSED_LABEL` | Yes | 処理済ラベル名 | `処理済` |
| `ERROR_LABEL` | Yes | 処理失敗ラベル名 | `処理失敗` |
| `RAW_INBOX_SHEET_NAME` | Yes | 取込データシート名 | `raw_inbox` |
| `PARSED_ENTITIES_SHEET_NAME` | Yes | 抽出データシート名 | `parsed_entities` |
| `NORMALIZED_ENTITIES_SHEET_NAME` | Yes | 正規化データシート名 | `normalized_entities` |
| `MATCHES_SHEET_NAME` | Yes | マッチ結果シート名 | `matches` |
| `PROCESS_LOG_SHEET_NAME` | Yes | 処理ログシート名 | `process_log` |
| `BATCH_SIZE` | No | 1バッチの最大取得数（デフォルト: 20） | `20` |
| `LOOKBACK_DAYS` | No | 検索対象期間（デフォルト: 30日） | `30` |
| `POLL_MINUTES` | No | 実行間隔（1/5/10/15/30分、デフォルト: 5） | `5` |
| `MATCH_THRESHOLD` | No | マッチスコア閾値（デフォルト: 35） | `35` |
| `MAX_DRAFTS_PER_ITEM` | No | 1エンティティあたりの最大下書き数（デフォルト: 5） | `5` |
| `DRAFT_SENDER_NAME` | No | 下書きの送信者名（デフォルト: `SES Matching Bot`） | `SES Matching Bot` |
| `EXTRACTOR_PIPELINE` | No | 抽出器の実行順（デフォルト: `regex,ai`） | `regex,ai` |

### 2. 初期化の実行

GASエディタで `setupApp` を実行する。以下が自動作成される：

- Gmailラベル（未処理 / 処理中 / 処理済 / 処理失敗）
- Spreadsheetシート（5種）
- 定期実行トリガー

### 3. 運用開始

対象メールに「未処理」ラベルを付与すると、次回のバッチ実行時に自動処理される。

## スコアリング基準

| 条件 | 加算スコア |
|------|-----------|
| スキル一致（1件あたり） | +15 |
| リモート形態一致 | +10 |
| 勤務地一致 | +10 |
| 単価範囲の重なり | +10〜20 |
