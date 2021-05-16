# OpenEditor

An application that allows creation and correction of automated transcriptions of media. The front-end is React based using a Draft.js based editor, the backend runs on AWS as a serverless setup (AWS Lambda, DynamoDB and Fargate).

Note: this application was designed as an internal tool, users can see other users' name and email for collaboration purposes and while the front-end does not allow an user to look at projects that they are not member of, the user's authentication token and the API allows it.

## Installation

Prerequisites: a separate AWS account (as some of the permissions are rather permissive), nvm or node 12, yarn, docker and aws cli.

In `packages/services/` copy `config.sample.yml` to `config.yml` and set inside the AWS profiles to use and an unique suffix (to avoid collisions with other OpenEditor S3 buckets). Similarly in each folder under `packages/services/` copy `serverless.sample.yml` to `serverless.yml`.

In the root of the repository, be sure to run `nvm use` or use node 12 and run `yarn`.

### Create the database

In `services/database` run `./node_modules/.bin/serverless deploy -s prod`, the output should look like:

```
Serverless: Creating deployment bucket 'openeditor-prod-deployment-example'...
Serverless: Packaging service...
Serverless: Uploading CloudFormation file to S3...
Serverless: Uploading artifacts...
Serverless: Validating template...
Serverless: Creating Stack...
Serverless: Checking Stack create progress...
.....
Serverless: Stack create finished...
Service Information
service: openeditor-database
stage: prod
region: us-east-2
stack: openeditor-database-prod
resources: 1
```

The table created is `arn:aws:dynamodb:us-east-2:1234567890:table/openeditor-prod-data`.

