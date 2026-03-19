# Amazon SES メール送信 API

API Gateway + Lambda + Amazon SES を使用して、外部の業務システムから API 経由で通知メールを送信する仕組みを AWS CDK (TypeScript) で構築します。

## アーキテクチャ

```mermaid
flowchart LR
    A[業務システム] -->|HTTPS POST| B[API Gateway]
    B -->|APIキー認証| C[Lambda関数]
    C -->|SendEmail / SendTemplatedEmail| D[Amazon SES]
    D -->|メール配信| E[宛先メールアドレス]
```

### 機能

- **自由形式メール送信** (`POST /send`): 件名・本文を自由に指定してメール送信
- **テンプレートメール送信** (`POST /send-template`): SES テンプレートを使用したメール送信
- **APIキー認証**: API Gateway の APIキー + Usage Plan によるアクセス制御・レート制限

## 前提条件

| ツール | バージョン | 用途 |
|--------|-----------|------|
| AWS アカウント | - | デプロイ先 |
| [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) | 2.x 以上 | リソース操作・SES テンプレート管理 |
| [Node.js](https://nodejs.org/) | 22 以上 | CDK / Lambda ランタイム |
| [AWS CDK CLI](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html) | 2.x 以上 | インフラ構築 (`npm install -g aws-cdk`) |
| [uv](https://docs.astral.sh/uv/) | 任意 | Python テストスクリプト実行用 |

### AWS 認証について

このプロジェクトでは以下の 2 つの認証方式に対応しています。

**環境変数・デフォルト認証の場合:**

```bash
aws sts get-caller-identity
```

**AWS SSO プロファイルを使う場合:**

```bash
aws sso login --profile {プロファイル名}
aws sts get-caller-identity --profile {プロファイル名}
```

> 以降のコマンド例では `--profile` なしで記載しています。AWS SSO 等のプロファイルを使う場合は、各 `aws` コマンド・`npx cdk` コマンドの末尾に `--profile {プロファイル名}` を必ず追加してください。


## パラメータ設定

`cdk.json` の `context.sesConfig` セクションを編集してください。**これが設定が必要な唯一のファイルです。**

```json
{
  "context": {
    "sesConfig": {
      "region": "ap-northeast-1",
      "senderEmail": "sender@example.com",
      "apiKeyName": "ses-sending-api-key",
      "stageName": "v1"
    }
  }
}
```

### パラメータ説明

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| `region` | Yes | デプロイ先リージョン（例: `ap-northeast-1`） |
| `senderEmail` | Yes | 送信元メールアドレス（SES で検証済みである必要あり） |
| `apiKeyName` | Yes | API Gateway の API キー名 |
| `stageName` | Yes | API Gateway のステージ名（例: `v1`） |

## デプロイ手順

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. パラメータ設定

サンプルファイルから `cdk.json` を作成し、`sesConfig` を環境に合わせて編集します。

```bash
cp cdk.json.sample cdk.json
# cdk.json を編集
```

> **注意**: `cdk.json` は `.gitignore` に含まれているため、Git にコミットされません。実際の設定値が誤って公開されることを防いでいます。

### 3. CDK Bootstrap（初回のみ）

デプロイ先リージョンに CDK の初期リソースを作成します。`cdk.json` の `region` が使われるため、アカウントIDやリージョンの指定は不要です。

```bash
npx cdk bootstrap
```

### 4. テンプレート生成・確認（任意）

```bash
npm run build
npx cdk synth
```

### 5. デプロイ

```bash
npx cdk deploy --all --require-approval never
```

デプロイが完了すると、以下の出力が表示されます。`ApiEndpoint` と `ApiKeyId` は後の手順で使用します。

```
Outputs:
SesSendingStack.ApiEndpoint = https://{API ID}.execute-api.{region}.amazonaws.com/{stage}/
SesSendingStack.ApiKeyId = {APIキーID}
```

## デプロイ後の作業

以降の AWS CLI コマンドでは、リージョン・送信元アドレスなどを直接コマンドに記載しています。シェル変数を事前に設定する必要はなく、**各コマンドをそのままコピー＆ペーストで実行できます。**（メールアドレスは `cdk.json` の `sesConfig.senderEmail` に合わせて適宜変更してください。）

### 1. SES メールアドレス検証（必須）

送信元メールアドレス（`cdk.json` の `senderEmail`）を SES で検証します。Sandbox モードでは**送信先メールアドレスも検証が必要**です。

```bash
# 送信元メールアドレスの検証（cdk.json の senderEmail を自動で読み取り）
aws ses verify-email-identity \
  --email-address k-nagayama@dicejreg.onmicrosoft.com \
  --region ap-northeast-1
```

```bash
# 送信先メールアドレスの検証（Sandbox モードの場合、実際の送信先アドレスに置き換えてください）
aws ses verify-email-identity \
  --email-address {送信先メールアドレス} \
  --region ap-northeast-1
```

以下のような検証メールが届くので、メール内のリンクをクリックして承認してください。

![SES 検証メール](docs/images/ses-verification-email.png)

リンクをクリックすると、以下の画面が表示されれば検証完了です。

![SES 検証完了](docs/images/ses-verification-done.png)

検証状態の確認（`VerificationStatus` が `Success` になっていれば OK です）:

```bash
aws ses get-identity-verification-attributes \
  --identities k-nagayama@dicejreg.onmicrosoft.com {送信先メールアドレス} \
  --region ap-northeast-1
```

出力例:

```json
{
    "VerificationAttributes": {
        "sender@example.com": {
            "VerificationStatus": "Success"
        },
        "recipient@example.com": {
            "VerificationStatus": "Success"
        }
    }
}
```

### 2. API キーの取得（必須）

デプロイ出力の `SesSendingStack.ApiKeyId` に表示された値を `{ApiKeyId}` に置き換えて実行します。

```bash
aws apigateway get-api-key \
  --api-key {ApiKeyId} \
  --include-value \
  --region ap-northeast-1
```

出力の `value` フィールドが API キーです（`id` ではなく `value` を使用してください）。

```json
{
    "id": "xxxxxxxxxx",
    "value": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",  ← これを使う
    "name": "ses-sending-api-key",
    ...
}
```

## API の使い方

### 自由形式メール送信 (`POST /send`)

以下のプレースホルダーを置き換えて実行してください:

- `{API ID}`: デプロイ出力の `ApiEndpoint` URL に含まれる ID（例: `https://{API ID}.execute-api.…`）
- `{APIキーのvalue}`: 上の手順で取得した API キーの `value`
- `{送信先メールアドレス}`: SES で検証済みの送信先アドレス

```bash
curl -X POST "https://{API ID}.execute-api.ap-northeast-1.amazonaws.com/v1/send" \
  -H "Content-Type: application/json" \
  -H "x-api-key: {APIキーのvalue}" \
  -d '{
    "to": ["{送信先メールアドレス}"],
    "subject": "テスト通知",
    "body": "API Gateway経由でのメール送信テストです。",
    "bodyHtml": "<h1>テスト通知</h1><p>API Gateway経由でのメール送信テストです。</p>"
  }'
```

成功すると `{"messageId":"..."}` が返り、送信先にメールが届きます。

**リクエストボディ:**

| フィールド | 型 | 必須 | 説明 |
|-----------|------|------|------|
| `to` | string[] | Yes | 送信先メールアドレス |
| `subject` | string | Yes | 件名 |
| `body` | string | Yes | 本文（テキスト） |
| `bodyHtml` | string | No | 本文（HTML） |
| `cc` | string[] | No | CC |
| `bcc` | string[] | No | BCC |
| `replyTo` | string[] | No | Reply-To |
| `attachments` | Attachment[] | No | 添付ファイル |

**Attachment オブジェクト:**

| フィールド | 型 | 説明 |
|-----------|------|------|
| `filename` | string | ファイル名 |
| `contentType` | string | MIMEタイプ（例: `image/png`） |
| `data` | string | base64エンコードされたファイルデータ |

### テンプレートメール送信 (`POST /send-template`)

```bash
curl -X POST "https://{API ID}.execute-api.ap-northeast-1.amazonaws.com/v1/send-template" \
  -H "Content-Type: application/json" \
  -H "x-api-key: {APIキーのvalue}" \
  -d '{
    "to": ["{送信先メールアドレス}"],
    "templateName": "CameraNotificationTemplate",
    "templateData": {
      "datetime": "2026-03-19 14:30:00",
      "line-name": "山手線",
      "station": "田町駅",
      "line-direction": "内回り",
      "kiro-tei": "12k345m",
      "pole-num": "77号柱",
      "encoded-image": "",
      "panta-camera-system-link": "https://example.com/camera/1"
    }
  }'
```

> **実装メモ**: SES の `SendTemplatedEmail` API は `TemplateData` が 30KB に制限されており、base64 画像を含む大きなデータを渡せません。そのため Lambda 内で `GetTemplate` によりテンプレートを取得して変数展開を行い、`SendRawEmail` で送信しています。`encoded-image` は SES テンプレートには直接展開されず、CID インライン画像（`cid:camera-image`）として MIME メッセージに添付されます。

**リクエストボディ:**

| フィールド | 型 | 必須 | 説明 |
|-----------|------|------|------|
| `to` | string[] | Yes | 送信先メールアドレス |
| `templateName` | string | Yes | SES テンプレート名 |
| `templateData` | object | Yes | テンプレート変数 |
| `cc` | string[] | No | CC |
| `bcc` | string[] | No | BCC |
| `replyTo` | string[] | No | Reply-To |

**`CameraNotificationTemplate` のテンプレート変数:**

| 変数 | 説明 |
|-----|------|
| `datetime` | 検知日時 |
| `line-name` | 路線名 |
| `station` | 駅名・区間 |
| `line-direction` | 線別（内回り/外回りなど） |
| `kiro-tei` | キロ程（例: 12k345m） |
| `pole-num` | 電柱番号（例: 77号柱） |
| `encoded-image` | base64エンコードされた画像データ（CIDインライン画像として添付） |
| `panta-camera-system-link` | カメラシステムへのリンクURL |

### レスポンス

**成功 (200):**

```json
{
  "messageId": "0100018e-xxxx-xxxx-xxxx-xxxxxxxxxxxx-000000"
}
```

**エラー (400/500):**

```json
{
  "error": "エラーメッセージ"
}
```

### テストツール

ブラウザでメール送信をテストできる HTML ツールを用意しています。

```bash
open tools/send-test.html
```

API Endpoint URL と API Key を入力し、フォームから自由形式メール・テンプレートメールの送信をテストできます。設定値はブラウザの localStorage に保存されるため、次回アクセス時に再入力は不要です。

- **自由形式メール**: 画像ファイルを選択すると添付ファイルとして送信できます。
- **テンプレートメール**: 画像ファイルを選択すると `encoded-image` フィールドに base64 データが自動反映されます。

> **注意**: テンプレートメール送信をテストする場合は、事前に SES テンプレートの登録が必要です。次の「SES テンプレート管理」セクションを参照してください。

### Python スクリプトによるテスト送信

`uv run` 一発でテンプレートメールを送信できる Python スクリプトも用意しています。`sample-image/image.png` を CID インライン画像として `CameraNotificationTemplate` で送信します。

**uv のインストール（macOS / Linux）:**

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

**実行手順:**

```bash
# 1. .env.sample をコピーして設定を編集
cp tools/.env.sample tools/.env
# tools/.env を開き、API_ENDPOINT・API_KEY・TO_EMAIL を設定

# 2. スクリプトを実行（依存パッケージは uv が自動でインストール）
uv run tools/send_test_template.py
```

`tools/.env` には API キーが含まれるため、`.gitignore` で Git 管理対象外になっています。

## SES テンプレート管理

SES テンプレートは AWS CLI で管理します。テンプレートファイルが `templates/camera-notification-template.json` にあります。

### テンプレートの登録

```bash
aws ses create-template \
  --cli-input-json file://templates/camera-notification-template.json \
  --region ap-northeast-1
```

### テンプレートの更新

```bash
aws ses update-template \
  --cli-input-json file://templates/camera-notification-template.json \
  --region ap-northeast-1
```

### テンプレート一覧の確認

```bash
aws ses list-templates \
  --region ap-northeast-1
```

### テンプレートの削除

```bash
aws ses delete-template \
  --template-name CameraNotificationTemplate \
  --region ap-northeast-1
```

## SES Sandbox について

新規 AWS アカウントでは SES は Sandbox モードです。Sandbox モードでは以下の制限があります：

- **送信元・送信先の両方**が SES で検証済みのメールアドレスである必要がある
- 1 日あたり 200 通、1 秒あたり 1 通の送信制限

本番運用で任意のアドレスにメールを送信する場合は、SES コンソールから「プロダクションアクセスリクエスト」を申請してください。プロダクションアクセスが承認されると、送信先の検証が不要になり、送信制限も大幅に緩和されます。

## トラブルシューティング

### メール送信が拒否される（MessageRejected）

1. 送信元メールアドレス（`senderEmail`）が SES で検証済みか確認

```bash
aws ses get-identity-verification-attributes \
  --identities k-nagayama@dicejreg.onmicrosoft.com \
  --region ap-northeast-1
```

2. Sandbox モードの場合、送信先メールアドレスも検証済みか確認
3. メールアドレスの形式が正しいか確認

### テンプレートが見つからない（TemplateDoesNotExist）

1. テンプレートが登録されているか確認

```bash
aws ses list-templates \
  --region ap-northeast-1
```

2. テンプレート名が正しいか確認（大文字・小文字を区別します）
3. AWS CLI コマンドで `--profile` の付け忘れがないか確認（プロファイル未指定だと別のアカウント/リージョンに登録されてしまい、対象環境にテンプレートが存在しない状態になります）

### API キーが無効（403 Forbidden）

1. `x-api-key` ヘッダーが正しく設定されているか確認
2. API キーの値（ID ではなく value）を使用しているか確認

### cdk synth でエラーが出る

1. `cdk.json` の `sesConfig` が正しく設定されているか確認
2. `npm run build` でコンパイルエラーがないか確認

## リソース削除

```bash
npx cdk destroy --all
```

SES のメールアドレス検証やテンプレートは CDK 管理外のため、必要に応じて別途削除してください。

```bash
# メールアドレス検証の削除
aws ses delete-identity \
  --identity k-nagayama@dicejreg.onmicrosoft.com \
  --region ap-northeast-1

# テンプレートの削除（登録した場合）
aws ses delete-template \
  --template-name CameraNotificationTemplate \
  --region ap-northeast-1
```

## 料金試算

月 100 通のメール送信を想定した月額料金の試算です（2026年3月時点）。

| サービス | 内訳 | 月額 |
|---------|------|------|
| SES（送信） | 100通（無料枠: 月62,000通 ※EC2経由の場合） | $0.01 |
| API Gateway | 100リクエスト（無料枠: 月100万リクエスト） | $0.00 |
| Lambda | 100回実行 × 128MB × 1秒（無料枠内） | $0.00 |
| CloudWatch Logs | ログ約1MB（無料枠内） | $0.00 |
| **合計** | | **約 $0.01/月** |

> **補足**: Lambda・API Gateway は AWS 無料枠の範囲内で収まるため、実質的なコストは SES の送信料金のみです。送信量が大幅に増加しない限り、月額 $1 未満で運用できます。
