import AWS from 'aws-sdk';
import { success, failure } from './libs/response-lib';

const { TableName, GIT_COMMIT_SHORT: version } = process.env;
const dynamoDb = new AWS.DynamoDB.DocumentClient();

export async function main(event, context) {
  const { PK, SK } = event.pathParameters;

  const params = { TableName, Key: { PK, SK } };

  try {
    await dynamoDb['delete'](params).promise();

    return success({ data: null, version, debug: { params } });
  } catch (error) {
    return failure({ data: null, errors: [error], version, debug: { params } });
  }
}