This is a single table design (see https://www.alexdebrie.com/posts/dynamodb-single-table/), the naming is inspired by https://github.com/amzn/smoke-dynamodb

The data looks like this:

User (Partition key: user id from cognito, Sort key: `v0_metadata`):

```
{
  "PK": "b5c48b36-110c-4c34-b5b2-28315ff2e5ee",
  "SK": "v0_metadata",
  "RowType": "user",
  "RowVersion": 0,
  "name": "John",
  "email": "user@example.com",
  "lastLogin": "2021-05-15T11:22:33.337Z",
  "createdAt": "2021-05-15T11:22:33.337Z",
  "updatedAt": "2021-05-15T11:22:33.337Z"
}
```

Project (Partition key: project id, Sort key: `v0_metadata`):

```
{
  "PK": "RVFsoCrgQEe9kxCiYXs5EL",
  "SK": "v0_metadata",
  "RowType": "project",
  "RowVersion": 0,
  "title": "Project 2021-05-15T11:27:07.642Z",
  "createdAt": "2021-05-15T11:27:08.988Z",
  "createdBy": "b5c48b36-110c-4c34-b5b2-28315ff2e5ee",
  "updatedAt": "2021-05-15T11:27:10.003Z",
  "updatedBy": "b5c48b36-110c-4c34-b5b2-28315ff2e5ee"
}
```

And the relation in between is kept by entries like (Partition key: project key, Sort key: `v0_user:{user-id}`):

```
{
  "PK": "RVFsoCrgQEe9kxCiYXs5EL",
  "SK": "v0_user:b5c48b36-110c-4c34-b5b2-28315ff2e5ee",
  "RowType": "project-user",
  "RowVersion": 0,
  "createdAt": "2021-05-15T11:27:10.003Z",
  "createdBy": "b5c48b36-110c-4c34-b5b2-28315ff2e5ee",
  "updatedAt": "2021-05-15T11:27:10.003Z",
  "updatedBy": "b5c48b36-110c-4c34-b5b2-28315ff2e5ee"
}
```

Similarly a folder looks like this, where the parent is a project id or a folder id when folders are nested:

```
{
  "PK": "63LnfUpbPpoPa3WeKEbisF",
  "SK": "v0_metadata",
  "RowType": "folder",
  "RowVersion": 0,
  "parent": "WfkvmVkUQvbbbFHznko6Bq",
  "title": "Test Folder",
  "createdAt": "2021-05-15T11:34:24.539Z",
  "createdBy": "b5c48b36-110c-4c34-b5b2-28315ff2e5ee",
  "updatedAt": "2021-05-15T11:34:24.539Z",
  "updatedBy": "b5c48b36-110c-4c34-b5b2-28315ff2e5ee"
}
```

While a transcript has one metadata entry (Partition key: transcript id, Sort key: `v0_metadata`):

```
{
  "PK": "EekyyYddRiyw1gBVaeEQ1P",
  "SK": "v0_metadata",
  "RowType": "transcript",
  "RowVersion": 0,
  "parent": "ChcrRMuPQfBbr9PuaHXHXD",
  "status": "transcribed",
  "title": "test.mp4",
  "duration": 1.325,
  "blocks": [
    "WF70k8qJ7N", ...
  ],
  "src": [
    "openeditor-prod-storage-example",
    "media/EekyyYddRiyw1gBVaeEQ1P/input/file-transcoded.m4a"
  ],
  "createdAt": "2021-05-15T18:39:09.482Z",
  "createdBy": "0a023760-1db2-4552-9b47-be6e699fec4e",
  "updatedAt": "2021-05-15T18:39:43.444Z",
  "updatedBy": "0a023760-1db2-4552-9b47-be6e699fec4e"
}
```

and an entry for each block (paragraph) from the blocks list (Partition key: transcript id, Sort key: `v0_block:{block-id}`):

```
{
  "PK": "EekyyYddRiyw1gBVaeEQ1P",
  "SK": "v0_block:WF70k8qJ7N",
  "RowType": "block",
  "RowVersion": 0,
  "status": "transcribed",
  "speaker": "spk_0",
  "text": "It's a test.",
  "start": 740,
  "end": 2065,
  "ends": [
    1020,
    1140,
    2060
  ],
  "key": "WF70k8qJ7N",
  "keys": [
    "zSFxQiwqO",
    "eya0a8ma7G",
    "jiaqwX5rmj"
  ],
  "lengths": [
    4,
    1,
    5
  ],
  "offsets": [
    0,
    5,
    7
  ],
  "starts": [
    740,
    1020,
    1150
  ],
  "createdAt": "2021-05-15T18:39:43.444Z",
  "updatedAt": "2021-05-15T18:39:43.444Z"
}
```

Where `starts`, `ends`, `keys`, `offsets` and `lengths` are data for each token with that specific `offset` and `lenght` inside `text`.

### Create the storage bucket

In `services/storage` run `./node_modules/.bin/serverless deploy -s prod`, the output should look like:

```
Serverless: Using deployment bucket 'openeditor-prod-deployment-example'
Serverless: Packaging service...
Serverless: Uploading CloudFormation file to S3...
Serverless: Uploading artifacts...
Serverless: Validating template...
Serverless: Creating Stack...
Serverless: Checking Stack create progress...
.....
Serverless: Stack create finished...
Service Information
service: openeditor-storage
stage: prod
region: us-east-2
stack: openeditor-storage-prod
resources: 1
api keys:
  None
endpoints:
  None
functions:
  None
layers:
  None
Received Stack Output {
  StorageBucketName: 'openeditor-prod-storage-example',
  StorageBucketArn: 'arn:aws:s3:::openeditor-prod-storage-example',
  ServerlessDeploymentBucketName: 'openeditor-prod-deployment-example'
}
Serverless: Stack Output processed with handler: scripts/output.handler
Serverless: Stack Output saved to file: ../../app/src/openeditor-storage-stack.json
```

The S3 bucket created is `arn:aws:s3:::openeditor-prod-storage-example` and a json config for this is created for the front-end: `../../app/src/openeditor-storage-stack.json`

### Create SQS queues

Create 3 SQS queues named `openeditor-prod-transcoded`, `openeditor-prod-transcribed` and `openeditor-prod-aligned` with default visibility timeout of 15 Minutes.

### Create the API

In `services/api/config.yml` please replace `1234567890` with your account ID, such that various `arn:` identifiers defined there have the proper ID. Also set `TaskSubnet` to one of the available subnets in your default VPC.

Setup MediaConvertAPI and MediaConvertQueue in `services/api/config.yml` with the value from the AWS Console MediaConvert. For the MediaConvertRole create `mediaConvertRole` in AWS IAM with these policies: `AmazonS3FullAccess`, `AmazonAPIGatewayInvokeFullAccess` and `AWSElementalMediaConvertFullAccess`.

In AWS IAM create `ecsTaskExecutionRole` role with these policies: `AmazonS3FullAccess` and `AmazonECSTaskExecutionRolePolicy`, set `execRoleArn` in `services/api/config.yml` with the ARN of the role.

Run `./node_modules/.bin/serverless deploy -s prod`, the output should look like:

```
Serverless: Cleaning dependency symlinks
Serverless: Creating dependency symlinks
Serverless: Using deployment bucket 'openeditor-prod-deployment-example'
Serverless: Bundling with Webpack...
Serverless: Packaging service...
Serverless: Uploading CloudFormation file to S3...
Serverless: Uploading artifacts...
Serverless: Uploading service getTranscript.zip file to S3 (91.63 KB)...
........
Serverless: Uploading service create.zip file to S3 (88.68 KB)...
Serverless: Uploading service reparagraphTranscript.zip file to S3 (91.63 KB)...
Serverless: Validating template...
Serverless: Creating Stack...
Serverless: Checking Stack create progress...
........
Serverless: Stack create finished...
Service Information
service: openeditor
stage: prod
region: us-east-2
stack: openeditor-prod
resources: 100
api keys:
  prod-import: SECRET_API_KEY
endpoints:
  GET - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/transcript/{PK}
  PUT - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/transcript/{PK}
  POST - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/transcript/{PK}
  POST - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/reparagraph/{PK}
  POST - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/data
  POST - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/import
  GET - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/export
  GET - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/export/{PK}
  GET - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/data/{PK}/{SK}
  GET - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/data
  PUT - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/data/{PK}/{SK}
  GET - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/user/{sub}
  GET - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/users
  GET - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/users/{sub}
  GET - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/users/{sub}/projects
  GET - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/projects/{PK}
  GET - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/user/{sub}/projects
  POST - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/users/{sub}/projects
  POST - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/users/{sub}/projects/{PK}
  POST - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/user/{sub}/projects
  POST - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/transcribe
  POST - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/transcode
  POST - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/align
  GET - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/tree/{PK}
  GET - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/children/{PK}
  GET - https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod/breadcrumbs/{PK}
functions:
  getTranscript: openeditor-prod-getTranscript
  updateTranscript: openeditor-prod-updateTranscript
  duplicateTranscript: openeditor-prod-duplicateTranscript
  reparagraphTranscript: openeditor-prod-reparagraphTranscript
  create: openeditor-prod-create
  import: openeditor-prod-import
  exportList: openeditor-prod-exportList
  exportTranscript: openeditor-prod-exportTranscript
  get: openeditor-prod-get
  list: openeditor-prod-list
  update: openeditor-prod-update
  getUser: openeditor-prod-getUser
  postAuth: openeditor-prod-postAuth
  users: openeditor-prod-users
  user: openeditor-prod-user
  projects: openeditor-prod-projects
  projectUsers: openeditor-prod-projectUsers
  getUserProjects: openeditor-prod-getUserProjects
  joinProject: openeditor-prod-joinProject
  leaveProject: openeditor-prod-leaveProject
  addUser2Project: openeditor-prod-addUser2Project
  transcribe: openeditor-prod-transcribe
  transcode: openeditor-prod-transcode
  align: openeditor-prod-align
  tree: openeditor-prod-tree
  children: openeditor-prod-children
  breadcrumbs: openeditor-prod-breadcrumbs
  transcribed: openeditor-prod-transcribed
  transcoded: openeditor-prod-transcoded
  aligned: openeditor-prod-aligned
layers:
  None
Received Stack Output {
  ApiGatewayRestApiId: 'APIGW_ID',
  Region: 'us-east-2',
  ServiceEndpoint: 'https://APIGW_ID.execute-api.us-east-2.amazonaws.com/prod',
  ApiGatewayRestApiRootResourceId: 'APIGW_ROOT_ID',
  ServerlessDeploymentBucketName: 'openeditor-prod-deployment-example'
}
Serverless: Stack Output processed with handler: scripts/output.handler
Serverless: Stack Output saved to file: ../../app/src/openeditor-stack.json
```

This also created in the front-end `../../app/src/openeditor-stack.json`.

### Setup Authentication

In `services/auth` run `./node_modules/.bin/serverless deploy -s prod`, the output should look like:

```
Serverless: Using deployment bucket 'openeditor-prod-deployment-example'
Serverless: Packaging service...
Serverless: Uploading CloudFormation file to S3...
Serverless: Uploading artifacts...
Serverless: Validating template...
Serverless: Creating Stack...
Serverless: Checking Stack create progress...
.................
Serverless: Stack create finished...
Service Information
service: openeditor-auth
stage: prod
region: us-east-2
stack: openeditor-auth-prod
resources: 5
api keys:
  None
endpoints:
  None
functions:
  None
layers:
  None
Received Stack Output {
  UserPoolClientId: 'example',
  UserPoolId: 'us-east-2_example',
  IdentityPoolId: 'us-east-2:example',
  UserPoolArn: 'arn:aws:cognito-idp:us-east-2:1234567890:userpool/us-east-2_example',
  ServerlessDeploymentBucketName: 'openeditor-prod-deployment-example'
}
Serverless: Stack Output processed with handler: scripts/output.handler
Serverless: Stack Output saved to file: ../../app/src/openeditor-auth-stack.json

```

This also created in the front-end `../../app/src/openeditor-auth-stack.json`.

In `services/api/config.yml` uncomment lines 69-73 and set the proper ARN for the User Pool:

```
- Action:
    - cognito-idp:ListUsers
    - cognito-idp:AdminGetUser
  Resource: arn:aws:cognito-idp:us-east-2:1234567890:userpool/us-east-2_example
  Effect: Allow
```

and run `./node_modules/.bin/serverless deploy -s prod` again to update the API.

In AWS Cognito console set the Post Authentication trigger on the user pool to `openeditor-prod-postAuth`

### Run the front-end

In `app` run `yarn start` and open in browser `http://localhost:3000/`, you should see the sign in, choose to create an account.

On first login an user entry and a project will be created in the database. At this moment you can create projects and folders, uploads will work but stay in `uploaded` limbo.

### Setup S3 event notifications

On the 3 SQS queues created, edit the access policy and add (and modify queue ARN):

```
{
  "Sid": "s3-to-sqs",
  "Effect": "Allow",
  "Principal": {
    "AWS": "*"
  },
  "Action": "SQS:SendMessage",
  "Resource": "arn:aws:sqs:us-east-2:1234567890:openeditor-prod-transcoded",
  "Condition": {
    "ArnLike": {
      "aws:SourceArn": "arn:aws:s3:*:*:openeditor-prod-storage-example"
    }
  }
}
```

Setup on the already created S3 bucket, three event notifications:

- Name: `transcoded`, suffix: `-transcoded.m4a`, on all object created events; with destination SQS queue `openeditor-prod-transcoded`
- Name: `transcribed`, suffix: `-transcription.json`, on all object created events; with destination SQS queue `openeditor-prod-transcribed`
- Name: `aligned`, suffix: `-align.json`, on all object created events; with destination SQS queue `openeditor-prod-aligned`

### Setup the aligner

In AWS ECR create a repository `hyperaudio/gentle`.

Clone somewhere `https://github.com/hyperaudio/gentle` and run `git submodule init && git submodule update`

Build and push to the new ECR repository (follow the push commands provided example in AWS ECR), it should look like:

1. Retrieve an authentication token and authenticate your Docker client to your registry. Use the AWS CLI: `aws ecr get-login-password --region us-east-2 | docker login --username AWS --password-stdin 1234567890.dkr.ecr.us-east-2.amazonaws.com`

2. Build your Docker image using the following command: `docker build -t hyperaudio/gentle .` (if the build fails try increasing your docker memory)

3. After the build completes, tag your image so you can push the image to this repository: `docker tag hyperaudio/gentle:latest 1234567890.dkr.ecr.us-east-2.amazonaws.com/hyperaudio/gentle:latest`

4. Run the following command to push this image to your newly created AWS repository: `docker push 1234567890.dkr.ecr.us-east-2.amazonaws.com/hyperaudio/gentle:latest`

In AWS IAM, modify role `ecsTaskExecutionRole` trust relationships as per https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html

In AWS ECS create a Fargate cluster named `OpenEditor`, and a Fargate Task named `gentle` witn `ecsTaskExecutionRole` role and 8GB memory and 4 vCPUs, with container named `gentle` and the image from the above repository `1234567890.dkr.ecr.us-east-2.amazonaws.com/hyperaudio/gentle:latest`

### Build and deploy the front-end

In `packages/app` run `yarn build` and then deploy the `build` folder to any static hosting of choice.
