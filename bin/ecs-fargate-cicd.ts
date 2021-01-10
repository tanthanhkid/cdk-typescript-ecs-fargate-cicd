#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
 
import { CiCdStack } from '../lib/cicd-stack';
import { EcsStack } from '../lib/ecs-stack';

const REPO_NAME='BulletinWebsiteRepo';
 
const app = new cdk.App();
new CiCdStack(app, 'CiCdStackV10');

// new EcsStack(app,'EcsStack',REPO_NAME);

