/* eslint no-unused-vars: 0 */
import AWS from 'aws-sdk';
import { success, failure } from './libs/response-lib';

const { TableName, GIT_COMMIT_SHORT: version } = process.env;
const dynamoDb = new AWS.DynamoDB.DocumentClient();

export async function main(event, context) {
  const Items = JSON.parse(event.body);

  try {
    const data = await Promise.all(Items.map(Item => dynamoDb['put']({ TableName, Item }).promise()));

    return success({ data, version });
  } catch (error) {
    return failure({ data: null, errors: [error], version });
  }
}
