#!/usr/bin/env node
import 'source-map-support/register.js';
import * as cdk from 'aws-cdk-lib';
import { SesSendingStack } from '../lib/ses-sending-stack.js';
import { loadConfig } from '../config/parameters.js';

const app = new cdk.App();

const sesConfig = loadConfig({ sesConfig: app.node.tryGetContext('sesConfig') });

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: sesConfig.region,
};

new SesSendingStack(app, 'SesSendingStack', {
  sesConfig,
  env,
});
