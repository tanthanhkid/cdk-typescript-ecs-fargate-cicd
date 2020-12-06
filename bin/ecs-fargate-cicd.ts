#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { EcsFargateCicdStack } from '../lib/ecs-fargate-cicd-stack';

const app = new cdk.App();
new EcsFargateCicdStack(app, 'EcsFargateCicdStack');
