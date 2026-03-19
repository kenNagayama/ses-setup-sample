import { SESClient, SendEmailCommand, SendRawEmailCommand, GetTemplateCommand } from '@aws-sdk/client-ses';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const ses = new SESClient({ region: process.env.AWS_SES_REGION });
const SENDER_EMAIL = process.env.SENDER_EMAIL!;

interface Attachment {
  filename: string;
  contentType: string;
  data: string; // base64
}

interface SendEmailBody {
  to: string[];
  subject: string;
  body: string;
  bodyHtml?: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string[];
  attachments?: Attachment[];
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
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
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

function encodeSubject(subject: string): string {
  return `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
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

  if (body.attachments && body.attachments.length > 0) {
    const MIXED_BOUNDARY = 'MIXED_BOUNDARY_' + Date.now();
    const ALT_BOUNDARY = 'ALT_BOUNDARY_' + Date.now();

    const lines: string[] = [
      'MIME-Version: 1.0',
      `From: ${SENDER_EMAIL}`,
      `To: ${to.join(', ')}`,
      ...(cc ? [`Cc: ${cc.join(', ')}`] : []),
      ...(bcc ? [`Bcc: ${bcc.join(', ')}`] : []),
      ...(replyTo ? [`Reply-To: ${replyTo.join(', ')}`] : []),
      `Subject: ${encodeSubject(body.subject)}`,
      `Content-Type: multipart/mixed; boundary="${MIXED_BOUNDARY}"`,
      '',
      `--${MIXED_BOUNDARY}`,
      `Content-Type: multipart/alternative; boundary="${ALT_BOUNDARY}"`,
      '',
      `--${ALT_BOUNDARY}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      body.body,
      '',
    ];

    if (body.bodyHtml) {
      lines.push(
        `--${ALT_BOUNDARY}`,
        'Content-Type: text/html; charset=UTF-8',
        '',
        body.bodyHtml,
        '',
      );
    }

    lines.push(`--${ALT_BOUNDARY}--`);

    for (const attachment of body.attachments) {
      lines.push(
        '',
        `--${MIXED_BOUNDARY}`,
        `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${attachment.filename}"`,
        '',
        attachment.data,
        '',
      );
    }

    lines.push(`--${MIXED_BOUNDARY}--`);

    const rawMessage = lines.join('\r\n');
    const result = await ses.send(new SendRawEmailCommand({
      RawMessage: { Data: Buffer.from(rawMessage) },
    }));
    return response(200, { messageId: result.MessageId });
  }

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

  // SES の SendTemplatedEmail は TemplateData が 30KB 上限のため、
  // Lambda 側でテンプレートを取得して変数展開し、SendRawEmail で送信する
  const templateResult = await ses.send(new GetTemplateCommand({ TemplateName: body.templateName }));
  const template = templateResult.Template;
  if (!template) {
    return response(400, { error: `テンプレートが見つかりません: ${body.templateName}` });
  }

  // encoded-image はテンプレートレンダリングには使わず CID インライン画像として添付する
  const encodedImage = body.templateData['encoded-image'] ?? '';
  const dataForRender = { ...body.templateData };
  delete dataForRender['encoded-image'];

  const render = (text: string): string =>
    text.replace(/\{\{([^}]+)\}\}/g, (_, key) => dataForRender[key.trim()] ?? '');

  const renderedSubject = render(template.SubjectPart ?? '');
  const renderedText = render(template.TextPart ?? '');
  const renderedHtml = template.HtmlPart ? render(template.HtmlPart) : undefined;

  const ts = Date.now();

  let lines: string[];

  if (encodedImage && renderedHtml) {
    // multipart/related 構造: CID インライン画像を添付
    const RELATED_BOUNDARY = 'RELATED_BOUNDARY_' + ts;
    const ALT_BOUNDARY = 'ALT_BOUNDARY_' + ts;

    lines = [
      'MIME-Version: 1.0',
      `From: ${SENDER_EMAIL}`,
      `To: ${to.join(', ')}`,
      ...(cc ? [`Cc: ${cc.join(', ')}`] : []),
      ...(bcc ? [`Bcc: ${bcc.join(', ')}`] : []),
      ...(replyTo ? [`Reply-To: ${replyTo.join(', ')}`] : []),
      `Subject: ${encodeSubject(renderedSubject)}`,
      `Content-Type: multipart/related; boundary="${RELATED_BOUNDARY}"; type="multipart/alternative"`,
      '',
      `--${RELATED_BOUNDARY}`,
      `Content-Type: multipart/alternative; boundary="${ALT_BOUNDARY}"`,
      '',
      `--${ALT_BOUNDARY}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      renderedText,
      '',
      `--${ALT_BOUNDARY}`,
      'Content-Type: text/html; charset=UTF-8',
      '',
      renderedHtml,
      '',
      `--${ALT_BOUNDARY}--`,
      '',
      `--${RELATED_BOUNDARY}`,
      'Content-Type: image/png',
      'Content-Transfer-Encoding: base64',
      'Content-ID: <camera-image>',
      'Content-Disposition: inline; filename="camera-image.png"',
      '',
      encodedImage,
      '',
      `--${RELATED_BOUNDARY}--`,
    ];
  } else {
    // 画像なし: multipart/alternative 構造
    const BOUNDARY = 'ALT_BOUNDARY_' + ts;

    lines = [
      'MIME-Version: 1.0',
      `From: ${SENDER_EMAIL}`,
      `To: ${to.join(', ')}`,
      ...(cc ? [`Cc: ${cc.join(', ')}`] : []),
      ...(bcc ? [`Bcc: ${bcc.join(', ')}`] : []),
      ...(replyTo ? [`Reply-To: ${replyTo.join(', ')}`] : []),
      `Subject: ${encodeSubject(renderedSubject)}`,
      `Content-Type: multipart/alternative; boundary="${BOUNDARY}"`,
      '',
      `--${BOUNDARY}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      renderedText,
      '',
    ];

    if (renderedHtml) {
      lines.push(
        `--${BOUNDARY}`,
        'Content-Type: text/html; charset=UTF-8',
        '',
        renderedHtml,
        '',
      );
    }

    lines.push(`--${BOUNDARY}--`);
  }

  const result = await ses.send(new SendRawEmailCommand({
    RawMessage: { Data: Buffer.from(lines.join('\r\n')) },
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
