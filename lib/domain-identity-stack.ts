import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ses from 'aws-cdk-lib/aws-ses';
import { Construct } from 'constructs';
import { SesConfig } from '../config/parameters.js';

interface DomainIdentityStackProps extends cdk.StackProps {
  readonly sesConfig: SesConfig;
}

export class DomainIdentityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DomainIdentityStackProps) {
    super(scope, id, props);

    const config = props.sesConfig;
    const domainConfig = config.newDomain!;

    // Route53 Hosted Zone
    let hostedZone: route53.IHostedZone;
    if (domainConfig.createHostedZone) {
      hostedZone = new route53.PublicHostedZone(this, 'HostedZone', {
        zoneName: domainConfig.domainName,
      });

      new cdk.CfnOutput(this, 'NameServers', {
        value: (hostedZone as route53.PublicHostedZone).hostedZoneNameServers?.join(', ') ?? '',
        description:
          'ドメインレジストラに設定するネームサーバー',
      });
    } else {
      hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
        domainName: domainConfig.domainName,
      });
    }

    // SES Email Identity (DKIM auto-configured)
    const identity = new ses.EmailIdentity(this, 'EmailIdentity', {
      identity: ses.Identity.publicHostedZone(
        hostedZone as route53.IPublicHostedZone
      ),
    });

    // MX Record for SES inbound
    new route53.MxRecord(this, 'MxRecord', {
      zone: hostedZone,
      values: [
        {
          priority: 10,
          hostName: `inbound-smtp.${this.region}.amazonaws.com`,
        },
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'DomainName', {
      value: domainConfig.domainName,
      description: 'SES検証済みドメイン',
    });
  }
}
