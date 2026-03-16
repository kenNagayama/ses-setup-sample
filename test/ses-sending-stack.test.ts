import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SesSendingStack } from '../lib/ses-sending-stack.js';
import { SesConfig } from '../config/parameters.js';

const testConfig: SesConfig = {
  region: 'ap-northeast-1',
  senderEmail: 'sender@example.com',
  apiKeyName: 'test-api-key',
  stageName: 'v1',
};

describe('SesSendingStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new SesSendingStack(app, 'TestStack', {
      sesConfig: testConfig,
      env: { account: '123456789012', region: 'ap-northeast-1' },
    });
    template = Template.fromStack(stack);
  });

  test('API Gateway REST API created', () => {
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      Name: 'ses-sending-api',
    });
  });

  test('API Key created', () => {
    template.hasResourceProperties('AWS::ApiGateway::ApiKey', {
      Name: 'test-api-key',
    });
  });

  test('Usage Plan created with throttle settings', () => {
    template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
      Throttle: {
        RateLimit: 10,
        BurstLimit: 5,
      },
    });
  });

  test('Lambda Function created with correct runtime and timeout', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Timeout: 30,
    });
  });

  test('Lambda has SES send permissions', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ['ses:SendEmail', 'ses:SendTemplatedEmail'],
            Effect: 'Allow',
            Resource: '*',
          }),
        ]),
      },
    });
  });

  test('/send resource exists', () => {
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      PathPart: 'send',
    });
  });

  test('/send-template resource exists', () => {
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      PathPart: 'send-template',
    });
  });

  test('POST methods require API key', () => {
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'POST',
      ApiKeyRequired: true,
    });
  });

  test('CloudWatch LogGroup created', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/aws/lambda/ses-send-email',
      RetentionInDays: 365,
    });
  });
});
