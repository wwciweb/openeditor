import AWS from 'aws-sdk';
import https from 'https';

import { success, failure } from './libs/response-lib';

const { TableName, GIT_COMMIT_SHORT: version } = process.env;
const dynamoDb = new AWS.DynamoDB.DocumentClient({
  httpOptions: {
    agent: new https.Agent({ keepAlive: true }),
  },
});

const childrenPromise = (parent, noLeafs = false) => {
  const params = {
    TableName,
    IndexName: 'parent-index',
    KeyConditionExpression: 'parent = :parent',
    FilterExpression: noLeafs ? 'SK = :SK and RowType <> :RowType' : 'SK = :SK',
    ProjectionExpression: 'PK, title, updatedBy, updatedAt, createdAt, createdBy, #d, #c, #s, message, RowType',
    ExpressionAttributeNames: {
      '#d': 'duration',
      '#c': 'count',
      '#s': 'status',
    },
    ExpressionAttributeValues: {
      ':parent': parent,
      ':SK': 'v0_metadata',
      ...(noLeafs && { ':RowType': 'transcript' }),
    },
  };

  return dynamoDb['query'](params).promise();
};

const traverseTree = async (parent, noLeafs) => {
  const { PK } = parent;

  const { Items = [] } = await childrenPromise(PK, noLeafs);
  const children = await Promise.all(Items.map(item => traverseTree(item, noLeafs)));

  return { ...parent, ...(children.length > 0 && { children }) };
};

export const tree = async (event, context) => {
  const { PK } = event.pathParameters;

  try {
    const data = await traverseTree({ PK }, true);

    return success({ data, version });
  } catch (error) {
    return failure({ data: null, errors: [error], version });
  }
};

export const children = async (event, context) => {
  const { PK } = event.pathParameters;

  try {
    const result = await childrenPromise(PK);

    return result.Items ? success({ data: result.Items, version }) : failure({ data: null, version });
  } catch (error) {
    return failure({ data: null, errors: [error], version });
  }
};

export const breadcrumbs = async (event, context) => {
  const { PK } = event.pathParameters;

  try {
    const data = [];
    let parent = PK;

    while (parent) {
      const { Item = {} } = await dynamoDb['get']({
        TableName,
        Key: { PK: parent, SK: 'v0_metadata' },
        ProjectionExpression: 'PK, parent, title, RowType',
      }).promise();

      parent = Item.parent;
      data.push(Item);
    }

    return success({ data, version });
  } catch (error) {
    return failure({ data: null, errors: [error], version });
  }
};
