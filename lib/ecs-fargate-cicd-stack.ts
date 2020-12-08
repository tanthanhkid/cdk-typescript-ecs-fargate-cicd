import cdk = require('@aws-cdk/core');
import ec2 = require("@aws-cdk/aws-ec2");
import ecr = require('@aws-cdk/aws-ecr');
import ecs = require("@aws-cdk/aws-ecs");
import ecs_patterns = require("@aws-cdk/aws-ecs-patterns");
import iam = require("@aws-cdk/aws-iam");
import codebuild = require('@aws-cdk/aws-codebuild');
import codecommit = require('@aws-cdk/aws-codecommit');
import targets = require('@aws-cdk/aws-events-targets');
import codedeploy = require('@aws-cdk/aws-codedeploy');
import codepipeline = require('@aws-cdk/aws-codepipeline');
import codepipeline_actions = require('@aws-cdk/aws-codepipeline-actions');
import path = require('path');


export class EcsFargateCicdStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    /**
     * Create a new VPC with single NAT Gateway
     */
    const vpc = new ec2.Vpc(this, 'ecs-cdk-vpc', {
      cidr: '10.0.0.0/16',
      natGateways: 1,
      maxAzs: 3
    });

    const clusterAdmin = new iam.Role(this, 'AdminRole', {
      assumedBy: new iam.AccountRootPrincipal()
    });

    const cluster = new ecs.Cluster(this, "ecs-cluster", {
      vpc: vpc,
    });

    const logging = new ecs.AwsLogDriver({
      streamPrefix: 'ecs-logs'
    });

    const taskRole = new iam.Role(this, `ecs-taskRole-${this.stackName}`, {
      roleName: `ecs-taskRole-${this.stackName}`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    });

    // ***ECS Contructs***

    const executionRolePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ['*'],
      actions: [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ]
    });

    const taskDef = new ecs.FargateTaskDefinition(this,'ecs-taskdef',{
      taskRole:taskRole
    });

    taskDef.addToExecutionRolePolicy(executionRolePolicy);

    const container = taskDef.addContainer('flask-app',{
      image:ecs.ContainerImage.fromAsset(path.resolve(__dirname, 'node-bulletin-board\\bulletin-board-app')),
      memoryLimitMiB:256,
      cpu:256,
      logging
    });

    container.addPortMappings({
      containerPort:80,
      protocol:ecs.Protocol.TCP
    });

    const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this,'ecs-service',{
      cluster:cluster,
      taskDefinition:taskDef,
      publicLoadBalancer:true,
      desiredCount:3,
      listenerPort:80
    });

    // const scaling = fargateService.service.autoScaleTaskCount({maxCapacity:6});
    // scaling.scaleOnCpuUtilization('CpuScaling',{
    //   targetUtilizationPercent:10,
    //   scaleInCooldown:cdk.Duration.seconds(60),
    //   scaleOutCooldown:cdk.Duration.seconds(60)
    // });

  }
}
