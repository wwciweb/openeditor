import AWS from 'aws-sdk';
import { success, failure } from './libs/response-lib';

const { TableName, GIT_COMMIT_SHORT: version } = process.env;
const dynamoDb = new AWS.DynamoDB.DocumentClient();
// const cognito = new AWS.CognitoIdentityServiceProvider({ region: 'us-east-2' });

export async function main(event, context) {
  const { PK, SK, IndexName, parent } = event.queryStringParameters;

  let params = {
    TableName,
    KeyConditionExpression: 'PK = :PK and begins_with(SK, :SK)',
    ExpressionAttributeValues: { ':PK': PK, ':SK': SK },
  };

  if (IndexName === 'SK-index') {
    params = {
      TableName,
      IndexName,
      KeyConditionExpression: 'SK = :SK',
      ExpressionAttributeValues: {
        ':SK': SK,
      },
      FilterExpression: 'attribute_not_exists(deleted)',
    };
  }

  if (IndexName === 'parent-index') {
    params = {
      TableName,
      IndexName,
      KeyConditionExpression: 'parent = :parent',
      ExpressionAttributeValues: {
        ':parent': parent,
      },
      FilterExpression: 'attribute_not_exists(deleted)',
    };
  }

  try {
    const result = await dynamoDb['query'](params).promise();

    // const user = await cognito
    //   .adminGetUser({
    //     UserPoolId: 'us-east-1:6895de8c-6aa1-40c1-a853-a4685994b32c', // process.env.COGNITO_USER_POOL_ID,
    //     Username: 'ad223c12-145f-4284-a586-74b19cde94d5',
    //   })
    //   .promise();
    // user: user.UserAttributes
    // const users = getUserOfAuthenticatedUser();

    // let request = {
    //   UserPoolId: 'us-east-1_363ZjBC77', // Set your cognito user pool id
    //   Filter: `sub = "ad223c12-145f-4284-a586-74b19cde94d5"`,
    //   // Limit: 1,
    // };
    // let users = await cognito.listUsers(request).promise();

    return success({ data: result.Items, version, debug: { params } });
  } catch (error) {
    return failure({ data: null, errors: [error], version, debug: { params } });
  }
}

// async function getUserOfAuthenticatedUser(event) {
//   // Get the unique ID given by cognito for this user, it is passed to lambda as part of a large string in event.requestContext.identity.cognitoAuthenticationProvider
//   // let userSub = 'ad223c12-145f-4284-a586-74b19cde94d5'; // event.requestContext.identity.cognitoAuthenticationProvider.split(':CognitoSignIn:')[1]
//   let request = {
//     UserPoolId: 'us-east-1_363ZjBC77', // Set your cognito user pool id
//     // Filter: `sub = "${userSub}"`,
//     // Limit: 1,
//   };
//   let users = await cognito.listUsers(request).promise();
//   console.log('got user:', users);
// }
