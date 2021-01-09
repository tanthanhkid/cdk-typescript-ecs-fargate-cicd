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


export class EcsFargateCicdStack1 extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
     

    /**
     * Create a new VPC with single NAT Gateway
     */
    const vpc = new ec2.Vpc(this, 'ecs-cdk-vpc', {
      cidr: '10.0.0.0/16',
      natGateways: 1,
      maxAzs: 2
    });

    const clusterAdmin = new iam.Role(this, 'AdminRole', {
      assumedBy: new iam.AccountRootPrincipal()
    });

    const cluster = new ecs.Cluster(this, "ecs-cluster", {
      vpc: vpc,
    });
    
     cluster.addCapacity('DefaultAutoScalingGroup', {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO)
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
  const ecrRepo = new ecr.Repository(this,'BulletinWebsiteRepo');
  
    // const taskDef = new ecs.FargateTaskDefinition(this,'ecs-taskdef',{
    //   taskRole:taskRole
    // });

    
    
    // const container = taskDef.addContainer('flask-app',{
    //   image: ecs.ContainerImage.fromEcrRepository(ecrRepo,"latest"),//ecs.ContainerImage.fromAsset(path.resolve(__dirname, 'bulletin-board-app')),
    //   memoryLimitMiB:256,
    //   cpu:256,
    //   logging
    // });

    

    // const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this,'ecs-service',{
    //   cluster:cluster,
    //   taskDefinition:taskDef,
    //   publicLoadBalancer:true,
    //   desiredCount:1,
    //   listenerPort:80
    // });
    
      const taskDef = new ecs.Ec2TaskDefinition(this, "MyTaskDefinition");
      
      taskDef.addToExecutionRolePolicy(executionRolePolicy); 
      
  const container =   taskDef.addContainer("AppContainer", {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepo,"latest"),
      memoryLimitMiB: 512,
      logging,
    });
    
container.addPortMappings({
      containerPort:8080,
      protocol:ecs.Protocol.TCP
    });

    // Instantiate ECS Service with just cluster and image
   const ecsService= new ecs.Ec2Service(this, "Ec2Service", {
      cluster,
      taskDefinition: taskDef,
    });

    // const scaling = fargateService.service.autoScaleTaskCount({maxCapacity:6});
    // scaling.scaleOnCpuUtilization('CpuScaling',{
    //   targetUtilizationPercent:10,
    //   scaleInCooldown:cdk.Duration.seconds(60),
    //   scaleOutCooldown:cdk.Duration.seconds(60)
    // });

 
 const codeCommitRole: iam.IRole | undefined = new iam.Role(this, 'CodeCommitRole', {
  assumedBy: new iam.ServicePrincipal('codecommit.amazonaws.com'),    
});
 
const bulletinRepo =  codecommit.Repository.fromRepositoryName(this, 'ImportedRepo', 'bullettin');
 
    // CODEBUILD - project
    const project  = new codebuild.Project(this,'BulletinWebsiteProject',{
      projectName:`${this.stackName}`,
      source:codebuild.Source.codeCommit({repository:bulletinRepo}), 
      // role:codeCommitRole,
      environment:{
        buildImage:codebuild.LinuxBuildImage.AMAZON_LINUX_2_2,
        privileged:true
      },
      environmentVariables:{
        'CLUSTER_NAME':{
          value:`${cluster.clusterName}`
        },
        'ECR_REPO_URI':{
          value:`${ecrRepo.repositoryUri}`
        }
      },
      buildSpec:codebuild.BuildSpec.fromObject({
        version:"0.2",
        phases:{
          pre_build:{
            commands:[
              'env',
              'export TAG=${CODEBUILD_RESOLVED_SOURCE_VERSION}'
            ]
          },
          build:{
            commands:[  
              `docker build -t $ECR_REPO_URI:$TAG .`,
              '$(aws ecr get-login --no-include-email)',
              'docker push $ECR_REPO_URI:$TAG'
            ]
          },
          post_build: {
            commands: [
              'echo "In Post-Build Stage"',
              'cd ..',
              "printf '[{\"name\":\"node-bulletin-board\",\"imageUri\":\"%s\"}]' $ECR_REPO_URI:$TAG > imagedefinitions.json",
              "pwd; ls -al; cat imagedefinitions.json"
            ]
          }
        },
        // artifacts: {
        //   files: [
        //     'imagedefinitions.json'
        //   ]
        // }
      })
    });
 
    // ***PIPELINE ACTIONS***

    const sourceOutput = new codepipeline.Artifact();
    const buildOutput = new codepipeline.Artifact();

    
 
    
    const sourceAction = new codepipeline_actions.CodeCommitSourceAction({
      actionName:'CodeCommit_Source',
      repository:bulletinRepo,
      output:sourceOutput
    })

    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'CodeBuild',
      project: project,
      input: sourceOutput,
      outputs: [buildOutput], // optional
    });

    // const manualApprovalAction = new codepipeline_actions.ManualApprovalAction({
    //   actionName: 'Approve',
    // });

    const deployAction = new codepipeline_actions.EcsDeployAction({
      actionName: 'DeployAction',
      service: ecsService,
      imageFile: new codepipeline.ArtifactPath(buildOutput, `imagedefinitions.json`)
    });

    // PIPELINE STAGES

    new codepipeline.Pipeline(this, 'MyECSPipeline', {
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
        {
          stageName: 'Deploy-to-ECS',
          actions: [deployAction],
        }
      ]
    });

    ecrRepo.grantPullPush(project.role!)
    project.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "ecs:DescribeCluster",
        "codebuild:*",
                "codecommit:GetBranch",
                "codecommit:GetCommit",
                "codecommit:GetRepository",
                "codecommit:ListBranches",
                "codecommit:ListRepositories",
                "cloudwatch:GetMetricStatistics",
                "ec2:DescribeVpcs",
                "ec2:DescribeSecurityGroups",
                "ec2:DescribeSubnets",
                "ecr:DescribeRepositories",
                "ecr:ListImages",
                "elasticfilesystem:DescribeFileSystems",
                "events:DeleteRule",
                "events:DescribeRule",
                "events:DisableRule",
                "events:EnableRule",
                "events:ListTargetsByRule",
                "events:ListRuleNamesByTarget",
                "events:PutRule",
                "events:PutTargets",
                "events:RemoveTargets",
                "logs:GetLogEvents",
                "s3:GetBucketLocation",
                "s3:ListAllMyBuckets"
        ],
      resources: [`${cluster.clusterArn}`],
    }));

    //OUTPUT

    // new cdk.CfnOutput(this, 'LoadBalancerDNS', { value: ecsService});
    new cdk.CfnOutput(this, 'Progess', { value: 'Finished 100%' });

  }
}
