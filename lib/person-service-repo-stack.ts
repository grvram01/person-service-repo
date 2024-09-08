import * as cdk from 'aws-cdk-lib';
import { StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as eventbridge from 'aws-cdk-lib/aws-events';
import * as eventTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as eventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';

export class PersonServiceRepoStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // DynamoDB Table
    const dynamoTable = new dynamodb.Table(this, 'PersonsDynamoTable', {
      partitionKey: { name: 'personId', type: dynamodb.AttributeType.STRING },
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Stream processing Lambda (DynamoDB -> EventBridge)
    const streamLambda = new lambda.Function(this, 'StreamLambda', {
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.X86_64,
      handler: 'main',
      code: lambda.Code.fromAsset('lambdas/stream'),
    });
    dynamoTable.grantStreamRead(streamLambda);

    const eventBus = new eventbridge.EventBus(this, 'DDBStreamEventBus', {
      eventBusName: 'DDBStreamCustomEventBus',
    });
    streamLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [eventBus.eventBusArn],
    }));

    streamLambda.addEventSource(new eventSources.DynamoEventSource(dynamoTable, {
      startingPosition: lambda.StartingPosition.LATEST,
    }));

    // HTTP Lambda (API Gateway -> Lambda -> DynamoDB)
    const httpLambda = new lambda.Function(this, 'HttpLambda', {
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.X86_64,
      code: lambda.Code.fromAsset('lambdas'),
      handler: 'main',
      environment: {
        TABLE_NAME: dynamoTable.tableName,
      },
    });
    dynamoTable.grantReadWriteData(httpLambda);
    const api = new apigateway.RestApi(this, 'ApiGateway', {
      restApiName: 'PersonServiceAPI',
      description: 'This API handles person records.',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
      },
    });

    const personsResource = api.root.addResource('persons');
    personsResource.addMethod('GET');

    const postModel = new apigateway.Model(this, 'PostModel', {
      restApi: api,
      contentType: 'application/json',
      schema: {
        schema: apigateway.JsonSchemaVersion.DRAFT4,
        title: 'Person Request Schema',
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          firstName: { type: apigateway.JsonSchemaType.STRING },
          phoneNumber: { type: apigateway.JsonSchemaType.STRING },
          lastName: { type: apigateway.JsonSchemaType.STRING },
          address: { type: apigateway.JsonSchemaType.STRING },
        },
        required: ['firstName', 'phoneNumber', 'lastName', 'address'],
      },
    });
    const requestValidator = new apigateway.RequestValidator(this, 'RequestValidator', {
      restApi: api,
      validateRequestBody: true,
    });
    personsResource.addMethod('POST', new apigateway.LambdaIntegration(httpLambda), {
      requestModels: { 'application/json': postModel },
      requestValidator,
    });
    const personById = personsResource.addResource('{personId}');
    personById.addMethod('GET', new apigateway.LambdaIntegration(httpLambda));
    personById.addMethod('PUT', new apigateway.LambdaIntegration(httpLambda));
    personById.addMethod('DELETE', new apigateway.LambdaIntegration(httpLambda));
    // Email Lambda Function
    const emailServiceLambda = new lambda.Function(this, 'EmailSvcLambda', {
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.X86_64,
      code: lambda.Code.fromAsset('lambdas/email'),
      handler: 'main',
    });

    emailServiceLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: [
        `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/*`,
      ],
    }));

    emailServiceLambda.role!.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));

    // EventBridge Rule (DynamoDB Stream -> Email Lambda)
    new eventbridge.Rule(this, 'EventBridgeRule', {
      eventBus,
      eventPattern: {
        source: ['ddb.source'],
        detailType: ['DynamoDBStreamEvent'],
      },
      targets: [new eventTargets.LambdaFunction(emailServiceLambda)],
    });
  }
}

const app = new cdk.App();
new PersonServiceRepoStack(app, 'PersonServiceRepoStack');
app.synth();
