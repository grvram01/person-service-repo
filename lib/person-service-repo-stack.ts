import * as cdk from 'aws-cdk-lib';
import { StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as eventbridge from 'aws-cdk-lib/aws-events';
import * as eventTargets from 'aws-cdk-lib/aws-events-targets';

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
    // EventBridge Event Bus
    const eventBus = new eventbridge.EventBus(this, 'PersonSvc3EventBus', {
      eventBusName: 'DDBEventBus',
    });

    // EventBridge Rule to route DynamoDB Stream events
    const eventRule = new eventbridge.Rule(this, 'DDBStreamRule', {
      eventBus,
      eventPattern: {
        source: ['aws.dynamodb'],
        detailType: ['DynamoDB Stream Record'],
        resources: ['dynamoTable.tableStreamArn'],
      },
    });

    // Lambda function for Email Service
    const emailServiceLambda = new lambda.Function(this, 'EmailSvcLambda', {
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.X86_64,
      code: lambda.Code.fromAsset('lambdas/email'), // Path to your Go Lambda function
      handler: 'main',
    });

    // Lambda function for Logging Service
    const loggingServiceLambda = new lambda.Function(this, 'LoggingSvcLambda', {
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.X86_64,
      code: lambda.Code.fromAsset('lambdas/logging'), // Path to your Go Lambda function
      handler: 'main',
    });

    // Add Lambda Targets to the EventBridge Rule
    eventRule.addTarget(new eventTargets.LambdaFunction(emailServiceLambda));
    eventRule.addTarget(new eventTargets.LambdaFunction(loggingServiceLambda));

    // Grant EventBridge permissions to invoke the Lambda functions
    eventBus.grantPutEventsTo(emailServiceLambda);
    eventBus.grantPutEventsTo(loggingServiceLambda);
  }
}

const app = new cdk.App();
new PersonServiceRepoStack(app, 'PersonServiceRepoStack');
app.synth();