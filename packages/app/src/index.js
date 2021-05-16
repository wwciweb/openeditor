import React from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter as Router, Route } from 'react-router-dom';
import { RecoilRoot } from 'recoil';
import Amplify, { Storage } from 'aws-amplify';

import { withAuthenticator } from 'aws-amplify-react';
import * as Sentry from '@sentry/browser';

import App from './App';

import openEditorStack from './openeditor-stack.json';
import openEditorStorage from './openeditor-storage-stack.json';
import openEditorAuth from './openeditor-auth-stack.json';

import './index.css';

const { NODE_ENV, REACT_APP_SENTRY, REACT_APP_GIT_SHA } = process.env;
console.log(REACT_APP_SENTRY);

REACT_APP_SENTRY &&
  Sentry.init({
    dsn: REACT_APP_SENTRY,
    environment: NODE_ENV,
    release: REACT_APP_GIT_SHA && REACT_APP_GIT_SHA !== '' ? REACT_APP_GIT_SHA : 'n/a',
    maxBreadcrumbs: 16,
    // beforeSend: (event, hint) => {
    //   // console.log(event, hint);
    //   if (event.exception) {
    //     const options = {
    //       eventId: event.event_id,
    //     };

    //     if (event.user) {
    //       options.user = {
    //         name: event.user.username,
    //         email: event.user.email,
    //       };
    //     }
    //     Sentry.showReportDialog(options);
    //   }
    //   return event;
    // },
  });

Amplify.configure({
  Auth: {
    identityPoolId: openEditorAuth.IdentityPoolId,
    region: openEditorStack.Region,
    userPoolId: openEditorAuth.UserPoolId,
    userPoolWebClientId: openEditorAuth.UserPoolClientId,
  },
  API: {
    endpoints: [
      {
        name: 'ApiGatewayRestApi',
        endpoint: openEditorStack.ServiceEndpoint,
        region: openEditorStack.Region,
      },
    ],
  },
  Storage: {
    AWSS3: {
      bucket: openEditorStorage.StorageBucketName,
      region: openEditorStack.Region,
    },
  },
});

const Wrapper = withAuthenticator(
  ({ authState, authData }) => (
    <Router>
      <Route
        path="/:project?/:parent?/:transcript?"
        exact
        render={props => (
          <App
            {...{ uriResolver, authState, authData, storageBucket: openEditorStorage.StorageBucketName, ...props }}
          />
        )}
      />
    </Router>
  ),
  {
    usernameAttributes: 'email',
    signUpConfig: {
      header: 'Sign Up',
      hideAllDefaults: true,
      hiddenDefaults: ['username', 'phone_number'],
      signUpFields: [
        {
          label: 'Email',
          key: 'email',
          required: true,
          displayOrder: 1,
          type: 'string',
        },
        {
          label: 'Password',
          key: 'password',
          required: true,
          displayOrder: 2,
          type: 'password',
        },
        {
          label: 'Name',
          key: 'name',
          required: true,
          displayOrder: 3,
          type: 'string',
        },
      ],
    },
  }
);

const uriResolver = async (namespace, name) => {
  if (!name) return namespace;

  if (namespace === openEditorStorage.StorageBucketName)
    return await Storage.get(name, {
      bucket: openEditorStorage.StorageBucketName,
      download: false,
      expires: 36000, // 10h
    });

  return new URL(name, `https://${namespace}.s3.amazonaws.com`).href;
};

ReactDOM.render(<RecoilRoot><Wrapper /></RecoilRoot>, document.getElementById('root'));
// ReactDOM.render(
//   <React.StrictMode>
//     <Wrapper />
//   </React.StrictMode>,
//   document.getElementById('root')
// );
