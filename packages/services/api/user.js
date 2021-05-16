import AWS from 'aws-sdk';
import bs58 from 'bs58';
// import toBuffer from 'typedarray-to-buffer';
// import uuidv4 from 'uuid/v4';
import uuidv5 from 'uuid/v5';

import { success, failure } from './libs/response-lib';

const { TableName, GIT_COMMIT_SHORT: version } = process.env;
const dynamoDb = new AWS.DynamoDB.DocumentClient();
const cognito = new AWS.CognitoIdentityServiceProvider({ region: 'us-east-2' });

// const generateId = () => {
//   const buffer = Buffer.alloc(16);
//   uuidv4(null, buffer);
//   return bs58.encode(buffer);
// };

export const computeId = (name, namespace) => {
  const buffer = new Buffer(16);
  let ns = namespace;
  try {
    ns = Array.from(bs58.decode(namespace));
  } catch (ignored) {}
  uuidv5(name, ns, buffer);
  return bs58.encode(buffer);
};

// // FIXME: DEPRECATED
// export async function getAll(event, context) {
//   const params = {
//     UserPoolId: 'us-east-2_ncMdqbsr4', // FIXME: pass via query parameter
//     // Filter: `sub = "${sub}"`,
//     // Limit: 1,
//   };

//   try {
//     const data = await cognito.listUsers(params).promise();

//     // await Promise.all(
//     //   data.Users.map(async ({ Username: sub, Attributes }) => {
//     //     let { Item } = await dynamoDb['get']({
//     //       TableName,
//     //       Key: { PK: sub, SK: 'v0_metadata' },
//     //     }).promise();

//     //     if (!Item) {
//     //       const now = new Date().toISOString();

//     //       const name = Attributes.find(({ Name }) => Name === 'name').Value;
//     //       const email = Attributes.find(({ Name }) => Name === 'email').Value;

//     //       Item = {
//     //         PK: sub,
//     //         SK: 'v0_metadata',
//     //         RowType: 'user',
//     //         RowVersion: 0,
//     //         createdAt: now,
//     //         updatedAt: now,
//     //         name,
//     //         email,
//     //         // lastLogin: now,
//     //       };

//     //       return dynamoDb['put']({ TableName, Item }).promise();
//     //     }
//     //   })
//     // );

//     return success({ data, version, debug: { params } });
//   } catch (error) {
//     return failure({ data: null, errors: [error], version, debug: { params } });
//   }
// }

// FIXME: DEPRECATED
export async function get(event, context) {
  const { sub } = event.pathParameters;

  const params = {
    UserPoolId: 'us-east-2_ncMdqbsr4', // FIXME: pass via query parameter
    Filter: `sub = "${sub}"`,
    Limit: 1,
  };

  try {
    const data = await cognito.listUsers(params).promise();
    return success({ data, version, debug: { params } });
  } catch (error) {
    return failure({ data: null, errors: [error], version, debug: { params } });
  }
}

// Cognito Post Authentication
export const postAuth = async (event, context, callback) => {
  const now = new Date().toISOString();
  // console.log(JSON.stringify(event, null, 2));

  const {
    request: {
      userAttributes: { sub, name, email },
    },
  } = event;

  const {
    Item = {
      PK: sub,
      SK: 'v0_metadata',
      RowType: 'user',
      RowVersion: 0,
      createdAt: now,
      updatedAt: now,
      name,
      email,
      lastLogin: now,
    },
  } = await dynamoDb['get']({
    TableName,
    Key: { PK: sub, SK: 'v0_metadata' },
  }).promise();

  Item.lastLogin = now;

  if (name !== Item.name || email !== Item.email) {
    Item.name = name;
    Item.email = email;
    Item.updatedAt = now;
  }

  await dynamoDb['put']({ TableName, Item }).promise();

  callback(null, event);
};

