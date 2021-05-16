import { API } from 'aws-amplify';
import moize from 'moize';
import uuidv5 from 'uuid/v5';
import uuidv4 from 'uuid/v4';
import bs58 from 'bs58';

moize.collectStats();

export const computeId = (name, namespace) => {
  const buffer = new Buffer(16);
  uuidv5(name, Array.from(bs58.decode(namespace)), buffer);
  return bs58.encode(buffer);
};

export const generateId = () => {
  const buffer = new Buffer(16);
  uuidv4(null, buffer);
  return bs58.encode(buffer);
};

export const validateId = id => {
  try {
    Array.from(bs58.decode(id));
  } catch (e) {
    return false;
  }
  return true;
};

export const GET = (path, options = {}) => API.get('ApiGatewayRestApi', path, options);
export const POST = (path, options = {}) => API.post('ApiGatewayRestApi', path, options);
export const PUT = (path, options = {}) => API.put('ApiGatewayRestApi', path, options);

export const mGET = moize(GET, {
  isPromise: true,
  isDeepEqual: true,
  maxAge: 1000 * 60 * 5, // 5 minutes
  updateExpire: true,
});

export const clearCache = () => mGET.clear();
export const cacheStats = () => console.log('cache', mGET.getStats());

// CRUD
// CREATE
// FIXME new API?
export const newUpload = (PK, title, parent, src) => {
  const body = {
    SK: 'v0_metadata',
    RowType: 'transcript',
    parent,
    title,
    src,
    status: 'uploaded',
  };

  if (validateId(PK)) body.PK = PK;
  return POST('/data', { body });
};

export const triggerTranscription = (PK, storageBucket, key, extension, fileUri, download = false) =>
  POST('/transcribe', {
    body: {
      PK,
      storageBucket,
      key,
      extension,
      fileUri,
      download,
    },
  });

export const triggerAlignment = PK => POST('/align', { body: { PK } });
window.triggerAlignment = triggerAlignment;

export const triggerTranscoding = (PK, fileUri) => POST('/transcode', { body: { PK, fileUri } });
// window.triggerTranscoding = triggerTranscoding;

export const newFolder = (title, parent) =>
  POST('/data', {
    body: {
      SK: 'v0_metadata',
      RowType: 'folder',
      parent,
      title,
    },
  });

export const newProject = async (title, user) => {
  const {
    data: { PK },
  } = await POST('/data', {
    body: {
      SK: 'v0_metadata',
      RowType: 'project',
      title,
    },
  });

  await joinProject(PK, user);

  return PK;
};

export const add2Project = (project, user) =>
  POST(`/user/${user}/projects`, {
    body: { project },
  });

export const joinProject = (project, user) => POST(`/users/${user}/projects`, { body: { project } });
export const leaveProject = (project, user) => POST(`/users/${user}/projects/${project}`, { body: { project } });

// READ
export const getProjects = async user => {
  // const { data = [] } = await GET(`/user/${user}/projects`);

  const { data: data2 } = await GET(`/users/${user}/projects`);

  // const projects = Object.entries(
  //   [...data, ...data2.map(({ PK: id, title }) => ({ id, title }))].reduce(
  //     (acc, { id, title }) => ({ ...acc, [id]: title }),
  //     {}
  //   )
  // )
  //   .map(([id, title]) => ({ id, title }))
  //   .filter(({ title }) => !!title);
  // console.log(data, data2, projects);
  const projects = data2.map(({ Item: { PK: id, title } }) => ({ id, title }));
  // console.log({ projects });

  return projects;
};

export const getUsers = async () => {
  const { data } = await GET(`/users`);

  return data;

  // return users.map(({ Attributes }) =>
  //   Attributes.reduce((acc, { Name, Value }) => {
  //     acc[Name] = Value;
  //     return acc;
  //   }, {})
  // );
};

export const projectUsers = project => GET(`/projects/${project}`);

// export const getProjects = async user => {
//   const {
//     data: { projects = [] },
//   } = await mGET(`/data/${user}/v0_projects`);

//   // magic default project
//   if (!projects.includes('WSfgTYHNC4KWP99jKZFdvR')) projects.push('WSfgTYHNC4KWP99jKZFdvR');

//   return (await Promise.all(projects.map(p => mGET(`/data/${p}/v0_metadata`)))).map(
//     ({ data: { PK: id, abbr, title, color, backgroundColor } }) => ({
//       id,
//       abbr,
//       title,
//       style: { color, backgroundColor },
//     })
//   );
// };

export const getTree = parent => GET(`/tree/${parent}`);

// export const getTree = async parent => {
//   const { data = [] } = await GET(`/tree/${parent}`);

//   const translate = item => {
//     return {
//       ...item,
//       key: item.PK,
//       value: item.PK,
//       ...(item.children && { children: item.children.map(child => translate(child)) }),
//     };
//   };

