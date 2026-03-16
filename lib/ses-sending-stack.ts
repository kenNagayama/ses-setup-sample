import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';
import { SesConfig } from '../config/parameters.js';

interface SesSendingStackProps extends cdk.StackProps {
  readonly sesConfig: SesConfig;
}

export class SesSendingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SesSendingStackProps) {
    super(scope, id, props);

    const config = props.sesConfig;

    // CloudWatch Logs
    const logGroup = new logs.LogGroup(this, 'SendEmailLogGroup', {
      logGroupName: '/aws/lambda/ses-send-email',
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda Function
    const sendEmailFn = new lambdaNodejs.NodejsFunction(this, 'SendEmailFunction', {
      entry: path.join(__dirname, '..', 'lambda', 'send-email', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      logGroup,
      environment: {
        SENDER_EMAIL: config.senderEmail,
        AWS_SES_REGION: config.region,
      },
    });

    // SES送信権限
    sendEmailFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendTemplatedEmail'],
      resources: ['*'],
    }));

    // API Gateway REST API
    const api = new apigateway.RestApi(this, 'SesSendingApi', {
      restApiName: 'ses-sending-api',
      deployOptions: {
        stageName: config.stageName,
      },
    });

    // APIキー
    const apiKey = api.addApiKey('SesSendingApiKey', {
      apiKeyName: config.apiKeyName,
    });

    // Usage Plan
    const usagePlan = api.addUsagePlan('SesSendingUsagePlan', {
      name: 'ses-sending-usage-plan',
      throttle: {
        rateLimit: 10,
        burstLimit: 5,
      },
    });
    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({ stage: api.deploymentStage });

    // Lambda統合
    const lambdaIntegration = new apigateway.LambdaIntegration(sendEmailFn);

    // POST /send
    const sendResource = api.root.addResource('send');
    sendResource.addMethod('POST', lambdaIntegration, {
      apiKeyRequired: true,
    });

    // POST /send-template
    const sendTemplateResource = api.root.addResource('send-template');
    sendTemplateResource.addMethod('POST', lambdaIntegration, {
      apiKeyRequired: true,
    });

    // Outputs
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'API Gateway エンドポイント URL',
    });

    new cdk.CfnOutput(this, 'ApiKeyId', {
      value: apiKey.keyId,
      description: 'API キー ID（aws apigateway get-api-key --api-key {ID} --include-value で値を取得）',
    });
  }
}
