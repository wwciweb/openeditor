/* eslint no-unused-vars: 0 */
import AWS from 'aws-sdk';
import { success, failure } from './libs/response-lib';

const { TableName, GIT_COMMIT_SHORT: version } = process.env;
const dynamoDb = new AWS.DynamoDB.DocumentClient();

export const processChanges = async (event, context) => {
  const now = new Date().toISOString();

  const queue = [
    ...new Set(
      event.Records.reduce(
        (
          acc,
          {
            dynamodb: {
              Keys: {
                SK: { S: SK },
              },
              NewImage: { parent: { S: parent = null } = {}, duration: { N: duration = 0 } = {} },
              OldImage: { parent: { S: oldParent = null } = {}, duration: { N: oldDuration = 0 } = {} } = {},
            },
          }
        ) => {
          if (SK === 'v0_metadata') {
            // console.log(JSON.stringify({ parent, oldParent, duration, oldDuration }, null, 2));
            if (parent !== oldParent) {
              return [...acc, parent, oldParent];
            } else if (duration !== oldDuration) {
              return [...acc, parent];
            }
          }

          return acc;
        },
        []
      ).filter(PK => !!PK)
    ),
  ];

  console.log('queue:', JSON.stringify(queue, null, 2));

  const data = await Promise.all(
    queue.map(async PK => {
      const { Items } = await dynamoDb['query']({
        TableName,
        IndexName: 'parent-index',
        KeyConditionExpression: 'parent = :parent',
        ExpressionAttributeValues: {
          ':parent': PK,
        },
        FilterExpression: 'attribute_not_exists(deleted)',
      }).promise();

      const { duration, count, updatedAt } = Items.reduce(
        (acc, { RowType, duration = 0, count = 1, updatedAt }) => ({
          // count: RowType === 'transcript' ? acc.count + 1 : acc.count + count,
          count: acc.count + count,
          duration: acc.duration + duration,
          updatedAt: updatedAt ? [...acc.updatedAt, updatedAt] : acc.updatedAt,
        }),
        { duration: 0, count: 0, updatedAt: [] }
      );

      return dynamoDb['update']({
        TableName,
        Key: { PK, SK: 'v0_metadata' },
        UpdateExpression:
          updatedAt.length > 0 ? 'SET #c = :count, #d = :duration, #u = :updatedAt' : 'SET #c = :count, #d = :duration',
        ExpressionAttributeNames: {
          '#c': 'count',
          '#d': 'duration',
          ...(updatedAt.length > 0 && { '#u': 'updatedAt' }),
        },
        ExpressionAttributeValues: {
          ':count': count,
          ':duration': duration,
          ...(updatedAt.length > 0 && { ':updatedAt': updatedAt.sort((a, b) => new Date(a) - new Date(b)).pop() }),
        },
        ReturnValues: 'ALL_NEW',
      }).promise();
    })
  );

  // console.log('Update:', JSON.stringify(data, null, 2));

  return `processed ${event.Records.length} records => ${queue.length} updates`;
};

export const recompute = async (event, context) => {
  const { PK } = event.pathParameters;
  const queue = [PK];
  const now = new Date().toISOString();

  try {
    const result = await Promise.all(
      queue.map(async PK => {
        const { Items } = await dynamoDb['query']({
          TableName,
          IndexName: 'parent-index',
          KeyConditionExpression: 'parent = :parent',
          ExpressionAttributeValues: {
            ':parent': PK,
          },
          FilterExpression: 'attribute_not_exists(deleted)',
        }).promise();

        const { duration, count, updatedAt } = Items.reduce(
          (acc, { RowType, duration = 0, count = 1, updatedAt }) => ({
            // count: RowType === 'transcript' ? acc.count + 1 : acc.count + count,
            count: acc.count + count,
            duration: acc.duration + duration,
            updatedAt: updatedAt ? [...acc.updatedAt, updatedAt] : acc.updatedAt,
          }),
          { duration: 0, count: 0, updatedAt: [] }
        );

        return dynamoDb['update']({
          TableName,
          Key: { PK, SK: 'v0_metadata' },
          UpdateExpression: `SET #c = :count, #d = :duration, #u = :updatedAt`,
          ExpressionAttributeNames: {
            '#c': 'count',
            '#d': 'duration',
            '#u': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':count': count,
            ':duration': duration,
            ':updatedAt': updatedAt.length > 0 ? updatedAt.sort((a, b) => new Date(a) - new Date(b)).pop() : now,
          },
          ReturnValues: 'ALL_NEW',
        }).promise();
      })
    );

    return result
      ? success({ data: result, version, debug: { queue } })
      : failure({ data: null, version, debug: { queue } });
  } catch (error) {
    return failure({ data: null, errors: [error], version, debug: { queue } });
  }
};