//   const root = {
//     ...translate(data),
//     title: await getTitle(parent),
//   };

//   return [root];
// };

export const getItems = async (project, parent) => {
  if (!project || !parent) return [];

  const { data = [] } = await GET(`/children/${parent}`);

  // console.log(await GET(`/breadcrumbs/${parent}`));
  // console.log(await GET(`/tree/${parent}`));

  return data.map(
    ({
      PK,
      title,
      updatedAt,
      updatedBy,
      createdAt,
      createdBy,
      RowType,
      status = 'folder',
      duration = 0,
      count = 0,
      message,
    }) => ({
      key: PK,
      title,
      updatedBy,
      updatedAt,
      createdAt,
      createdBy,
      duration,
      count,
      status,
      message,
      type: RowType,
    })
  );
};

// FIXME new API
export const getItem = id => mGET(`/data/${id}/v0_metadata`);

export const getTranscript = id => GET(`/transcript/${id}`);

// FIXME new API
export const getTitle = async id => {
  if (!id || id === 'undefined') return ' '; // FIXME
  const {
    data: { title },
  } = await getItem(id);
  return title;
};

// FIXME new API
export const getSrc = async (id, parent) => {
  const {
    data: { src },
  } = await getItem(id, parent);
  return src;
};

export const getUser = user => mGET(`/users/${user}`);

export const getUserName = async user => {
  const {
    data: { name },
  } = await getUser(user);

  return name;
};

// UPDATE
export const updateTranscript = (id, blocks, changes) => {
  clearCache();
  return PUT(`/transcript/${id}`, { body: { blocks, changes } });
};

export const duplicateTranscript = id => {
  clearCache();
  return POST(`/transcript/${id}`, { body: {} });
};
window.duplicateTranscript = duplicateTranscript;


export const reparagraphTranscript = id => {
  clearCache();
  return POST(`/reparagraph/${id}`, { body: {} });
};
window.reparagraphTranscript = reparagraphTranscript;

// export const recomputeFolder = id => {
//   clearCache();
//   return POST(`/recompute/${id}`, { body: {} });
// };
// // window.recomputeFolder = recomputeFolder;

// FIXME new API
export const updateAttributes = async (id, attributes) => {
  clearCache();
  const { data } = await getItem(id);
  delete data.count;

  return PUT(`/data/${id}/v0_metadata`, {
    body: { ...data, ...attributes },
  });
};

// FIXME new API
export const versionedUpdateAttributes = async (id, attributes) => {
  alert('disabled');
  // clearCache();
  // const {
  //   data,
  //   data: { RowVersion },
  // } = await getItem(id);

  // // create v+1
  // const { data: item } = await POST('/data', {
  //   body: {
  //     ...data,
  //     SK: `v${RowVersion + 1}_metadata`,
  //     RowVersion: RowVersion + 1,
  //     ...attributes,
  //   },
  // });

  // // update v0
  // return PUT(`/data/${id}/v0_metadata`, {
  //   body: {
  //     ...item,
  //     ...attributes,
  //     SK: `v0_parent:${parent}`,
  //   },
  // });
};

// FIXME new API
// export const updateTitle = (id, parent, title) => versionedUpdateAttributes(id, parent, { title });
export const updateTitle = (id, title) => updateAttributes(id, { title });

// export const updateTranscript = () => {};

// FIXME new API
export const moveToFolder = (id, folder) => updateAttributes(id, { parent: folder });
// export const moveToFolder = async (id, parent, folder) => {
//   clearCache();
//   const { data } = await getItem(id, parent);

//   await POST('/data', {
//     body: { ...data, SK: `v0_metadata` },
//   });

//   return await updateAttributes(id, parent, { deleted: true });
// };

// FIXME new API
export const moveToArchive = (id, project) => moveToFolder(id, computeId('ARCHIVE', project));
// FIXME new API
export const moveToTrash = (id, project) => moveToFolder(id, computeId('TRASH', project));

// export const addUserToProject = () => {};
// export const removeUserFromProject = () => {};

// DELETE
// n/a

// export const getUserName = sub => API.get('ApiGatewayRestApi', `/user/${sub}`);

// export const memoizedUserName = moize(getUserName, { isPromise: true });

// export const createNewFolder = async (title, parent) => {
//   const response = await API.post('ApiGatewayRestApi', '/data', {
//     body: {
//       SK: `v0_parent:${parent}`,
//       RowType: 'folder',
//       title,
//     },
//   });
//   console.log(response);

//   return response;
// };

// move, delete, archive
// rename

// FIXME: move to docs?

// const groups = (await Auth.currentSession()).accessToken.payload['cognito:groups'] || [];
// this.setState({
//   projects: [
//     ...this.state.projects,
//     ...groups.map(name => ({
//       name,
//       style: { color: '#f56a00', backgroundColor: '#ddddcf' },
//     })),
//   ],
// });


