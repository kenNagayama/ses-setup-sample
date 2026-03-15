# Amazon SES メール受信セットアップ

Amazon SES を使用してメールを受信し、S3 に保存、署名付き URL を含む通知メールを送信する仕組みを AWS CDK (TypeScript) で構築します。

## アーキテクチャ

```mermaid
flowchart LR
    A[業務システム] -->|メール送信| B{受信方式}
    B -->|パターンA: 転送| C[既存メールシステム]
    B -->|パターンB: 新規ドメイン| D[Route53 + SES Identity]
    C -->|転送| E[Amazon SES 受信]
    D -->|MXレコード| E
    E -->|Receipt Rule| F[S3バケット]
    E -->|Receipt Rule| G[Lambda関数]
    G -->|署名付きURL生成| F
    G -->|通知発行| H[SNSトピック]
    H -->|Emailサブスクリプション| I[担当者メール]
```

### 処理フロー

1. メールが SES で受信される
2. Receipt Rule により S3 バケットにメール本文が保存される
3. Lambda 関数が起動し、S3 の署名付き URL（7日間有効）を生成
4. SNS 経由で担当者に通知メールが送信される（件名・送信者・署名付き URL 含む）

## 前提条件

- AWS アカウント
- AWS CLI（設定済み）
- Node.js 18 以上
- AWS CDK CLI (`npm install -g aws-cdk`)
- SES が利用可能なリージョン（us-east-1, us-west-2, eu-west-1 のいずれか）

## パターン選択ガイド

DNS 管理権限がないドメイン（例: `@jreast.co.jp`）宛のメールを受信するには、以下の 2 つの方法があります。

### パターン A: 既存メールシステムからの転送（推奨）

既存のメールシステム（Exchange, Google Workspace 等）で、対象アドレス宛のメールを SES 管理ドメインに転送します。

| 項目 | 内容 |
|------|------|
| メリット | 新規ドメイン取得不要、既存システムの設定変更のみ |
| デメリット | 既存メールシステムの管理者に転送設定を依頼する必要がある |
| 必要な作業 | SES でドメイン検証（手動）+ 既存システムで転送ルール設定 |

### パターン B: 新規ドメインを取得して SES で受信

Route53 で新規ドメインを取得（または持ち込み）し、SES で直接メールを受信します。

| 項目 | 内容 |
|------|------|
| メリット | 完全に自動構築可能、DNS 設定も CDK で管理 |
| デメリット | ドメイン取得費用が発生、業務システム側のメール送信先変更が必要 |
| 必要な作業 | ドメイン取得 + CDK デプロイのみ |

### パターン B のドメイン選定ガイド

パターン B で新規ドメインを取得する場合、以下の点を考慮してください。

#### ドメイン名の選び方

| 方針 | 推奨例 | 説明 |
|------|--------|------|
| 既存ドメインのサブドメイン | `mail.yourcompany.com` | 追加費用なし。既存ドメインの DNS 管理権限があれば最も安全 |
| 組織名 + 用途を示す名前 | `yourcompany-notify.com` | 用途が明確で運用しやすい |
| 避けるべき名前 | `test-mail-123.com` 等 | スパム判定されやすく、将来の使い道がない |

**推奨 TLD（トップレベルドメイン）:**

- `.com` / `.net` — 信頼性が高く、長期運用に適している（年間 $13〜15 程度）
- `.jp` — 日本国内の組織であれば信頼性が高い（Route53 では登録不可、外部レジストラで取得して Route53 に委任可能）

> **サブドメイン vs 新規ドメイン**: 既存ドメインの DNS 管理権限がある場合は、新規ドメインを取得するよりサブドメイン（例: `ses.yourcompany.com`）を使う方が、コスト・管理・セキュリティすべての面で優れています。

#### ドメインの長期管理に関する注意事項

ドメインは「取得したら終わり」ではなく、**使い続ける限り、そして廃止した後も管理が必要**です。

**運用中の管理:**

- 自動更新を有効にし、支払い情報を最新に保つ
- ドメインロック（移管防止）を有効にする
- SPF・DKIM・DMARC を適切に設定する

**ドメインを廃止する場合の注意（ドメイン供養）:**

