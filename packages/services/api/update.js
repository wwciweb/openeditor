/* eslint no-unused-vars: 0 */
import AWS from 'aws-sdk';
import { success, failure } from './libs/response-lib';

const { TableName, GIT_COMMIT_SHORT: version } = process.env;
const dynamoDb = new AWS.DynamoDB.DocumentClient();

export async function main(event, context) {
  const {
    PK,
    SK,
    RowType,
    // RowVersion,
    createdAt,
    updatedAt,
    createdBy,
    duration,
    updatedBy,
    language,
    src,
    status,
    count,
    __context__,
    ...payload
  } = JSON.parse(event.body);

  const now = new Date().toISOString();
  const username = event.requestContext.identity.cognitoAuthenticationProvider.split(':').pop();

  const updateExpression = Object.keys(payload)
    .map(k => `${k} = :${k}`)
    .join(', ');

  const params = {
    TableName,
    Key: { PK, SK },
    UpdateExpression: `SET updatedAt = :now, updatedBy = :username, ${updateExpression}`,
    ExpressionAttributeValues: {
      ':now': now,
      ':username': username,
      ...Object.keys(payload).reduce((acc, k) => ({ ...acc, [`:${k}`]: payload[k] }), {}),
    },
    ReturnValues: 'ALL_NEW',
  };

  try {
    const data = await dynamoDb['update'](params).promise();

    return success({ data, version, debug: { params } });
  } catch (error) {
    return failure({ data: null, errors: [error], version, debug: { params } });
  }
}
