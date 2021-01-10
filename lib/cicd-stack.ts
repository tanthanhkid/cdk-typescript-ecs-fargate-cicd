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


export class CiCdStack extends cdk.Stack {

  ecrRepo: ecr.Repository;
  ecsPipeline: codepipeline.Pipeline;
  buildOutput: codepipeline.Artifact

  get getEcrRepo(): ecr.Repository {
    return this.ecrRepo;
  }
  get getEcsPipeline(): codepipeline.Pipeline {
    return this.ecsPipeline;
  }
  get getBuildOutput(): codepipeline.Artifact {
    return this.buildOutput;
  }

  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);


    /**
     * Create a new VPC with single NAT Gateway
     */

    const CLUSTER_NAME = "ecs-cluster";

    // cluster.addCapacity('DefaultAutoScalingGroup', {
    //   instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO)
    // });


    this.ecrRepo = new ecr.Repository(this, 'docker_tutorialRepo');





    // const codeCommitRole: iam.IRole | undefined = new iam.Role(this, 'CodeCommitRole', {
    //   assumedBy: new iam.ServicePrincipal('codecommit.amazonaws.com'),
    // });

    const bulletinRepo = codecommit.Repository.fromRepositoryName(this, 'ImportedRepo', 'docker_tutorial');

    // CODEBUILD - project
    const project = new codebuild.Project(this, 'docker_tutorialProject', {
      projectName: `${this.stackName}`,
      source: codebuild.Source.codeCommit({ repository: bulletinRepo }),
      // role:codeCommitRole,
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_2,
        privileged: true
      },
      environmentVariables: {
        'CLUSTER_NAME': {
          value: `${CLUSTER_NAME}`
        },
        'ECR_REPO_URI': {
          value: `${this.ecrRepo.repositoryUri}`
        }
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          pre_build: {
            commands: [
              'env',
              // 'export TAG=${CODEBUILD_RESOLVED_SOURCE_VERSION}'
            ]
          },
          build: {
            commands: [
              `docker build -t $ECR_REPO_URI .`,
              '$(aws ecr get-login --no-include-email)',
              'docker push $ECR_REPO_URI'
            ]
          },
          post_build: {
            commands: [
              'echo "In Post-Build Stage"',
              // 'cd ..',
              `printf '[{\"name\":\"docker_tutorialContainer\",\"imageUri\":\"%s\"}]' $ECR_REPO_URI:latest > imagedefinitions.json`,
              "pwd; ls -al; cat imagedefinitions.json"
            ]
          }
        },
        artifacts: {
          files: [
            'imagedefinitions.json'
          ]
        }
      })
    });

    // ***PIPELINE ACTIONS***

    const sourceOutput = new codepipeline.Artifact();
    this.buildOutput = new codepipeline.Artifact();

    const sourceAction = new codepipeline_actions.CodeCommitSourceAction({
      actionName: 'CodeCommit_Source',
      repository: bulletinRepo,
      output: sourceOutput
    })

    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'CodeBuild',
      project: project,
      input: sourceOutput,
      outputs: [this.buildOutput], // optional
    });

    const manualApprovalAction = new codepipeline_actions.ManualApprovalAction({
      actionName: 'Approve',
    });

    // PIPELINE STAGES

    this.ecsPipeline = new codepipeline.Pipeline(this, 'MyECSPipeline', {
      stages: [
        {
          stageName: 'Source',
          actions: [sourceAction],
        },
        {
          stageName: 'Build',
          actions: [buildAction],
        },
        {
          stageName: 'Approve',
          actions: [manualApprovalAction],
        }, 
      ]
    });


    project.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "*"
      ],
      resources: [`*`],
    }));

    this.ecsPipeline.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "*"
      ],
      resources: [`*`],
    }));
    this.ecrRepo.grantPullPush(project.role!);

    //ECS step
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
    this.ecrRepo.grantPullPush(taskRole);
    // ***ECS Contructs***

    const executionRolePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ['*'],
      actions: [
        "*"
      ]
    });


    const taskDef = new ecs.FargateTaskDefinition(this, 'ecs-taskdef', {
      taskRole: taskRole
    });
    taskDef.addToExecutionRolePolicy(executionRolePolicy);


    const container = taskDef.addContainer('docker_tutorialContainer', {
      image: ecs.ContainerImage.fromEcrRepository(this.ecrRepo),//ecs.ContainerImage.fromAsset(path.resolve(__dirname, 'bulletin-board-app')),
      memoryLimitMiB: 256,
      cpu: 256,
      logging
    });


    container.addPortMappings({
      containerPort: 80,
      protocol: ecs.Protocol.TCP
    });


    const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'ecs-service', {
      cluster: cluster,
      taskDefinition: taskDef,
      publicLoadBalancer: true,
      desiredCount: 1,
      listenerPort: 80
    });

    const scaling = fargateService.service.autoScaleTaskCount({ maxCapacity: 6 });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 10,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60)
    });

 
    // ***END ECS Contructs***


    const deployAction = new codepipeline_actions.EcsDeployAction({
      actionName: 'DeployAction',
      service: fargateService.service,
      imageFile: new codepipeline.ArtifactPath(this.buildOutput, `imagedefinitions.json`)
    });

    this.ecsPipeline.addStage({
      stageName: 'Deploy-to-ECS',
      actions: [deployAction],
    })

    //ISSUE: NONE

    // #1. When provision ECS task and pipeline at the same time, pipeline wait for task to run sucess but Task wait for image in ECR,
    // Manual click start build in CodeBuild solve the problem by give ECS Task first image

    new cdk.CfnOutput(this, 'LoadBalancerDNS', { value: fargateService.loadBalancer.loadBalancerDnsName });
    new cdk.CfnOutput(this, 'Progess', { value: 'Finished 100%' });

  }
}
