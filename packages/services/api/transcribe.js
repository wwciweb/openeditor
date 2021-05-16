/* eslint no-unused-vars: 0 */
import AWS from 'aws-sdk';
import { success, failure } from './libs/response-lib';
import shortid from 'shortid';
import bs58 from 'bs58';
import uuidv4 from 'uuid/v4';
import axios from 'axios';
import tempWrite from 'temp-write';
import fs from 'fs';
import tempy from 'tempy';
import stream from 'stream';

AWS.config.update({ region: 'us-east-2' });

const {
  TableName,
  MediaConvertAPI,
  MediaConvertQueue,
  MediaConvertRole,
  MediaBucket,
  TaskSubnet,
  GIT_COMMIT_SHORT: version,
} = process.env;
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const transcribeService = new AWS.TranscribeService();
const s3 = new AWS.S3();
const ecs = new AWS.ECS();

const mediaConvert = new AWS.MediaConvert({
  endpoint: MediaConvertAPI,
});

const collisions = {};
const generateID = () => {
  let id = null;
  do {
    id = shortid.generate();
  } while (!id.match(/^[a-z]([0-9]|[a-z])+([0-9a-z]+)[a-z]$/i) || collisions[id]);

  collisions[id] = true;
  return id;
};

const generatePK = () => {
  const buffer = Buffer.alloc(16);
  uuidv4(null, buffer);
  return bs58.encode(buffer);
};