ドメインを手放すと、第三者に再取得されて悪用されるリスクがあります。

| リスク | 内容 |
|--------|------|
| フィッシング | 旧ドメインを使った偽サイトで利用者を騙す |
| メール傍受 | 旧ドメイン宛のメールを受信し、パスワードリセット等でアカウントを乗っ取る |
| ブランド毀損 | 旧ドメインで不適切なコンテンツを公開される |

**廃止前に必ず行うこと:**

1. 利用者への廃止告知（30〜60日前）
2. 旧ドメインのメールアドレスを使っている外部サービスのアカウント情報を変更
3. DNS レコードをすべて削除
4. 可能であれば、**ドメインを手放さず保持し続ける**（年間 $13〜15 程度で悪用を防止できる）

> **参考**: JPRS（日本レジストリサービス）の「[ドメイン名の廃止に関する注意](https://jprs.jp/registration/suspended/)」、東京都サイバーセキュリティガイドブックの「[独自ドメインを取得・使用している際に注意したいこと](https://www.cybersecurity.metro.tokyo.lg.jp/security/guidebook/286/index.html)」も参照してください。

## パラメータ設定

`cdk.json` の `context.sesConfig` セクションを編集してください。**これが設定が必要な唯一のファイルです。**

```json
{
  "context": {
    "sesConfig": {
      "region": "us-east-1",
      "domainPattern": "forwarding",
      "receiveDomain": "example.com",
      "receiveAddresses": ["notification@example.com"],
      "notificationEmails": ["admin@company.co.jp"],
      "presignedUrlExpiryDays": 7,
      "s3": {
        "bucketNameSuffix": "received-emails",
        "objectKeyPrefix": "incoming/",
        "lifecycleDays": 365
      },
      "newDomain": {
        "domainName": "example.com",
        "createHostedZone": true
      }
    }
  }
}
```

### パラメータ説明

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| `region` | Yes | デプロイ先リージョン（SES 受信対応: `us-east-1`, `us-west-2`, `eu-west-1`） |
| `domainPattern` | Yes | `"forwarding"`（パターン A）または `"newDomain"`（パターン B） |
| `receiveDomain` | Yes | SES で受信するドメイン名 |
| `receiveAddresses` | Yes | 受信対象のメールアドレス一覧 |
| `notificationEmails` | Yes | 通知先メールアドレス一覧 |
| `presignedUrlExpiryDays` | Yes | 署名付き URL の有効期限（1〜7日） |
| `s3.bucketNameSuffix` | Yes | S3 バケット名のサフィックス（`{アカウントID}-{サフィックス}` の形式） |
| `s3.objectKeyPrefix` | Yes | メール保存先の S3 キープレフィックス |
| `s3.lifecycleDays` | Yes | メールの保持期間（日数） |
| `newDomain.domainName` | パターン B のみ | Route53 で管理するドメイン名 |
| `newDomain.createHostedZone` | パターン B のみ | Hosted Zone を新規作成するか（`false` の場合は既存の Hosted Zone を使用） |

## デプロイ手順

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. パラメータ設定

サンプルファイルから `cdk.json` を作成し、`sesConfig` を環境に合わせて編集します（上記「パラメータ設定」セクション参照）。

```bash
cp cdk.json.sample cdk.json
# cdk.json を編集
```

> **注意**: `cdk.json` は `.gitignore` に含まれているため、Git にコミットされません。実際の設定値が誤って公開されることを防いでいます。

### 3. AWS 認証の確認

AWS CLI の認証方法に応じて、以下のいずれかを確認してください。

**環境変数・デフォルト認証の場合:**

```bash
aws sts get-caller-identity
```

**AWS プロファイルを使う場合:**

```bash
# SSO プロファイルの場合は事前にログイン
aws sso login --profile {プロファイル名}

aws sts get-caller-identity --profile {プロファイル名}
```

> 以降のコマンド例では `--profile` なしで記載しています。プロファイルを使う場合は各コマンドに `--profile {プロファイル名}` を追加してください。

### 4. CDK Bootstrap（初回のみ）

デプロイ先リージョンに CDK の初期リソースを作成します。`cdk.json` の `region` が使われるため、アカウントIDやリージョンの指定は不要です。

```bash
npx cdk bootstrap
```

### 5. テンプレート生成・確認（任意）

```bash
npm run build
npx cdk synth
```

生成された CloudFormation テンプレートを確認し、意図した構成になっているか確認してください。

### 6. デプロイ

```bash
npx cdk deploy SesReceivingStack    # パターンA（SesReceivingStack のみ）
npx cdk deploy --all                # パターンB（両スタック）
```

## デプロイ後の作業

### 1. SNS サブスクリプションの確認（必須）

デプロイ後、`notificationEmails` に指定した各アドレスに以下のような SNS 確認メールが届きます。メール内の「Confirm subscription」リンクをクリックして承認してください。

![SNS サブスクリプション確認メール](docs/images/sns-subscription-confirmation.png)

### 2. Receipt Rule Set の Active 化（必須）

SES の Receipt Rule Set はデプロイしただけでは Active になりません。AWS マネジメントコンソールまたは CLI で Active にしてください。

**コンソールの場合:**

1. [SES コンソール](https://console.aws.amazon.com/ses/) を開く
2. 左メニュー「Email receiving」→「Rule sets」
3. `ses-receiving-rule-set` を選択
4. 「Set as active」をクリック

**CLI の場合:**

```bash
aws ses set-active-receipt-rule-set \
  --rule-set-name ses-receiving-rule-set \
  --region $(jq -r '.context.sesConfig.region' cdk.json)
```

> **注意**: アカウントで Active にできる Receipt Rule Set は 1 つだけです。既存の Rule Set がある場合は、ルールの統合を検討してください。

### 3. SES ドメイン検証（パターン A のみ）

パターン A（転送）の場合、SES でドメインの Identity 検証を手動で行う必要があります。

1. [SES コンソール](https://console.aws.amazon.com/ses/) →「Verified identities」
2. 「Create identity」→ ドメインを入力
3. 表示される DNS レコード（DKIM 用 CNAME）をドメインの DNS に追加

> **注意**: DNS 管理権限がない場合は、メールアドレス単位での検証も可能です。ただし、受信には使用するドメインまたはアドレスの検証は不要で、**送信**する場合にのみ検証が必要です。Receipt Rule での受信自体はドメイン検証なしでも動作します。

### 4. 転送設定（パターン A のみ）

既存メールシステムの管理者に以下を依頼してください：

- 対象アドレス宛のメールを `receiveAddresses` に指定したアドレスに転送するルールを設定

### 5. テストメール送信

設定完了後、対象アドレスにテストメールを送信し、以下を確認してください：

1. S3 バケットにメールが保存されること
2. 通知メールが届くこと
3. 署名付き URL からメール本文にアクセスできること

## 運用ガイド

### S3 に保存されたメールの確認

```bash
# バケット内のメール一覧
aws s3 ls s3://{バケット名}/incoming/

# メールのダウンロード
aws s3 cp s3://{バケット名}/incoming/{メッセージID} ./email.eml
```

### 受信アドレスの追加

`cdk.json` の `receiveAddresses` にアドレスを追加し、再デプロイしてください。

```bash
npx cdk deploy SesReceivingStack
```

### 通知先の追加

`cdk.json` の `notificationEmails` にアドレスを追加し、再デプロイしてください。新しいアドレスに SNS 確認メールが届くので承認が必要です。

### ライフサイクル（保持期間）の変更

`cdk.json` の `s3.lifecycleDays` を変更し、再デプロイしてください。

## SES Sandbox について

新規 AWS アカウントでは SES は Sandbox モードです。

- **メール受信**: Sandbox でも Receipt Rule による受信は正常に動作します
- **メール送信**: 検証済みアドレスにのみ送信可能（本構成では SNS 経由の通知なので影響なし）

本番運用で SES 経由のメール送信が必要な場合は、SES コンソールから本番アクセスをリクエストしてください。

## Mail Manager について

AWS は 2024 年に SES v2 Mail Manager をリリースしました。Mail Manager は以下の機能を提供します：

- **Ingress Endpoint**: SMTP リレー機能（既存メールシステムからの転送を SMTP レベルで制御）
- **Traffic Policy**: 送信元 IP、SPF/DKIM 結果に基づくフィルタリング
- **Rule Engine**: 条件ベースのルーティング（S3、Lambda、WorkMail 等への振り分け）

Mail Manager は Receipt Rule よりも高機能ですが、現時点（2026年3月）では CDK の L2 コンストラクトが十分に整備されていないため、本プロジェクトでは Receipt Rule を採用しています。将来的に L2 コンストラクトが整備された場合、Mail Manager への移行を検討してください。

## トラブルシューティング

### メールが S3 に保存されない

1. Receipt Rule Set が Active になっているか確認

```bash
aws ses describe-active-receipt-rule-set \
  --region $(jq -r '.context.sesConfig.region' cdk.json)
```

2. 受信アドレスが Receipt Rule の Recipients に含まれているか確認
3. SES のリージョンが正しいか確認（MX レコードのリージョンと一致する必要あり）
4. S3 バケットポリシーが SES からの書き込みを許可しているか確認

### 通知メールが届かない

1. SNS サブスクリプションが承認済みか確認

```bash
aws sns list-subscriptions-by-topic --topic-arn {トピックARN}
```

2. Lambda 関数のログを確認

```bash
aws logs tail /aws/lambda/{関数名} --follow
```

3. 迷惑メールフォルダを確認

### 署名付き URL にアクセスできない

1. URL の有効期限が切れていないか確認（デフォルト 7 日間）
2. S3 バケットのライフサイクルでオブジェクトが削除されていないか確認

### cdk synth でエラーが出る

1. `cdk.json` の `sesConfig` が正しく設定されているか確認
2. `npm run build` でコンパイルエラーがないか確認

## リソース削除

Receipt Rule Set が Active のままだと削除に失敗するため、先に無効化してから destroy します。

```bash
# 1. Receipt Rule Set を無効化
aws ses set-active-receipt-rule-set \
  --region $(jq -r '.context.sesConfig.region' cdk.json)

# 2. スタックの削除（S3バケット内のオブジェクトも自動削除されます）
npx cdk destroy --all
```

## 料金試算

月100通（平均100KB/通）のメール受信を想定した月額料金の試算です（us-east-1 リージョン、2026年3月時点）。

### パターン A: 既存メールシステムからの転送

| サービス | 内訳 | 月額 |
|---------|------|------|
| SES（受信） | 100通 × 256KBチャンク単位 = $0.09/1,000チャンク | $0.01 |
| S3（保存） | 10MB保存 + PUT 100回 | $0.01 |
| Lambda | 100回実行 × 128MB × 1秒（無料枠内） | $0.00 |
| SNS（通知） | 100通のEmail通知（無料枠内） | $0.00 |
| CloudWatch Logs | ログ約2MB（無料枠内） | $0.00 |
| **合計** | | **約 $0.02/月** |

### パターン B: 新規ドメインを取得して SES で受信

| サービス | 内訳 | 月額 |
|---------|------|------|
| SES（受信） | パターンAと同じ | $0.01 |
| S3（保存） | パターンAと同じ | $0.01 |
| Lambda | パターンAと同じ | $0.00 |
| SNS（通知） | パターンAと同じ | $0.00 |
| CloudWatch Logs | パターンAと同じ | $0.00 |
| Route 53（Hosted Zone） | 1ゾーン × $0.50/月 | $0.50 |
| Route 53（DNSクエリ） | 少量のクエリ | $0.01 |
| **合計** | | **約 $0.53/月** |

> **補足**:
> - Lambda・SNS は AWS 無料枠（Lambda: 月100万リクエスト、SNS: 月1,000通）の範囲内で収まるため、実質無料です
> - パターン B の主なコストは Route 53 の Hosted Zone 固定費（$0.50/月）です
> - ドメイン取得費用は別途発生します（.com の場合、年間約 $13）
> - 受信量が大幅に増加しない限り、月額 $1 未満で運用できます

## スタック構成

| スタック | 用途 | デプロイ条件 |
|---------|------|-------------|
| `SesReceivingStack` | S3 + Lambda + SNS + SES Receipt Rule | 常にデプロイ |
| `DomainIdentityStack` | Route53 Hosted Zone + SES Identity + MX レコード | パターン B のみ |
