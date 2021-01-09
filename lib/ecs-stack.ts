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
import elbv2 = require('@aws-cdk/aws-elasticloadbalancingv2');
import s3 = require('@aws-cdk/aws-s3');
import path = require('path');

import CiCdStack =require("./cicd-stack"); 


export class EcsStack extends cdk.Stack {
    constructor(scope: cdk.Construct,REPO_NAME:string, id: string,props?: cdk.StackProps) {
        super(scope, id, props);

        const CLUSTER_NAME="ecs-cluster";
 
        const vpc = new ec2.Vpc(this, 'ecs-cdk-vpc', {
            cidr: '10.0.0.0/16',
            natGateways: 1,
            maxAzs: 2
        });

        const clusterAdmin = new iam.Role(this, 'AdminRole', {
            assumedBy: new iam.AccountRootPrincipal()
        });

        const cluster = new ecs.Cluster(this, CLUSTER_NAME, {
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

        //add deploy to ecs action to pipeline
        const taskDef = new ecs.FargateTaskDefinition(this, 'ecs-taskdef', {
            taskRole: taskRole
        });
        taskDef.addToExecutionRolePolicy(executionRolePolicy);

      const ecrRepo=  ecr.Repository.fromRepositoryName(this,'BulletinWebsiteRepo',REPO_NAME);

        const container = taskDef.addContainer('BulletinWebsiteRepo', {
            image: ecs.ContainerImage.fromEcrRepository(ecrRepo, "latest"),//ecs.ContainerImage.fromAsset(path.resolve(__dirname, 'bulletin-board-app')),
            memoryLimitMiB: 256,
            cpu: 256,
            logging
        });


        container.addPortMappings({
            containerPort: 8080,
            protocol: ecs.Protocol.TCP
        });


        const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'ecs-service', {
            cluster: cluster,
            taskDefinition: taskDef,
            publicLoadBalancer: true,
            desiredCount: 1,
            listenerPort: 80
        });


        // const deployAction = new codepipeline_actions.EcsDeployAction({
        //     actionName: 'DeployAction',
        //     service: fargateService.service,
        //     imageFile: new codepipeline.ArtifactPath(buildOutput, `imagedefinitions.json`) 
        // });

        // const ecsPipeline = codepipeline.Pipeline

        // ecsPipeline.addStage({
        //     stageName: 'Deploy-to-ECS',
        //     actions: [deployAction],
        // })

        //OUTPUT

        // new cdk.CfnOutput(this, 'LoadBalancerDNS', { value: fargateService.loadBalancer.loadBalancerDnsName});
        new cdk.CfnOutput(this, 'Progess', { value: 'Finished 100%' });

    }
}
