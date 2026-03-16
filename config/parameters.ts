export interface SesConfig {
  /** デプロイ先リージョン */
  readonly region: string;
  /** 送信元メールアドレス（SES検証済み） */
  readonly senderEmail: string;
  /** API Gatewayキー名 */
  readonly apiKeyName: string;
  /** API Gatewayステージ名（例: "v1"） */
  readonly stageName: string;
}

export function loadConfig(context: Record<string, unknown>): SesConfig {
  const raw = context['sesConfig'];
  if (!raw || typeof raw !== 'object') {
    throw new Error(
      'cdk.json の context に "sesConfig" が設定されていません。README.md を参照してください。'
    );
  }

  const config = raw as Record<string, unknown>;

  const region = config['region'];
  if (!region || typeof region !== 'string') {
    throw new Error(
      'sesConfig.region を指定してください（例: "ap-northeast-1"）。'
    );
  }

  const senderEmail = config['senderEmail'];
  if (!senderEmail || typeof senderEmail !== 'string' || !senderEmail.includes('@')) {
    throw new Error(
      'sesConfig.senderEmail にメールアドレスを指定してください（例: "sender@example.com"）。'
    );
  }

  const apiKeyName = config['apiKeyName'];
  if (!apiKeyName || typeof apiKeyName !== 'string') {
    throw new Error(
      'sesConfig.apiKeyName を指定してください（例: "ses-sending-api-key"）。'
    );
  }

  const stageName = config['stageName'];
  if (!stageName || typeof stageName !== 'string') {
    throw new Error(
      'sesConfig.stageName を指定してください（例: "v1"）。'
    );
  }

  return {
    region,
    senderEmail,
    apiKeyName,
    stageName,
  };
}
