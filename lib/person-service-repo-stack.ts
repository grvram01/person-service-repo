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

export function addCorsOptions(apiResource: apigateway.IResource) {
  apiResource.addMethod('OPTIONS', new apigateway.MockIntegration({
    integrationResponses: [{
      statusCode: '200',
      responseParameters: {
        'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
        'method.response.header.Access-Control-Allow-Origin': "'*'",
        'method.response.header.Access-Control-Allow-Credentials': "'false'",
        'method.response.header.Access-Control-Allow-Methods': "'OPTIONS,GET,PUT,POST,DELETE'",
      },
    }],
    // In case you want to use binary media types, comment out the following line
    passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
    requestTemplates: {
      "application/json": "{\"statusCode\": 200}"
    },
  }), {
    methodResponses: [{
      statusCode: '200',
      responseParameters: {
        'method.response.header.Access-Control-Allow-Headers': true,
        'method.response.header.Access-Control-Allow-Methods': true,
        'method.response.header.Access-Control-Allow-Credentials': true,
        'method.response.header.Access-Control-Allow-Origin': true,
      },
    }]
  })
}

export class PersonServiceRepoStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // DynamoDB Table with Streams Enabled
    const dynamoTable = new dynamodb.Table(this, 'PersonsDynamoTable', {
      partitionKey: { name: 'personId', type: dynamodb.AttributeType.STRING },
      // Enable streams to capture new images on CRUD ops
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      // Used for testing. Destroy table upon stack removal
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    // Lambda function that will be triggered by DynamoDB Streams and publish to EventBridge
    const streamLambda = new lambda.Function(this, 'StreamLambda', {
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.X86_64,
      handler: 'main',  // Go handler name
      code: lambda.Code.fromAsset('lambdas/stream'),  // Your Go lambda code
    });
    // Grant the Lambda function read access to the DynamoDB Stream
    dynamoTable.grantStreamRead(streamLambda);
    // HTTP Lambda to handle API Gateway requests
    const httpLambda = new lambda.Function(this, 'HttpLambda', {
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.X86_64,
      description: 'Acknowledge the incoming request from client',
      code: lambda.Code.fromAsset('lambdas'), // Path to your Go Lambda function
      handler: 'main',
      environment: {
        TABLE_NAME: dynamoTable.tableName,
      },
    });
    // Grant permissions to the HTTP Lambda to perform CRUD on the DynamoDB table
    // dynamoTable.grantFullAccess(httpLambda);
    dynamoTable.grantReadWriteData(httpLambda);

    // API Gateway connected to the HTTP Lambda
    const api = new apigateway.LambdaRestApi(this, 'ApiGateway', {
      handler: httpLambda,
      proxy: false,
    });
    // Define API Gateway routes
    const personsResource = api.root.addResource('persons');
    personsResource.addMethod('GET');
    // Create a Model for the POST request
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
        },
        required: ['firstName', 'phoneNumber', 'lastName', 'address'],
      },
    });

    // Create a RequestValidator
    const requestValidator = new apigateway.RequestValidator(this, 'RequestValidator', {
      restApi: api,
      requestValidatorName: 'RequestValidator',
      validateRequestBody: true,
      validateRequestParameters: false,
    });

    // Add POST method with schema validation
    personsResource.addMethod('POST', new apigateway.LambdaIntegration(httpLambda), {
      requestModels: { 'application/json': postModel },
      requestValidator,
    });
    addCorsOptions(personsResource)
    // Route for GET, PUT, DELETE by personId
    const personById = personsResource.addResource('{personId}');
    // GET - Retrieve a person by personId
    personById.addMethod('GET', new apigateway.LambdaIntegration(httpLambda), {
      requestValidator: new apigateway.RequestValidator(this, 'GetRequestValidator', {
        restApi: api,
        validateRequestParameters: true,
      }),
    });

    personById.addMethod('PUT', new apigateway.LambdaIntegration(httpLambda), {
      requestValidator: new apigateway.RequestValidator(this, 'PutRequestValidator', {
        restApi: api,
        validateRequestBody: true,
        validateRequestParameters: true,
      }),
    });
    addCorsOptions(personById)
    // EventBridge Event Bus

    // Grant permission for Lambda to publish events to EventBridge
    const eventBus = new eventbridge.EventBus(this, 'DDBStreamEventBus', {
      eventBusName: 'DDBStreamCustomEventBus',
    });
    streamLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [eventBus.eventBusArn], // Grant permission to use the event bus
    }));

    // eventBus.grantPutEventsTo(streamLambda);

    // Create event source for DynamoDB stream to trigger Lambda
    const streamEventSource = new eventSources.DynamoEventSource(dynamoTable, {
      startingPosition: lambda.StartingPosition.LATEST,
    });
    streamLambda.addEventSource(streamEventSource);
    // Create a Log Group for CloudWatch Logs
    const logGroup = new logs.LogGroup(this, 'EventLogGroup', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create a CloudWatch Logs target for EventBridge events
    const cloudWatchLogsTarget = new eventTargets.CloudWatchLogGroup(logGroup);

    // Create EventBridge rule to route DynamoDB Stream events to CloudWatch Logs
    new eventbridge.Rule(this, 'InspectDDBStreamEventsRule', {
      eventBus,
      eventPattern: {
        source: ['ddb.source'],  // Ensure the source matches the one used in your events
        detailType: ['DynamoDBStreamEvent'],
      },
      targets: [cloudWatchLogsTarget],  // Target CloudWatch Logs for inspection
    });
    // Lambda function for email & logging service
    const emailServiceLambda = new lambda.Function(this, 'EmailSvcLambda', {
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.X86_64,
      code: lambda.Code.fromAsset('lambdas/email'), // Path to your Go Lambda function
      handler: 'main',
    });

    emailServiceLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      effect: iam.Effect.ALLOW,
      resources: [
        // `arn:aws:logs:${this.region}:${this.account}:*`
        '*'
      ],
    }));

    const emailLambdaExecutionRole = emailServiceLambda.role!;
    emailLambdaExecutionRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
    // EventBridge rule to trigger the consumer Lambda
    if(dynamoTable.tableStreamArn) {
      new eventbridge.Rule(this, 'EventBridgeRule', {
        eventBus,
        eventPattern: {
          source: ['ddb.source'],
          //     source: ['aws.dynamodb'],
          detailType: ['DynamoDBStreamEvent'],
          resources: [dynamoTable.tableStreamArn],
        },
        targets: [new eventTargets.LambdaFunction(emailServiceLambda)],
      });
    }
    
  }
}

const app = new cdk.App();
new PersonServiceRepoStack(app, 'PersonServiceRepoStack');
app.synth();