import AWS from 'aws-sdk';
import bs58 from 'bs58';
// import toBuffer from 'typedarray-to-buffer';
import uuidv4 from 'uuid/v4';

import { success, notFound, failure } from './libs/response-lib';

const { TableName, GIT_COMMIT_SHORT: version } = process.env;
const dynamoDb = new AWS.DynamoDB.DocumentClient();

const generateId = () => {
  const buffer = Buffer.alloc(16);
  uuidv4(null, buffer);
  return bs58.encode(buffer);
};

export const get = async (event, context) => {
  try {
    const { PK } = event.pathParameters;

    const { Items: transcriptItems } = await dynamoDb['query']({
      TableName,
      KeyConditionExpression: 'PK = :PK and SK = :SK',
      ExpressionAttributeValues: { ':PK': PK, ':SK': 'v0_metadata' },
      FilterExpression: 'attribute_not_exists(deleted)',
    }).promise();

    if (!transcriptItems || transcriptItems.length === 0)
      return notFound({ data: { title: '404 Not Found', status: 404 } });

    const [
      { title, createdAt, updatedAt, duration, language, src, status, blocks = [], changes = null },
    ] = transcriptItems;

    const { Items: blockItems } = await dynamoDb['query']({
      TableName,
      KeyConditionExpression: 'PK = :PK and begins_with(SK, :SK)',
      ExpressionAttributeValues: { ':PK': PK, ':SK': 'v0_block:' },
    }).promise();

    const data = {
      title,
      createdAt,
      updatedAt,
      duration,
      language,
      src,
      status,
      blocks: blocks.map(key => blockItems.find(({ SK }) => SK === `v0_block:${key}`)),
      changes,
    };

    return success({ data, version });
  } catch (error) {
    return failure({ data: null, errors: [error], version });
  }
};

export const put = async (event, context) => {
  try {
    const { PK } = event.pathParameters;
    const { blocks, changes } = JSON.parse(event.body);

    const now = new Date().toISOString();
    const username = event.requestContext.identity.cognitoAuthenticationProvider.split(':').pop();

    return success({
      data: [
        await Promise.all(
          changes
            .map(({ key, status = 'edited', ...attributes }) => ({
              PK,
              SK: `v0_block:${key}`,
              RowVersion: 0, // FIXME
              RowType: 'block',
              key,
              createdAt: now,
              updatedAt: now,
              createdBy: username,
              updatedBy: username,
              status,
              ...attributes,
            }))
            .map(Item => dynamoDb['put']({ TableName, Item }).promise())
        ),
        await dynamoDb['update']({
          TableName,
          Key: { PK, SK: 'v0_metadata' },
          UpdateExpression: `SET updatedAt = :now, updatedBy = :username, blocks = :blocks, changes = :changes, #s = :status`,
          ExpressionAttributeNames: {
            '#s': 'status',
          },
          ExpressionAttributeValues: {
            // RowVersion + 1
            ':now': now,
            ':username': username,
            ':status': 'edited', // FIXME corrected
            ':blocks': blocks,
            ':changes': changes.map(({ key }) => key),
          },
          ReturnValues: 'ALL_NEW',
        }).promise(),
      ],
      version,
    });
  } catch (error) {
    return failure({ data: null, errors: [error], version });
  }
};

