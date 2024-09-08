import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { PersonServiceRepoStack } from '../lib/person-service-repo-stack';

test('DynamoDB Table Created', () => {
  const app = new App();
  const stack = new PersonServiceRepoStack(app, 'TestStack');
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::DynamoDB::Table', {
    KeySchema: Match.arrayWith([{
      AttributeName: 'personId',
      KeyType: 'HASH',
    }]),
    StreamSpecification: {
      StreamViewType: 'NEW_IMAGE',
    },
  });
});

test('Lambda Function Created', () => {
  const app = new App();
  const stack = new PersonServiceRepoStack(app, 'TestStack');
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::Lambda::Function', {
    Runtime: 'provided.al2023',
  });
});

test('API Gateway Created', () => {
  const app = new App();
  const stack = new PersonServiceRepoStack(app, 'TestStack');
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
});
