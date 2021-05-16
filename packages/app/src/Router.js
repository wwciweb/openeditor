import React from 'react';
import { BrowserRouter as Router, Route } from 'react-router-dom';
import Amplify from 'aws-amplify';
import { withAuthenticator } from 'aws-amplify-react';

import App from './App';
import Editor from './Editor';

import openEditorStack from './openeditor-stack.json';
import openEditorStorage from './openeditor-storage-stack.json';
import openEditorAuth from './openeditor-auth-stack.json';

// import './index.css';

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

export default withAuthenticator(
  ({ authState, authData }) => (
    <Router>
      <div>
        <Route path="/:project?/:parent?" exact render={props => <App {...{ authState, authData, ...props }} />} />
        <Route
          path="/:project/:parent/:transcript"
          render={props => <Editor {...{ authState, authData, ...props }} />}
        />
      </div>
    </Router>
  ),
  {
    usernameAttributes: 'email',
    signUpConfig: {
      header: 'My Customized Sign Up',
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
