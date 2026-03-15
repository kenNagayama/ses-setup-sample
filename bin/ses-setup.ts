#!/usr/bin/env node
import 'source-map-support/register.js';
import * as cdk from 'aws-cdk-lib';
import { SesReceivingStack } from '../lib/ses-receiving-stack.js';
import { DomainIdentityStack } from '../lib/domain-identity-stack.js';
import { loadConfig } from '../config/parameters.js';

const app = new cdk.App();

const sesConfig = loadConfig({ sesConfig: app.node.tryGetContext('sesConfig') });

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: sesConfig.region,
};

// Stack 1: メール受信スタック（必須）
const receivingStack = new SesReceivingStack(app, 'SesReceivingStack', {
  sesConfig,
  env,
});

// Stack 2: ドメインIdentityスタック（パターンBのみ）
if (sesConfig.domainPattern === 'newDomain') {
  new DomainIdentityStack(app, 'DomainIdentityStack', {
    sesConfig,
    env,
  });
}