export const duplicate = async (event, context) => {
  try {
    const { PK } = event.pathParameters;

    const now = new Date().toISOString();
    const username = event.requestContext.identity.cognitoAuthenticationProvider.split(':').pop();

    const { Items: transcriptItems } = await dynamoDb['query']({
      TableName,
      KeyConditionExpression: 'PK = :PK and SK = :SK',
      ExpressionAttributeValues: { ':PK': PK, ':SK': 'v0_metadata' },
      FilterExpression: 'attribute_not_exists(deleted)',
    }).promise();

    if (!transcriptItems || transcriptItems.length === 0)
      return notFound({ data: { title: '404 Not Found', status: 404 } });

    const [transcriptItem] = transcriptItems;

    transcriptItem.PK = generateId();
    transcriptItem.updatedAt = now;
    transcriptItem.updatedBy = username;
    transcriptItem.title = `${transcriptItem.title} (duplicate)`;
    // transcriptItem.copyOf ???

    const { Items: blockItems } = await dynamoDb['query']({
      TableName,
      KeyConditionExpression: 'PK = :PK and begins_with(SK, :SK)',
      ExpressionAttributeValues: { ':PK': PK, ':SK': 'v0_block:' },
    }).promise();

    return success({
      data: {
        PK: transcriptItem.PK,
        results: [
          await Promise.all(
            blockItems.map(Item => {
              Item.PK = transcriptItem.PK;
              return dynamoDb['put']({ TableName, Item }).promise();
            })
          ),
          await dynamoDb['put']({ TableName, Item: transcriptItem }).promise(),
        ],
      },
      version,
    });
  } catch (error) {
    return failure({ data: null, errors: [error], version });
  }
};

export const reparagraph = async (event, context) => {
  try {
    const { PK } = event.pathParameters;

    const now = new Date().toISOString();
    const username = event.requestContext.identity.cognitoAuthenticationProvider.split(':').pop();

    const { Items: transcriptItems } = await dynamoDb['query']({
      TableName,
      KeyConditionExpression: 'PK = :PK and SK = :SK',
      ExpressionAttributeValues: { ':PK': PK, ':SK': 'v0_metadata' },
      FilterExpression: 'attribute_not_exists(deleted)',
    }).promise();

    if (!transcriptItems || transcriptItems.length === 0)
      return notFound({ data: { title: '404 Not Found', status: 404 } });

    const [transcriptItem] = transcriptItems;

    transcriptItem.PK = generateId();
    transcriptItem.updatedAt = now;
    transcriptItem.updatedBy = username;
    transcriptItem.title = `${transcriptItem.title} (reparagraphed)`;
    // transcriptItem.copyOf ???

    const { Items: blockItems } = await dynamoDb['query']({
      TableName,
      KeyConditionExpression: 'PK = :PK and begins_with(SK, :SK)',
      ExpressionAttributeValues: { ':PK': PK, ':SK': 'v0_block:' },
    }).promise();

    const blocks = transcriptItem.blocks.map(key => blockItems.find(({ SK }) => SK === `v0_block:${key}`)).reduce((acc, block) => {
      if (acc.length === 0) return [block];

      const pBlock = acc.pop();

      if (pBlock.speaker === block.speaker) {
        pBlock.end = block.end;
        const pOffset = pBlock.text.length;
        pBlock.text += ` ${block.text}`;
        pBlock.keys = pBlock.keys.concat(block.keys);
        // pBlock.starts.splice(pBlock.starts.length, 0, ...block.starts);
        pBlock.starts = pBlock.starts.concat(block.starts);
        // pBlock.ends.splice(pBlock.ends.length, 0, ...block.ends);
        pBlock.ends = pBlock.ends.concat(block.ends);
        // pBlock.lengths.splice(pBlock.lengths.length, 0, ...block.lengths);
        pBlock.lengths = pBlock.lengths.concat(block.lengths);
        // pBlock.offsets.splice(pBlock.offsets.length, 0, ...block.offsets.map(offset => offset + pBlock.text.length + 1));
        pBlock.offsets = pBlock.offsets.concat(block.offsets.map(offset => offset + pOffset + 1));

        return [...acc, pBlock];
      }

      return [...acc, pBlock, block];

    }, []);

    transcriptItem.blocks = blocks.map(({ SK }) => SK.substring(9));

    return success({
      data: {
        PK: transcriptItem.PK,
        transcriptItem,
        blocks,
        results: [
          await Promise.all(
            blocks.map(Item => {
              Item.PK = transcriptItem.PK;
              return dynamoDb['put']({ TableName, Item }).promise();
            })
          ),
          await dynamoDb['put']({ TableName, Item: transcriptItem }).promise(),
        ],
      },
      version,
    });
  } catch (error) {
    return failure({ data: null, errors: [error], version });
  }
};
