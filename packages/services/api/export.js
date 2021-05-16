import AWS from 'aws-sdk';
import { success, failure, notFound } from './libs/response-lib';

const { TableName, GIT_COMMIT_SHORT: version } = process.env;
const dynamoDb = new AWS.DynamoDB.DocumentClient();

export const transcripts = async (event, context) => {
  const { parent } = event.queryStringParameters;

  const params = {
    TableName,
    IndexName: 'parent-index',
    KeyConditionExpression: 'parent = :parent',
    ExpressionAttributeValues: {
      ':parent': parent,
    },
    FilterExpression: 'attribute_not_exists(deleted)',
  };

  try {
    const result = await dynamoDb['query'](params).promise();

    const data = result.Items.filter(({ status }) => status === 'aligned').map(
      ({ PK: id, title, duration, src, createdAt, updatedAt }) => ({
        id,
        fid: title.split(' ').map(t => parseInt(t)).filter(t => !isNaN(t)).reverse().pop(),
        title,
        duration,
        src,
        createdAt,
        updatedAt,
      })
    );

    return success({ data, version, debug: { params } });
  } catch (error) {
    return failure({ data: null, errors: [error], version, debug: { params } });
  }
};

export const transcript = async (event, context) => {
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

    const [{ title, duration, src, blocks = [] }] = transcriptItems;

    const { Items: blockItems } = await dynamoDb['query']({
      TableName,
      KeyConditionExpression: 'PK = :PK and begins_with(SK, :SK)',
      ExpressionAttributeValues: { ':PK': PK, ':SK': 'v0_block:' },
    }).promise();

    const content = blocks.map(key => blockItems.find(({ SK }) => SK === `v0_block:${key}`));
    const paragraphs = content.map(({ start, end, speaker }) => ({ start: start / 1e3, end: end / 1e3, speaker }));
    const words = content.reduce((acc, { text, speaker, starts, ends, offsets, lengths }) => {
      // const words = starts.map((start, i) => ({
      //   start: start / 1e3,
      //   end: ends[i] / 1e3,
      //   text: text.substring(offsets[i], offsets[i] + lengths[i]),
      // }));

      const words = text.split(' ').reduce((acc, token) => {
        const word = {
          offset: acc.length > 0 ? acc.map(({ text }) => text).join(' ').length + 1 : 0,
          length: token.length,
          text: token,
        };

        const i = offsets ? offsets.findIndex(j => j >= word.offset) : -1;
        word.index = i;

        if (i !== -1) {
          word.start = starts[i] / 1e3;
          word.end = ends[i] / 1e3;
        }

        delete word.offset;
        delete word.length;
        delete word.index;

        return [...acc, word];
      }, []);

      // return [...acc, { text: speaker }, { text: ':' }, ...words];
      return [...acc, ...words];
    }, []);

    const data = {
      id: PK,
      fid: title.split(' ').map(t => parseInt(t)).filter(t => !isNaN(t)).reverse().pop(),
      title,
      src,
      duration,
      content: {
        words,
        paragraphs,
        // speakers: [],
      },
    };

    return success({ data, version });
  } catch (error) {
    return failure({ data: null, errors: [error], version });
  }
};
