import AWS from 'aws-sdk';
import https from 'https';

import { success, failure } from './libs/response-lib';

const { TableName, GIT_COMMIT_SHORT: version } = process.env;
const dynamoDb = new AWS.DynamoDB.DocumentClient({
  httpOptions: {
    agent: new https.Agent({ keepAlive: true }),
  },
});

export async function main(event, context) {
  const { PK, SK } = event.pathParameters;

  let params = {
    TableName,
    Key: { PK, SK },
  };

  // if (PK.indexOf('SK-index') !== -1) {
  //   params = {
  //     TableName,
  //     IndexName: PK,
  //     KeyConditionExpression: 'SK = :SK',
  //     ExpressionAttributeValues: {
  //       ':SK': SK,
  //     },
  //   };
  // }

  if (PK === 'parent-index') {
    params = {
      TableName,
      IndexName: PK,
      KeyConditionExpression: 'parent = :parent',
      ExpressionAttributeValues: {
        ':parent': SK,
      },
    };
  }

  try {
    const result = await dynamoDb['get'](params).promise();

    return result.Item
      ? success({ data: result.Item, version, debug: { params } })
      : failure({ data: null, version, debug: { params } });
  } catch (error) {
    return failure({ data: null, errors: [error], version, debug: { params } });
  }
}