export async function transcoded(event, context) {
  const now = new Date().toISOString();
  console.log(JSON.stringify(event));

  await Promise.all(
    event.Records.reduce((acc, { body }) => [...acc, ...JSON.parse(body).Records], [])
      .filter(
        ({ eventName }) => eventName === 'ObjectCreated:CompleteMultipartUpload' || eventName === 'ObjectCreated:Put'
      )
      .map(
        async ({
          s3: {
            object: { key },
            bucket: { name: Bucket },
          },
        }) => {
          const [PK] = key.split('/').slice(-3, -2);

          try {
            await dynamoDb['update']({
              TableName,
              Key: { PK, SK: 'v0_metadata' },
              UpdateExpression: `SET updatedAt = :now, #src = :src, #s = :status`,
              ExpressionAttributeNames: {
                '#s': 'status',
                '#src': 'src',
              },
              ExpressionAttributeValues: {
                ':now': now,
                ':status': 'transcoded',
                ':src': [Bucket, key.replace(/^public\//, '')],
              },
              ReturnValues: 'ALL_NEW',
            }).promise();

            const jobName = `${PK}-transcription`;
            const extension = 'm4a';

            const params = {
              LanguageCode: 'en-US',
              Media: {
                MediaFileUri: `https://${Bucket}.s3.us-east-2.amazonaws.com/${key}`, //TODO fix URL generation
              },
              MediaFormat: extension === 'm4a' ? 'mp4' : extension,
              TranscriptionJobName: jobName,
              OutputBucketName: Bucket,
              Settings: {
                ShowSpeakerLabels: true,
                MaxSpeakerLabels: 3,
              },
            };

            const data = await transcribeService.startTranscriptionJob(params).promise();
            console.log(JSON.stringify(data));

            return dynamoDb['update']({
              TableName,
              Key: { PK, SK: 'v0_metadata' },
              UpdateExpression: `SET updatedAt = :now, #s = :status`,
              ExpressionAttributeNames: {
                '#s': 'status',
              },
              ExpressionAttributeValues: {
                ':now': now,
                ':status': 'transcribing',
              },
              ReturnValues: 'ALL_NEW',
            }).promise();
          } catch (error) {
            console.log(error);
            return dynamoDb['update']({
              TableName,
              Key: { PK, SK: 'v0_metadata' },
              UpdateExpression: `SET updatedAt = :now, #s = :status, message = :message`,
              ExpressionAttributeNames: {
                '#s': 'status',
              },
              ExpressionAttributeValues: {
                ':now': now,
                ':status': 'error',
                ':message': error.message,
              },
              ReturnValues: 'ALL_NEW',
            }).promise();
          }
        }
      )
  );
}

export async function transcribed(event, context) {
  const now = new Date().toISOString();
  console.log(JSON.stringify(event));

  await Promise.all(
    event.Records.reduce((acc, { body }) => [...acc, ...JSON.parse(body).Records], [])
      .filter(
        ({ eventName }) => eventName === 'ObjectCreated:CompleteMultipartUpload' || eventName === 'ObjectCreated:Put'
      )
      .map(
        async ({
          s3: {
            object: { key },
            bucket: { name: Bucket },
          },
        }) => {
          const [PK] = key.split('-');

          try {
            const transcription = (
              await s3
                .getObject({
                  Bucket,
                  Key: decodeURIComponent(key),
                })
                .promise()
            ).Body.toString('utf-8');

            await s3
              .copyObject({
                CopySource: `${Bucket}/${decodeURIComponent(key)}`,
                Bucket,
                Key: `public/media/${PK}/output/transcript/transcription.json`,
              })
              .promise();

            const {
              results: {
                transcripts: [transcript],
                speaker_labels: { segments },
                items,
              },
            } = JSON.parse(transcription);

            const words = items
              .reduce((acc, { start_time, end_time, alternatives: [{ content: text }], type }, i) => {
                const prev = acc.pop();

                if (type === 'punctuation' && prev) {
                  prev.text += text;
                  prev.length = prev.text.length;
                  return [...acc, prev];
                }

                return [
                  ...acc,
                  prev,
                  {
                    key: generateID(),
                    text,
                    start: parseFloat(start_time) * 1e3,
                    end: parseFloat(end_time) * 1e3,
                    offset: prev ? prev.offset + prev.length + 1 : 0,
                    length: text.length, // + (i === items.length - 1 ? 0 : 1),
                  },
                ];
              }, [])
              .filter(word => !!word);

            const blocks = segments.map(({ start_time, speaker_label: speaker, end_time }) => {
              const key = generateID();
              const start = parseFloat(start_time) * 1e3;
              const end = parseFloat(end_time) * 1e3;

              const entityData = {};
              words
                .filter(({ start: s, end: e }) => start <= s && s < end && start < e && e <= end)
                .forEach(word =>
                  Object.keys(word).forEach(key =>
                    entityData[key] ? entityData[key].push(word[key]) : (entityData[key] = [word[key]])
                  )
                );

              const { start: starts, end: ends, offset: offsets, length: lengths, key: keys, text: texts } = entityData;
              const offset = offsets[0];

              return {
                PK,
                SK: `v0_block:${key}`,
                RowVersion: 0,
                RowType: 'block',
                key,
                start,
                end,
                speaker,
                text: texts.join(' '),
                starts,
                ends,
                offsets: offsets.map(o => o - offset),
                lengths,
                keys,
                status: 'transcribed',
                createdAt: now,
                updatedAt: now,
              };
            });

            await Promise.all(blocks.map(Item => dynamoDb['put']({ TableName, Item }).promise()));

            const duration = blocks.length === 0 ? 0 : (blocks[blocks.length - 1].end - blocks[0].start) / 1e3;

            return dynamoDb['update']({
              TableName,
              Key: { PK, SK: 'v0_metadata' },
              UpdateExpression: `SET updatedAt = :now, blocks = :blocks, #d = :duration, #s = :status`,
              ExpressionAttributeNames: {
                '#s': 'status',
                '#d': 'duration',
              },
              ExpressionAttributeValues: {
                ':now': now,
                ':blocks': blocks.map(({ key }) => key),
                ':duration': duration,
                ':status': 'transcribed',
              },
              ReturnValues: 'ALL_NEW',
            }).promise();
          } catch (error) {
            console.log(error);
            return dynamoDb['update']({
              TableName,
              Key: { PK, SK: 'v0_metadata' },
              UpdateExpression: `SET updatedAt = :now, #s = :status, message = :message`,
              ExpressionAttributeNames: {
                '#s': 'status',
              },
              ExpressionAttributeValues: {
                ':now': now,
                ':status': 'error',
                ':message': error.message,
              },
              ReturnValues: 'ALL_NEW',
            }).promise();
          }
        }
      )
  );
}

export async function transcribe(event, context) {
  let { PK, storageBucket, key, extension, fileUri, download } = JSON.parse(event.body);
  return await transcode(
    {
      // body: JSON.stringify({ PK, fileUri: `https://${storageBucket}.s3.us-east-2.amazonaws.com/${key}` }),
      body: JSON.stringify({ PK, fileUri: `s3://${storageBucket}/${key}` }),
    },
    context
  );
}

export async function align(event, context) {
  const { PK } = JSON.parse(event.body);
  const now = new Date().toISOString();

  try {
    const { Items: transcriptItems } = await dynamoDb['query']({
      TableName,
      KeyConditionExpression: 'PK = :PK and SK = :SK',
      ExpressionAttributeValues: { ':PK': PK, ':SK': 'v0_metadata' },
      FilterExpression: 'attribute_not_exists(deleted)',
    }).promise();

    const [
      {
        blocks = [],
        src: [namespace, key],
      },
    ] = transcriptItems;

    const { Items: blockItems } = await dynamoDb['query']({
      TableName,
      KeyConditionExpression: 'PK = :PK and begins_with(SK, :SK)',
      ExpressionAttributeValues: { ':PK': PK, ':SK': 'v0_block:' },
    }).promise();

    const text = blocks
      .map(key => blockItems.find(({ SK }) => SK === `v0_block:${key}`))
      .map(({ text }) => text)
      .join('\n\n');

    await s3
      .putObject({
        Bucket: MediaBucket,
        Key: `public/media/${PK}/input/${new Date(now).getTime()}-transcript.txt`,
        ContentType: 'text/plain; charset=utf-8',
        Body: text,
      })
      .promise();

    const params = {
      cluster: `OpenEditor`,
      launchType: 'FARGATE',
      taskDefinition: `gentle`,
      count: 1,
      platformVersion: 'LATEST',
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: [TaskSubnet],
          assignPublicIp: 'ENABLED',
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: `gentle`,
            environment: [
              {
                name: 'INPUT_MEDIA_S3_BUCKET',
                value: namespace === 'm-nc9x4fbvxfm4jhb9' ? 'm-nc9x4fbvxfm4jhb9' : MediaBucket,
              },
              {
                name: 'INPUT_MEDIA_S3_KEY',
                value: namespace === 'm-nc9x4fbvxfm4jhb9' ? key : `public/${key}`,
              },
              {
                name: 'INPUT_TRANSCRIPT_S3_BUCKET',
                value: MediaBucket,
              },
              {
                name: 'INPUT_TRANSCRIPT_S3_KEY',
                value: `public/media/${PK}/input/${new Date(now).getTime()}-transcript.txt`,
              },
              {
                name: 'OUTPUT_S3_BUCKET',
                value: MediaBucket,
              },
              {
                name: 'OUTPUT_S3_KEY',
                value: `public/media/${PK}/output/alignment/${new Date(now).getTime()}-align.json`,
              },
            ],
          },
        ],
      },
    };

    const data = await ecs.runTask(params).promise();

    await dynamoDb['update']({
      TableName,
      Key: { PK, SK: 'v0_metadata' },
      UpdateExpression: `SET updatedAt = :now, #s = :status`,
      ExpressionAttributeNames: {
        '#s': 'status',
      },
      ExpressionAttributeValues: {
        ':now': now,
        ':status': 'aligning',
      },
      ReturnValues: 'ALL_NEW',
    }).promise();

    return success({ data, version, debug: { params } });
  } catch (error) {
    await dynamoDb['update']({
      TableName,
      Key: { PK, SK: 'v0_metadata' },
      UpdateExpression: `SET updatedAt = :now, #s = :status, message = :message`,
      ExpressionAttributeNames: {
        '#s': 'status',
      },
      ExpressionAttributeValues: {
        ':now': now,
        ':status': 'error',
        ':message': error.message,
      },
      ReturnValues: 'ALL_NEW',
    }).promise();

    return failure({ data: null, errors: [error], version });
  }
}

