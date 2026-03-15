import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sesActions from 'aws-cdk-lib/aws-ses-actions';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';
import { SesConfig } from '../config/parameters.js';

interface SesReceivingStackProps extends cdk.StackProps {
  readonly sesConfig: SesConfig;
}

export class SesReceivingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SesReceivingStackProps) {
    super(scope, id, props);

    const config = props.sesConfig;

    // S3 Bucket
    const emailBucket = new s3.Bucket(this, 'EmailBucket', {
      bucketName: `${this.account}-${config.s3.bucketNameSuffix}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(config.s3.lifecycleDays),
        },
      ],
    });

    // SNS Topic
    const notificationTopic = new sns.Topic(this, 'EmailNotificationTopic', {
      displayName: 'SES Email Notification',
    });

    // Email Subscriptions
    for (const email of config.notificationEmails) {
      notificationTopic.addSubscription(
        new snsSubscriptions.EmailSubscription(email)
      );
    }

    // Lambda LogGroup（cdk destroyで削除されるように明示作成）
    const logGroup = new logs.LogGroup(this, 'EmailNotificationLogGroup', {
      logGroupName: '/aws/lambda/ses-email-notification',
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda Function
    const notificationFn = new lambdaNodejs.NodejsFunction(
      this,
      'EmailNotificationFunction',
      {
        entry: path.join(__dirname, '..', 'lambda', 'email-notification', 'index.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        timeout: cdk.Duration.seconds(30),
        logGroup,
        environment: {
          BUCKET_NAME: emailBucket.bucketName,
          SNS_TOPIC_ARN: notificationTopic.topicArn,
          PRESIGNED_URL_EXPIRY: String(
            config.presignedUrlExpiryDays * 86400
          ),
        },
      }
    );

    // Lambda permissions
    emailBucket.grantRead(notificationFn);
    notificationTopic.grantPublish(notificationFn);

    // SES Receipt Rule Set
    const ruleSet = new ses.ReceiptRuleSet(this, 'ReceiptRuleSet', {
      receiptRuleSetName: 'ses-receiving-rule-set',
    });

    // SES Receipt Rule
    ruleSet.addRule('ReceiptRule', {
      receiptRuleName: 'receive-and-notify',
      recipients: config.receiveAddresses,
      scanEnabled: true,
      actions: [
        new sesActions.S3({
          bucket: emailBucket,
          objectKeyPrefix: config.s3.objectKeyPrefix,
        }),
        new sesActions.Lambda({
          function: notificationFn,
          invocationType: sesActions.LambdaInvocationType.EVENT,
        }),
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'EmailBucketName', {
      value: emailBucket.bucketName,
      description: 'メール保存S3バケット名',
    });

    new cdk.CfnOutput(this, 'NotificationTopicArn', {
      value: notificationTopic.topicArn,
      description: '通知SNSトピックARN',
    });

    new cdk.CfnOutput(this, 'ReceiptRuleSetName', {
      value: ruleSet.receiptRuleSetName,
      description: 'SES Receipt Rule Set名（手動でActiveにする必要があります）',
    });
  }
}
