import { SESClient, SendEmailCommand, SendTemplatedEmailCommand } from '@aws-sdk/client-ses';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const ses = new SESClient({ region: process.env.AWS_SES_REGION });
const SENDER_EMAIL = process.env.SENDER_EMAIL!;

interface SendEmailBody {
  to: string[];
  subject: string;
  body: string;
  bodyHtml?: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string[];
}

interface SendTemplatedEmailBody {
  to: string[];
  templateName: string;
  templateData: Record<string, string>;
  cc?: string[];
  bcc?: string[];
  replyTo?: string[];
}

function response(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function validateEmails(emails: unknown, fieldName: string): string[] {
  if (!Array.isArray(emails) || emails.length === 0) {
    throw new Error(`${fieldName} は1つ以上のメールアドレスを含む配列で指定してください。`);
  }
  for (const email of emails) {
    if (typeof email !== 'string' || !email.includes('@')) {
      throw new Error(`${fieldName} の値が不正です: ${email}`);
    }
  }
  return emails;
}

function validateOptionalEmails(emails: unknown, fieldName: string): string[] | undefined {
  if (emails === undefined || emails === null) return undefined;
  return validateEmails(emails, fieldName);
}

async function handleSendEmail(body: SendEmailBody): Promise<APIGatewayProxyResult> {
  const to = validateEmails(body.to, 'to');
  if (!body.subject || typeof body.subject !== 'string') {
    return response(400, { error: 'subject は必須です。' });
  }
  if (!body.body || typeof body.body !== 'string') {
    return response(400, { error: 'body は必須です。' });
  }

  const cc = validateOptionalEmails(body.cc, 'cc');
  const bcc = validateOptionalEmails(body.bcc, 'bcc');
  const replyTo = validateOptionalEmails(body.replyTo, 'replyTo');

  const result = await ses.send(new SendEmailCommand({
    Source: SENDER_EMAIL,
    Destination: {
      ToAddresses: to,
      ...(cc && { CcAddresses: cc }),
      ...(bcc && { BccAddresses: bcc }),
    },
    Message: {
      Subject: { Data: body.subject, Charset: 'UTF-8' },
      Body: {
        Text: { Data: body.body, Charset: 'UTF-8' },
        ...(body.bodyHtml && { Html: { Data: body.bodyHtml, Charset: 'UTF-8' } }),
      },
    },
    ...(replyTo && { ReplyToAddresses: replyTo }),
  }));

  return response(200, { messageId: result.MessageId });
}

async function handleSendTemplatedEmail(body: SendTemplatedEmailBody): Promise<APIGatewayProxyResult> {
  const to = validateEmails(body.to, 'to');
  if (!body.templateName || typeof body.templateName !== 'string') {
    return response(400, { error: 'templateName は必須です。' });
  }
  if (!body.templateData || typeof body.templateData !== 'object') {
    return response(400, { error: 'templateData は必須です。' });
  }

  const cc = validateOptionalEmails(body.cc, 'cc');
  const bcc = validateOptionalEmails(body.bcc, 'bcc');
  const replyTo = validateOptionalEmails(body.replyTo, 'replyTo');

  const result = await ses.send(new SendTemplatedEmailCommand({
    Source: SENDER_EMAIL,
    Destination: {
      ToAddresses: to,
      ...(cc && { CcAddresses: cc }),
      ...(bcc && { BccAddresses: bcc }),
    },
    Template: body.templateName,
    TemplateData: JSON.stringify(body.templateData),
    ...(replyTo && { ReplyToAddresses: replyTo }),
  }));

  return response(200, { messageId: result.MessageId });
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    if (!event.body) {
      return response(400, { error: 'リクエストボディが空です。' });
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(event.body);
    } catch {
      return response(400, { error: 'リクエストボディが不正なJSONです。' });
    }

    if (event.resource === '/send') {
      return await handleSendEmail(parsed as unknown as SendEmailBody);
    } else if (event.resource === '/send-template') {
      return await handleSendTemplatedEmail(parsed as unknown as SendTemplatedEmailBody);
    } else {
      return response(404, { error: `未知のリソース: ${event.resource}` });
    }
  } catch (err: unknown) {
    const error = err as Error & { name?: string };
    console.error('Error:', error);

    if (error.name === 'MessageRejected') {
      return response(400, { error: `メール送信が拒否されました: ${error.message}` });
    }
    if (error.name === 'TemplateDoesNotExistException') {
      return response(400, { error: `テンプレートが見つかりません: ${error.message}` });
    }

    return response(500, { error: `内部エラー: ${error.message}` });
  }
};