// GET all users
export const users = async (event, context) => {
  const params = {
    TableName,
    IndexName: 'RowType-index',
    KeyConditionExpression: 'RowType = :rowType',
    ExpressionAttributeValues: {
      ':rowType': 'user',
    },
  };

  try {
    const result = await dynamoDb['query'](params).promise();

    // // TEMPORARY
    // const now = new Date().toISOString();
    // const test = await Promise.all(
    //   result.Items.map(async ({ PK }) => {
    //     const { Item } = await dynamoDb['get']({
    //       TableName,
    //       Key: { PK, SK: 'v0_projects' },
    //     }).promise();

    //     if (Item) {
    //       return Promise.all(
    //         Item.projects.map(p => {
    //           const params = {
    //             TableName,
    //             Item: {
    //               PK: p,
    //               SK: `v0_user:${Item.PK}`,
    //               RowType: 'project-user',
    //               RowVersion: 0,
    //               createdAt: now,
    //               updatedAt: now,
    //             },
    //             // ConditionExpression: 'attribute_not_exists(PK) and attribute_not_exists(SK)',
    //           };

    //           return dynamoDb['put'](params).promise();
    //         })
    //       );
    //     }

    //     // return dynamoDb['get']({
    //     //   TableName,
    //     //   Key: { PK, SK: 'v0_projects' },
    //     // }).promise();
    //   })
    // );

    return success({ data: result, version, debug: { params } });
  } catch (error) {
    return failure({ data: null, errors: [error], version, debug: { params } });
  }
};

// GET user
export const user = async (event, context) => {
  const { sub } = event.pathParameters;
  const now = new Date().toISOString();

  try {
    let { Item } = await dynamoDb['get']({
      TableName,
      Key: { PK: sub, SK: 'v0_metadata' },
    }).promise();

    // FIXME: TEMPORARY
    if (!Item) {
      const params = {
        UserPoolId: 'us-east-2_ncMdqbsr4', // FIXME: pass via query parameter
        Filter: `sub = "${sub}"`,
        Limit: 1,
      };

      const { Users } = await cognito.listUsers(params).promise();
      const name = Users[0].Attributes.find(({ Name }) => Name === 'name').Value;
      const email = Users[0].Attributes.find(({ Name }) => Name === 'email').Value;

      Item = {
        PK: sub,
        SK: 'v0_metadata',
        RowType: 'user',
        RowVersion: 0,
        createdAt: now,
        updatedAt: now,
        name,
        email,
        // lastLogin: now,
      };

      await dynamoDb['put']({ TableName, Item }).promise();
    }

    return success({ data: Item, version });
  } catch (error) {
    return failure({ data: null, errors: [error], version });
  }
};

// projectID + v0_user:userID
export const projectUsers = async (event, context) => {
  const { PK } = event.pathParameters;

  const params = {
    TableName,
    KeyConditionExpression: 'PK = :PK and begins_with(SK, :SK)',
    ExpressionAttributeValues: { ':PK': PK, ':SK': 'v0_user:' },
  };

  // TODO: populate user array

  try {
    const { Items: data } = await dynamoDb['query'](params).promise();

    return success({ data, version, debug: { params } });
  } catch (error) {
    return failure({ data: null, errors: [error], version, debug: { params } });
  }
};

export const userProjects = async (event, context) => {
  const { sub } = event.pathParameters;

  const params = {
    TableName,
    IndexName: 'SK-index',
    KeyConditionExpression: 'SK = :SK',
    ExpressionAttributeValues: { ':SK': `v0_user:${sub}` },
  };

  try {
    const { Items } = await dynamoDb['query'](params).promise();

    const data = await Promise.all(
      Items.map(({ PK }) =>
        dynamoDb['get']({
          TableName,
          Key: { PK, SK: 'v0_metadata' },
        }).promise()
      )
    );

    return success({ data, version, debug: { params } });
  } catch (error) {
    return failure({ data: null, errors: [error], version, debug: { params } });
  }
};

