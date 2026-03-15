import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({});
const sns = new SNSClient({});

const BUCKET_NAME = process.env.BUCKET_NAME!;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN!;
const PRESIGNED_URL_EXPIRY = parseInt(
  process.env.PRESIGNED_URL_EXPIRY || '604800',
  10
);

interface SesMailHeader {
  name: string;
  value: string;
}

interface SesMailCommonHeaders {
  from?: string[];
  subject?: string;
  date?: string;
}

interface SesMail {
  messageId: string;
  source: string;
  commonHeaders: SesMailCommonHeaders;
  headers: SesMailHeader[];
}

interface SesReceipt {
  action: {
    type: string;
    bucketName: string;
    objectKey: string;
  };
}

interface SesRecord {
  ses: {
    mail: SesMail;
    receipt: SesReceipt;
  };
}

interface SesEvent {
  Records: SesRecord[];
}

export const handler = async (event: SesEvent): Promise<void> => {
  for (const record of event.Records) {
    const mail = record.ses.mail;
    const receipt = record.ses.receipt;

    const from = mail.commonHeaders.from?.[0] ?? mail.source;
    const subject = mail.commonHeaders.subject ?? '(件名なし)';
    const receivedDate = mail.commonHeaders.date ?? new Date().toISOString();

    const bucketName = receipt.action.bucketName;
    const objectKey = receipt.action.objectKey;

    // 署名付きURL生成
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
    });
    const presignedUrl = await getSignedUrl(s3, command, {
      expiresIn: PRESIGNED_URL_EXPIRY,
    });

    const expiryDays = Math.floor(PRESIGNED_URL_EXPIRY / 86400);

    const message = [
      '【メール受信通知】',
      '',
      `送信者: ${from}`,
      `件名: ${subject}`,
      `受信日時: ${receivedDate}`,
      '',
      'メール本文を確認するには以下のリンクをクリックしてください：',
      presignedUrl,
      '',
      `※ このリンクは${expiryDays}日間有効です。`,
    ].join('\n');

    await sns.send(
      new PublishCommand({
        TopicArn: SNS_TOPIC_ARN,
        Subject: `【メール受信通知】${subject}`,
        Message: message,
      })
    );

    console.log(`Notification sent for message: ${mail.messageId}`);
  }
};
