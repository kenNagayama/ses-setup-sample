export interface S3Config {
  /** S3バケット名サフィックス */
  readonly bucketNameSuffix: string;
  /** S3オブジェクトキープレフィックス */
  readonly objectKeyPrefix: string;
  /** ライフサイクル（日数） */
  readonly lifecycleDays: number;
}

export interface NewDomainConfig {
  /** 新規ドメイン名 */
  readonly domainName: string;
  /** Route53 Hosted Zoneを作成するか */
  readonly createHostedZone: boolean;
}

export interface SesConfig {
  /** デプロイ先リージョン（SES受信対応: us-east-1, us-west-2, eu-west-1） */
  readonly region: string;
  /** デプロイパターン: "forwarding"（転送）or "newDomain"（新規ドメイン） */
  readonly domainPattern: 'forwarding' | 'newDomain';
  /** SESで受信するドメイン */
  readonly receiveDomain: string;
  /** 受信対象メールアドレス一覧 */
  readonly receiveAddresses: string[];
  /** 通知先メールアドレス一覧 */
  readonly notificationEmails: string[];
  /** 署名付きURL有効期限（日数） */
  readonly presignedUrlExpiryDays: number;
  /** S3設定 */
  readonly s3: S3Config;
  /** 新規ドメイン設定（パターンBのみ） */
  readonly newDomain?: NewDomainConfig;
}

export function loadConfig(context: Record<string, unknown>): SesConfig {
  const raw = context['sesConfig'];
  if (!raw || typeof raw !== 'object') {
    throw new Error(
      'cdk.json の context に "sesConfig" が設定されていません。README.md を参照してください。'
    );
  }

  const config = raw as Record<string, unknown>;

  // region
  const region = config['region'];
  if (!region || typeof region !== 'string') {
    throw new Error(
      'sesConfig.region を指定してください（例: "us-east-1"）。SES受信対応リージョン: us-east-1, us-west-2, eu-west-1'
    );
  }

  // domainPattern
  const domainPattern = config['domainPattern'];
  if (domainPattern !== 'forwarding' && domainPattern !== 'newDomain') {
    throw new Error(
      'sesConfig.domainPattern は "forwarding" または "newDomain" を指定してください。'
    );
  }

  // receiveDomain
  const receiveDomain = config['receiveDomain'];
  if (!receiveDomain || typeof receiveDomain !== 'string') {
    throw new Error('sesConfig.receiveDomain を指定してください。');
  }

  // receiveAddresses
  const receiveAddresses = config['receiveAddresses'];
  if (!Array.isArray(receiveAddresses) || receiveAddresses.length === 0) {
    throw new Error(
      'sesConfig.receiveAddresses に1つ以上のメールアドレスを指定してください。'
    );
  }
  for (const addr of receiveAddresses) {
    if (typeof addr !== 'string' || !addr.includes('@')) {
      throw new Error(
        `sesConfig.receiveAddresses の値が不正です: ${addr}`
      );
    }
  }

  // notificationEmails
  const notificationEmails = config['notificationEmails'];
  if (!Array.isArray(notificationEmails) || notificationEmails.length === 0) {
    throw new Error(
      'sesConfig.notificationEmails に1つ以上のメールアドレスを指定してください。'
    );
  }
  for (const email of notificationEmails) {
    if (typeof email !== 'string' || !email.includes('@')) {
      throw new Error(
        `sesConfig.notificationEmails の値が不正です: ${email}`
      );
    }
  }

  // presignedUrlExpiryDays
  const presignedUrlExpiryDays = config['presignedUrlExpiryDays'];
  if (
    typeof presignedUrlExpiryDays !== 'number' ||
    presignedUrlExpiryDays < 1 ||
    presignedUrlExpiryDays > 7
  ) {
    throw new Error(
      'sesConfig.presignedUrlExpiryDays は 1〜7 の整数を指定してください。'
    );
  }

  // s3
  const s3Raw = config['s3'];
  if (!s3Raw || typeof s3Raw !== 'object') {
    throw new Error('sesConfig.s3 を指定してください。');
  }
  const s3 = s3Raw as Record<string, unknown>;
  if (!s3['bucketNameSuffix'] || typeof s3['bucketNameSuffix'] !== 'string') {
    throw new Error('sesConfig.s3.bucketNameSuffix を指定してください。');
  }
  if (typeof s3['objectKeyPrefix'] !== 'string') {
    throw new Error('sesConfig.s3.objectKeyPrefix を指定してください。');
  }
  if (typeof s3['lifecycleDays'] !== 'number' || s3['lifecycleDays'] < 1) {
    throw new Error('sesConfig.s3.lifecycleDays は 1 以上の整数を指定してください。');
  }

  // newDomain（パターンBの場合は必須）
  let newDomain: NewDomainConfig | undefined;
  if (domainPattern === 'newDomain') {
    const ndRaw = config['newDomain'];
    if (!ndRaw || typeof ndRaw !== 'object') {
      throw new Error(
        'domainPattern が "newDomain" の場合、sesConfig.newDomain を指定してください。'
      );
    }
    const nd = ndRaw as Record<string, unknown>;
    if (!nd['domainName'] || typeof nd['domainName'] !== 'string') {
      throw new Error('sesConfig.newDomain.domainName を指定してください。');
    }
    if (typeof nd['createHostedZone'] !== 'boolean') {
      throw new Error(
        'sesConfig.newDomain.createHostedZone を true または false で指定してください。'
      );
    }
    newDomain = {
      domainName: nd['domainName'] as string,
      createHostedZone: nd['createHostedZone'] as boolean,
    };
  }

  return {
    region: region as string,
    domainPattern,
    receiveDomain,
    receiveAddresses,
    notificationEmails,
    presignedUrlExpiryDays,
    s3: {
      bucketNameSuffix: s3['bucketNameSuffix'] as string,
      objectKeyPrefix: s3['objectKeyPrefix'] as string,
      lifecycleDays: s3['lifecycleDays'] as number,
    },
    newDomain,
  };
}
