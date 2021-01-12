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
 
    const CLUSTER_NAME = "ecsCICD-cluster";
    const REPO_NAME = "ecsCICD";
    const DOCKER_PORT=80;
    const LISTEN_PORT=80;
    const MEMORY=256;
    const CPU=256;
 

    this.ecrRepo = new ecr.Repository(this, REPO_NAME+"ECRRepo");
   
    const codecommitRepo = new codecommit.Repository(this, REPO_NAME+"Repository", { repositoryName: REPO_NAME+"Repository"});

    // ***CodeBuild Contructs***
    const project = new codebuild.Project(this, REPO_NAME+'Project', {
      projectName: `${this.stackName}`,
      source: codebuild.Source.codeCommit({ repository: codecommitRepo }),
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
              `printf '[{\"name\":\"${REPO_NAME}Container\",\"imageUri\":\"%s\"}]' $ECR_REPO_URI:latest > imagedefinitions.json`,
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
      repository: codecommitRepo,
      output: sourceOutput
    })

    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'CodeBuild',
      project: project,
      input: sourceOutput,
      outputs: [this.buildOutput],  
    });

    const manualApprovalAction = new codepipeline_actions.ManualApprovalAction({
      actionName: 'Approve',
    });

    // PIPELINE STAGES

    this.ecsPipeline = new codepipeline.Pipeline(this, REPO_NAME+'Pipeline', {
      stages: [
        {
          stageName: 'Source',
          actions: [sourceAction],
        },
        {
          stageName: 'Build',
          actions: [buildAction],
        },
        // {
        //   stageName: 'Approve',
        //   actions: [manualApprovalAction],
        // }, 
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
    const vpc = new ec2.Vpc(this, this.stackName+'-vpc', {
      cidr: '10.0.0.0/16',
      natGateways: 1,
      maxAzs: 2
    });

    const clusterAdmin = new iam.Role(this, this.stackName+'AdminRole', {
      assumedBy: new iam.AccountRootPrincipal()
    });

    const cluster = new ecs.Cluster(this, CLUSTER_NAME, {
      vpc: vpc,
    });

    const logging = new ecs.AwsLogDriver({
      streamPrefix: this.stackName+'ecs-logs'
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


    const taskDef = new ecs.FargateTaskDefinition(this,this.stackName+ 'ecs-taskdef', {
      taskRole: taskRole
    });
    taskDef.addToExecutionRolePolicy(executionRolePolicy);


    const container = taskDef.addContainer(REPO_NAME+'Container', {
      image:ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      //image: ecs.ContainerImage.fromEcrRepository(this.ecrRepo),//ecs.ContainerImage.fromAsset(path.resolve(__dirname, 'bulletin-board-app')),
      memoryLimitMiB: MEMORY,
      cpu: CPU,
      logging
    });


    container.addPortMappings({
      containerPort: DOCKER_PORT,
      protocol: ecs.Protocol.TCP
    });


    const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, this.stackName+'ecs-service', {
      cluster: cluster,
      taskDefinition: taskDef,
      publicLoadBalancer: true,
      desiredCount: 1,
      listenerPort: LISTEN_PORT
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
 
    new cdk.CfnOutput(this, `CodeCommit URI HTTPS`, {
            exportName: 'CodeCommitURL',
            value: codecommitRepo.repositoryCloneUrlHttp
        });

  }
}