export async function aligned(event, context) {
  const now = new Date().toISOString();

  await Promise.all(
    event.Records.reduce((acc, { body }) => [...acc, ...JSON.parse(body).Records], [])
      .filter(
        ({ eventName }) => eventName === 'ObjectCreated:CompleteMultipartUpload' || eventName === 'ObjectCreated:Put'
      )
      .map(
        async ({
          s3: {
            object: { key },
            bucket: { name: Bucket },
          },
        }) => {
          let PK = key.split('/')[2];
          console.log({ PK, key });

          try {
            const { Items: transcriptItems } = await dynamoDb['query']({
              TableName,
              KeyConditionExpression: 'PK = :PK and SK = :SK',
              ExpressionAttributeValues: { ':PK': PK, ':SK': 'v0_metadata' },
              FilterExpression: 'attribute_not_exists(deleted)',
            }).promise();

            const [{ blocks = [] }] = transcriptItems;

            const { Items: blockItems } = await dynamoDb['query']({
              TableName,
              KeyConditionExpression: 'PK = :PK and begins_with(SK, :SK)',
              ExpressionAttributeValues: { ':PK': PK, ':SK': 'v0_block:' },
            }).promise();

            const alignment = (
              await s3
                .getObject({
                  Bucket,
                  Key: decodeURIComponent(key),
                })
                .promise()
            ).Body.toString('utf-8');

            const { transcript, words } = JSON.parse(alignment);

            const paragraphs = transcript.split('\n\n');

            // PK = generatePK();

            // console.log({ PK, p: paragraphs.length });

            const updates = blocks
              .map(key => blockItems.find(({ SK }) => SK === `v0_block:${key}`))
              .map((block, index) => {
                if (paragraphs[index] === block.text) {
                  const offset = index === 0 ? 0 : paragraphs.slice(0, index).join('\n\n').length + 2;
                  const length = offset + block.text.length;

                  const entityData = {};
                  words
                    .filter(({ case: c }) => c === 'success')
                    .filter(({ startOffset, endOffset }) => offset <= startOffset && endOffset <= length)
                    .map(({ startOffset, endOffset, start, end, word: text }) => ({
                      start: Math.floor(start * 1e3),
                      end: Math.floor(end * 1e3),
                      offset: startOffset - offset,
                      length: endOffset - startOffset,
                      key: generateID(),
                      text,
                    }))
                    .map((word, index, words) => {
                      if (block.text.charAt(word.offset + word.length) !== ' ') {
                        word.length += 1;
                      }
                      return word;
                    })
                    .reduce((acc, word, index, words) => {
                      const pword = acc.pop();

                      if (pword && word.offset > pword.offset + pword.length + 1) {
                        // untimed interval in middle
                        return [
                          ...acc,
                          pword,
                          {
                            start: pword.end,
                            end: word.start,
                            offset: pword.offset + pword.length + 1,
                            length: word.offset - 1 - (pword.offset + pword.length + 1),
                            key: generateID(),
                          },
                          word,
                        ];
                      } else if (pword && index === words.length - 1 && word.offset + word.length < block.text.length) {
                        // untimed interval at the end
                        return [
                          ...acc,
                          pword,
                          word,
                          {
                            start: word.end,
                            end: word.end,
                            offset: word.offset + word.length + 1,
                            length: block.text.length - (word.offset + word.length + 1),
                            key: generateID(),
                          },
                        ];
                      } else if (pword) {
                        return [...acc, pword, word];
                      } else if (!pword && word.offset > 0) {
                        // untimed interval at the beginning
                        return [
                          ...acc,
                          {
                            start: word.start,
                            end: word.start,
                            offset: 0,
                            length: word.offset - 1,
                            key: generateID(),
                          },
                          word,
                        ];
                      }

                      return [...acc, word];
                    }, [])
                    .forEach(word =>
                      Object.keys(word).forEach(key =>
                        entityData[key] ? entityData[key].push(word[key]) : (entityData[key] = [word[key]])
                      )
                    );

                  const {
                    start: starts = [],
                    end: ends = [],
                    offset: offsets = [],
                    length: lengths = [],
                    key: keys = [],
                    // text: texts,
                  } = entityData;

                  block.starts = starts;
                  block.ends = ends;
                  block.offsets = offsets;
                  block.lengths = lengths;
                  block.keys = keys;
                  block.start = starts.length > 0 ? starts[0] : 0;
                  block.end = ends.length > 0 ? ends[ends.length - 1] : 0;
                  block.status = 'aligned';
                }

                block.PK = PK;
                return block;
              })
              .map((block, index, blocks) => {
                if (block.start === 0 && block.end === 0) {
                  block.start = index > 0 ? blocks[index - 1].end : 0;
                  block.end = index < blocks.length - 1 ? blocks[index + 1].start : block.start;

                  block.starts = [block.start];
                  block.ends = [block.end];
                  block.offsets = [0];
                  block.lengths = block.text.length;
                  block.keys = [generateID()];
                }

                return block;
              });

            console.log('s3', `${key}-test.json`);

            await s3
              .putObject({
                Bucket: MediaBucket,
                Key: `${key}-test.json`,
                ContentType: 'text/plain; charset=utf-8',
                Body: JSON.stringify(updates, null, 2),
              })
              .promise();

            await Promise.all(updates.map(Item => dynamoDb['put']({ TableName, Item }).promise()));

            // const [Item] = transcriptItems;
            // Item.PK = PK;
            // Item.title = `${Item.title} (${Date.now()})`;
            // Item.status = 'aligned';
            // await dynamoDb['put']({ TableName, Item }).promise();

            await dynamoDb['update']({
              TableName,
              Key: { PK, SK: 'v0_metadata' },
              UpdateExpression: `SET updatedAt = :now, blocks = :blocks, #s = :status`,
              ExpressionAttributeNames: {
                '#s': 'status',
              },
              ExpressionAttributeValues: {
                ':now': now,
                ':blocks': updates.map(({ key }) => key),
                ':status': 'aligned',
              },
              ReturnValues: 'NONE',
            }).promise();
          } catch (error) {
            console.log(error);
            await dynamoDb['update']({
              TableName,
              Key: { PK, SK: 'v0_metadata' },
              UpdateExpression: `SET updatedAt = :now, #s = :status, message = :message`,
              ExpressionAttributeNames: {
                '#s': 'status',
              },
              ExpressionAttributeValues: {
                ':now': now,
                ':status': 'error',
                ':message': error.message,
              },
              ReturnValues: 'NONE',
            }).promise();
          }
        }
      )
  );
}

