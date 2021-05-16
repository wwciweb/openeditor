/* eslint no-unused-vars: 0 */
/* eslint no-unneeded-ternary: 0 */
import AWS from 'aws-sdk';
import bs58 from 'bs58';
import toBuffer from 'typedarray-to-buffer';
import uuidv4 from 'uuid/v4';

import { success, failure } from './libs/response-lib';

const { TableName, GIT_COMMIT_SHORT: version } = process.env;
const dynamoDb = new AWS.DynamoDB.DocumentClient();

const generateId = () => {
  const buffer = Buffer.alloc(16);
  uuidv4(null, buffer);
  return bs58.encode(buffer);
};

export async function main({ queryStringParameters, body, requestContext }, context) {
  const { overwrite } = queryStringParameters ? queryStringParameters : {};

  const {
    PK = generateId(),
    SK,
    RowType,
    RowVersion,
    createdAt,
    updatedAt,
    createdBy,
    updatedBy,
    ...payload
  } = JSON.parse(body);

  const now = new Date().toISOString();
  const username = requestContext.identity.cognitoAuthenticationProvider.split(':').pop();

  const Item = {
    PK,
    SK,
    RowType,
    RowVersion: RowVersion || 0,
    createdAt: createdAt || now,
    updatedAt: now,
    createdBy: createdBy || username,
    updatedBy: username,
    ...payload,
  };

  const params = {
    TableName,
    // ConditionExpression: 'attribute_not_exists(PK) and attribute_not_exists(SK)',
    Item,
  };

  if (!overwrite) params.ConditionExpression = 'attribute_not_exists(PK) and attribute_not_exists(SK)';

  try {
    await dynamoDb['put'](params).promise();

    return success({ data: Item, version, debug: { params } });
  } catch (error) {
    return failure({ data: null, errors: [error], version, debug: { params } });
  }
}
