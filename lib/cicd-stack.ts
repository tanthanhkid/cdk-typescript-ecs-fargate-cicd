import cdk = require('@aws-cdk/core');
import ec2 = require("@aws-cdk/aws-ec2");
import ecr = require('@aws-cdk/aws-ecr');
import ecs = require("@aws-cdk/aws-ecs");
import ecs_patterns = require("@aws-cdk/aws-ecs-patterns");
import iam = require("@aws-cdk/aws-iam");
import codebuild = require('@aws-cdk/aws-codebuild');
import codecommit = require('@aws-cdk/aws-codecommit');
import codepipeline = require('@aws-cdk/aws-codepipeline');
import codepipeline_actions = require('@aws-cdk/aws-codepipeline-actions');


export class CiCdStack extends cdk.Stack {

  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // *** CONFIG *** 
    const REPO_NAME = "ecsCICD"; // CODE COMMIT REPOSITORY NAME
    const DOCKER_PORT = 80; // DOCKER EXPOSED PORT FROM YOUR CODE
    const LISTEN_PORT = 80; // PUBLIC PORT FOR LOAD BALANCER DNS
    const MEMORY = 256; // vMEMORY PER TASK (MB)
    const CPU = 256; // vCPU PER TASK (MB)
    const DEFAULT_INSTANCE = 1;//The desired number of instantiations of the task definition to keep running on the service.
    const MANUAL_APPROVE = true; //enable manual approve in code pipeline

    // *** STACK CONSTRUCT BEGIN ***

    const CLUSTER_NAME = this.stackName + "-cluster";
    const ecrRepo = new ecr.Repository(this, REPO_NAME + "ECRRepo");

    // ***CodeCommit Contructs***
    const codecommitRepo = new codecommit.Repository(this, REPO_NAME + "Repository", { repositoryName: REPO_NAME + "Repository" });

    // ***CodeBuild Contructs***
    const project = new codebuild.Project(this, REPO_NAME + 'Project', {
      projectName: `${this.stackName}`,
      source: codebuild.Source.codeCommit({ repository: codecommitRepo }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_2,
        privileged: true
      },
      environmentVariables: {
        'CLUSTER_NAME': {
          value: `${CLUSTER_NAME}`
        },
        'ECR_REPO_URI': {
          value: `${ecrRepo.repositoryUri}`
        }
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          pre_build: {
            commands: [
              'env',
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
    const buildOutput = new codepipeline.Artifact();

    const sourceAction = new codepipeline_actions.CodeCommitSourceAction({
      actionName: 'CodeCommit_Source',
      repository: codecommitRepo,
      output: sourceOutput
    })

    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'CodeBuild',
      project: project,
      input: sourceOutput,
      outputs: [buildOutput],
    });



    // PIPELINE STAGES 
    const ecsPipeline = new codepipeline.Pipeline(this, REPO_NAME + 'Pipeline', {
      stages: [
        {
          stageName: 'Source',
          actions: [sourceAction],
        },
        {
          stageName: 'Build',
          actions: [buildAction],
        },
      ]
    });

    if (MANUAL_APPROVE) {
      const manualApprovalAction = new codepipeline_actions.ManualApprovalAction({
        actionName: 'Approve',
      });

      ecsPipeline.addStage({
        stageName: 'Approve',
        actions: [manualApprovalAction],
      });
    }


    project.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "*"
      ],
      resources: [`*`],
    }));

    ecsPipeline.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "*"
      ],
      resources: [`*`],
    }));
    ecrRepo.grantPullPush(project.role!);

    // ***ECS Fargate Contructs***
    this.EcsFargateConstruct(CLUSTER_NAME, ecrRepo, REPO_NAME, MEMORY, CPU, DOCKER_PORT, DEFAULT_INSTANCE, LISTEN_PORT, buildOutput, ecsPipeline, codecommitRepo);

    // ***ECS Ec2 Contructs***

  }

  private EcsFargateConstruct(CLUSTER_NAME: string, ecrRepo: ecr.Repository, REPO_NAME: string, MEMORY: number, CPU: number, DOCKER_PORT: number, DEFAULT_INSTANCE: number, LISTEN_PORT: number, buildOutput: codepipeline.Artifact, ecsPipeline: codepipeline.Pipeline, codecommitRepo: codecommit.Repository) {
    const vpc = new ec2.Vpc(this, this.stackName + '-vpc', {
      cidr: '10.0.0.0/16',
      natGateways: 1,
      maxAzs: 2
    });

    const cluster = new ecs.Cluster(this, CLUSTER_NAME, {
      vpc: vpc,
    });

    const logging = new ecs.AwsLogDriver({
      streamPrefix: this.stackName + 'ecs-logs'
    });

    const taskRole = new iam.Role(this, `ecs-taskRole-${this.stackName}`, {
      roleName: `ecs-taskRole-${this.stackName}`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    });

    ecrRepo.grantPullPush(taskRole);

    const taskDef = new ecs.FargateTaskDefinition(this, this.stackName + 'ecs-taskdef', {
      taskRole: taskRole
    });

    const executionRolePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ['*'],
      actions: [
        "*"
      ]
    });

    taskDef.addToExecutionRolePolicy(executionRolePolicy);

    const container = taskDef.addContainer(REPO_NAME + 'Container', {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      //image: ecs.ContainerImage.fromEcrRepository(this.ecrRepo),//ecs.ContainerImage.fromAsset(path.resolve(__dirname, 'bulletin-board-app')),
      memoryLimitMiB: MEMORY,
      cpu: CPU,
      logging
    });

    container.addPortMappings({
      containerPort: DOCKER_PORT,
      protocol: ecs.Protocol.TCP
    });

    const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, this.stackName + 'ecs-service', {
      cluster: cluster,
      taskDefinition: taskDef,
      publicLoadBalancer: true,
      desiredCount: DEFAULT_INSTANCE,
      listenerPort: LISTEN_PORT
    });

    const scaling = fargateService.service.autoScaleTaskCount({ maxCapacity: 6 });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 10,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60)
    });

    const deployAction = new codepipeline_actions.EcsDeployAction({
      actionName: 'DeployAction',
      service: fargateService.service,
      imageFile: new codepipeline.ArtifactPath(buildOutput, `imagedefinitions.json`)
    });

    ecsPipeline.addStage({
      stageName: 'Deploy-to-ECS',
      actions: [deployAction],
    });

    new cdk.CfnOutput(this, `CodeCommit`, {
      exportName: 'URL',
      value: codecommitRepo.repositoryCloneUrlHttp
    });
  }
}