export async function transcode(event, context) {
  let { PK, storageBucket, key, fileUri } = JSON.parse(event.body);
  const now = new Date().toISOString();
  const jobName = `${PK}-transcription`;

  const params = {
    Queue: MediaConvertQueue,
    UserMetadata: {},
    Role: MediaConvertRole,
    Settings: {
      OutputGroups: [
        {
          Name: 'File Group',
          Outputs: [
            {
              ContainerSettings: {
                Container: 'MP4',
                Mp4Settings: {
                  CslgAtom: 'INCLUDE',
                  FreeSpaceBox: 'EXCLUDE',
                  MoovPlacement: 'PROGRESSIVE_DOWNLOAD',
                },
              },
              AudioDescriptions: [
                {
                  AudioTypeControl: 'FOLLOW_INPUT',
                  AudioSourceName: 'Audio Selector 1',
                  CodecSettings: {
                    Codec: 'AAC',
                    AacSettings: {
                      AudioDescriptionBroadcasterMix: 'NORMAL',
                      Bitrate: 96000,
                      RateControlMode: 'CBR',
                      CodecProfile: 'LC',
                      CodingMode: 'CODING_MODE_2_0',
                      RawFormat: 'NONE',
                      SampleRate: 48000,
                      Specification: 'MPEG4',
                    },
                  },
                  LanguageCodeControl: 'FOLLOW_INPUT',
                },
              ],
              Extension: 'm4a',
              NameModifier: '-transcoded',
            },
          ],
          OutputGroupSettings: {
            Type: 'FILE_GROUP_SETTINGS',
            FileGroupSettings: {
              Destination: `s3://${MediaBucket}/public/media/${PK}/input/`,
            },
          },
        },
      ],
      AdAvailOffset: 0,
      Inputs: [
        {
          AudioSelectors: {
            'Audio Selector 1': {
              Offset: 0,
              DefaultSelection: 'DEFAULT',
              ProgramSelection: 1,
            },
          },
          FilterEnable: 'AUTO',
          PsiControl: 'USE_PSI',
          FilterStrength: 0,
          DeblockFilter: 'DISABLED',
          DenoiseFilter: 'DISABLED',
          TimecodeSource: 'EMBEDDED',
          FileInput: fileUri,
        },
      ],
    },
    AccelerationSettings: {
      Mode: 'DISABLED',
    },
    StatusUpdateInterval: 'SECONDS_60',
    // Priority: 0,
  };

  try {
    const data = await mediaConvert.createJob(params).promise();

    await dynamoDb['update']({
      TableName,
      Key: { PK, SK: 'v0_metadata' },
      UpdateExpression: `SET updatedAt = :now, #s = :status`,
      ExpressionAttributeNames: {
        '#s': 'status',
      },
      ExpressionAttributeValues: {
        ':now': now,
        ':status': 'transcoding',
      },
      ReturnValues: 'ALL_NEW',
    }).promise();

    return success({ data, version, debug: { params } });
  } catch (error) {
    await dynamoDb['update']({
      TableName,
      Key: { PK, SK: 'v0_metadata' },
      UpdateExpression: `SET updatedAt = :now, #s = :status, message = :message`,
      ExpressionAttributeNames: {
        '#s': 'status',
      },
      ExpressionAttributeValues: {
        ':now': now,
        ':status': 'error',
        ':message': error.message,
      },
      ReturnValues: 'ALL_NEW',
    }).promise();

    return failure({ data: null, errors: [error], version, debug: { params } });
  }
}