export const joinProject = async ({ pathParameters, body, requestContext }, context) => {
  const { sub } = pathParameters;
  const { project: PK } = JSON.parse(body);

  const now = new Date().toISOString();
  const username = requestContext.identity.cognitoAuthenticationProvider.split(':').pop();

  const SK = `v0_user:${sub}`;

  const params = {
    TableName,
    Item: {
      PK,
      SK,
      RowType: 'project-user',
      RowVersion: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: username,
      updatedBy: username,
    },
    ConditionExpression: 'attribute_not_exists(PK) and attribute_not_exists(SK)',
  };

  try {
    const data = await dynamoDb['put'](params).promise();

    // make it project
    const project = await dynamoDb['update']({
      TableName,
      Key: { PK, SK: 'v0_metadata' },
      UpdateExpression: `SET updatedAt = :now, updatedBy = :username, RowType = :rowType`,
      ExpressionAttributeValues: {
        ':now': now,
        ':username': username,
        ':rowType': 'project',
      },
      ReturnValues: 'ALL_NEW',
    }).promise();

    return success({ data, version, debug: { params, project } });
  } catch (error) {
    return failure({ data: null, errors: [error], version, debug: { params } });
  }
};

export const leaveProject = async ({ pathParameters, body, requestContext }, context) => {
  const { sub } = pathParameters;
  const { project: PK } = JSON.parse(body);

  const params = { TableName, Key: { PK, SK: `v0_user:${sub}` } };

  try {
    await dynamoDb['delete'](params).promise();

    return success({ data: null, version, debug: { params } });
  } catch (error) {
    return failure({ data: null, errors: [error], version, debug: { params } });
  }
};

export async function projects(event, context) {
  const { sub } = event.pathParameters;

  const params = {
    TableName,
    Key: { PK: sub, SK: 'v0_projects' },
  };

  try {
    const { Item = {} } = await dynamoDb['get'](params).promise();
    const { projects = [] } = Item;

    // default project, FIXME: environment
    // if (!projects.includes('WSfgTYHNC4KWP99jKZFdvR')) projects.push('WSfgTYHNC4KWP99jKZFdvR');

    const data = (
      await Promise.all(
        projects.map(
          p =>
            new Promise((resolve, reject) =>
              dynamoDb['get'](
                {
                  TableName,
                  Key: { PK: p, SK: 'v0_metadata' },
                },
                (error, project) => {
                  resolve(error ? null : project);
                }
              )
            )
        )
      )
    )
      .filter(p => !!p)
      .map(({ Item: { PK: id, abbr, title, color, backgroundColor } }) => ({
        id,
        // abbr,
        title,
        // style: { color, backgroundColor },
      }));

    data.push({
      id: computeId('PERSONAL', sub),
      title: 'Scratchpad',
      type: 'private',
    });

    return success({ data, version, debug: { params } });
  } catch (error) {
    console.log(error);
    return failure({ data: null, errors: [error], version, debug: { params } });
  }
}

export async function add2project({ pathParameters, body, requestContext }, context) {
  const { sub } = pathParameters;
  const { project } = JSON.parse(body);
  const now = new Date().toISOString();
  const username = requestContext.identity.cognitoAuthenticationProvider.split(':').pop();

  const { Item = {} } = await dynamoDb['get']({
    TableName,
    Key: { PK: sub, SK: 'v0_projects' },
  }).promise();

  // console.log({ Item });
  const { projects = [] } = Item;

  if (!projects.includes(project)) {
    projects.push(project);

    const params = {
      TableName,
      Key: { PK: sub, SK: 'v0_projects' },
      UpdateExpression: `SET updatedAt = :now, updatedBy = :username, projects = :projects`,
      ExpressionAttributeValues: {
        ':now': now,
        ':username': username,
        ':projects': projects,
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

  return success({ data: projects, version });
}
