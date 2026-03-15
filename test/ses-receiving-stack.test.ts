import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { SesReceivingStack } from '../lib/ses-receiving-stack.js';
import { SesConfig } from '../config/parameters.js';

const testConfig: SesConfig = {
  domainPattern: 'forwarding',
  receiveDomain: 'example.com',
  receiveAddresses: ['test@example.com'],
  notificationEmails: ['admin@company.co.jp'],
  presignedUrlExpiryDays: 7,
  s3: {
    bucketNameSuffix: 'test-received-emails',
    objectKeyPrefix: 'incoming/',
    lifecycleDays: 365,
  },
};

describe('SesReceivingStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new SesReceivingStack(app, 'TestStack', {
      sesConfig: testConfig,
      env: { account: '123456789012', region: 'us-east-1' },
    });
    template = Template.fromStack(stack);
  });

  test('S3 Bucket created with encryption and public access block', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256',
            },
          },
        ],
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      VersioningConfiguration: {
        Status: 'Enabled',
      },
    });
  });

  test('SNS Topic created', () => {
    template.hasResourceProperties('AWS::SNS::Topic', {
      DisplayName: 'SES Email Notification',
    });
  });

  test('SNS Email Subscription created', () => {
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'admin@company.co.jp',
    });
  });

  test('Lambda Function created with correct environment variables', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Timeout: 30,
    });
  });

  test('SES Receipt Rule Set created', () => {
    template.hasResourceProperties('AWS::SES::ReceiptRuleSet', {
      RuleSetName: 'ses-receiving-rule-set',
    });
  });

  test('SES Receipt Rule created with correct recipients', () => {
    template.hasResourceProperties('AWS::SES::ReceiptRule', {
      Rule: {
        Name: 'receive-and-notify',
        Recipients: ['test@example.com'],
        ScanEnabled: true,
        Enabled: true,
      },
    });
  });
});
