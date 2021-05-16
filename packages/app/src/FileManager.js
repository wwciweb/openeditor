import React from 'react';
import { Link } from 'react-router-dom';
import Timecode from 'react-timecode';
import Moment from 'react-moment';
import 'moment-timezone';
import Uppy from '@uppy/core';
// import Url from '@uppy/url';
import { StatusBar, ProgressBar, DragDrop, Dashboard, DashboardModal } from '@uppy/react';
import AwsAmplify from 'uppy-aws-amplify';
import { Storage } from 'aws-amplify';
// import XHRUpload from '@uppy/xhr-upload';
import sanitize from 'sanitize-filename';

import {
  Alert,
  message,
  Select,
  TreeSelect,
  Tree,
  Button,
  Tooltip,
  Table,
  Affix,
  Tag,
  Icon,
  Typography,
  Modal,
  Layout,
  Input,
  Radio,
} from 'antd';

import {
  newFolder,
  moveToFolder,
  moveToArchive,
  moveToTrash,
  computeId,
  newUpload,
  triggerTranscription,
  getTranscript,
  generateId,
  validateId,
  triggerTranscoding,
  getTree,
  duplicateTranscript,
  triggerAlignment,
} from './api';

// import openEditorStack from './openeditor-stack.json';
import openEditorStorage from './openeditor-storage-stack.json';

import exportTranscript from './utils/exportTranscript.js';

import UserName from './components/UserName';

import '@uppy/core/dist/style.css';
import '@uppy/dashboard/dist/style.css';
import '@uppy/url/dist/style.css';
// import '@uppy/status-bar/dist/style.css';
// import '@uppy/drag-drop/dist/style.css';

// const { Option } = Select;
const { Text } = Typography;

const { Content } = Layout;

const RadioGroup = Radio.Group;

const radioStyle = {
  display: 'block',
  height: '30px',
  lineHeight: '30px',
};

class FileManager extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      fileActionActive: false,
      selectedRows: [],
      exportValue: 1,
    };

    this.uppy = Uppy({
      id: 'uppy1',
      autoProceed: true,
      // maxNumberOfFiles: 1,
      allowMultipleUploads: false,
      debug: true,
      restrictions: {
        allowedFileTypes: ['audio/*', 'video/*', '.m4a', '.mp4', '.mp3', '.wav'],
      },
    });

    this.uppy.use(AwsAmplify, {
      storage: Storage,
      getOptions: {
        download: false,
      },
      limit: 0,
      async getUploadParameters(file) {
        console.log('getUploadParameters', file);
        return {
          filename: `media/${generateId()}/input/${sanitize(file.name)
            .replace(/ /g, '_')
            .replace(/&/g, '_')
            .replace(/\$/g, '_')
            .replace(/_+/g, '_')}`,
        };
      },
    });

    this.uppy.on('file-added', file => {
      console.log('file-added', file);
    });

    this.uppy.on('file-removed', file => {
      console.log('file-removed', file);
      // if (this.uppy.getFiles().length === 0) message.warning('upload cancelled', 3);
    });

    this.uppy.on('upload-progress', (file, progress) => {
      console.log('upload-progress', file.id, progress.bytesUploaded, progress.bytesTotal);
    });

    this.uppy.on('upload-success', async (file, response) => {
      console.log('upload-success', file, response);

      const {
        data: { PK },
      } = await newUpload(response.body.key.split('/')[1], file.name, this.props.parent, [
        this.props.storageBucket,
        response.body.key,
      ]);
      this.props.update();

      triggerTranscription(
        PK,
        this.props.storageBucket,
        `public/${response.body.key}`,
        file.extension,
        response.uploadURL
      );

      this.setState({ uploadAlert: null });
    });

    this.uppy.on('complete', result => {
      console.log('successful files:', result.successful);
      console.log('failed files:', result.failed);

      this.setState({ uploadModalVisible: false });
    });

    this.uppy.on('upload-error', (file, error, response) => {
      console.log('error with file:', file.id);
      console.log('error message:', error);
      this.setState({ uploadAlert: error.message });
    });

    this.uppy.on('cancel-all', () => {
      // console.log('cancel-all', this.uppy.getFiles());
      // message.warning('upload cancelled', 3);
      this.setState({ uploadAlert: null });
    });

    this.uppy.on('restriction-failed', (file, error) => {
      this.setState({ uploadAlert: error.message });
    });
  }

  async componentDidMount() {
    this.poll = setInterval(() => this.props.update(true), 60000);
  }

  componentWillUnmount() {
    clearInterval(this.poll);
    this.uppy.close();
  }

  shouldComponentUpdate(nextProps, nextState) {
    if (this.props.parent !== nextProps.parent) {
      this.setState({ fileActionActive: false, selectedRows: [] });
    }

    return true;
  }

  cancelUpload = () => {
    this.uppy.cancelAll();
    this.setState({ uploadModalVisible: false });
  };

  newFolderModalShow = () => {
    this.setState({
      newFolderModalVisible: true,
    });
  };

  newFolderHandleOk = async e => {
    this.setState({
      newFolderLoading: true,
    });

    await newFolder(this.state.newFolder, this.props.parent);
    this.props.update();

    this.setState({
      newFolderModalVisible: false,
      newFolderLoading: false,
    });
  };

  urlHandleOk = async e => {
    this.setState({
      urlLoading: true,
    });

    const url = new URL(this.state.url);
    const name = url.pathname.split('/').pop();

    const {
      data: { PK },
    } = await newUpload(generateId(), name, this.props.parent, [url.href]);
    this.props.update();

    // const extension = url.pathname
    //   .split('/')
    //   .pop()
    //   .split('.')
    //   .pop();

    // (PK, storageBucket, key, extension, fileUri)
    triggerTranscoding(
      PK,
      // openEditorStorage.StorageBucketName,
      // `public/${PK}.${extension}`,
      // `public/media/${PK}/input/${sanitize(name).replace(/ /g, '_')}`,
      // extension,
      url.href
      // true
    );

    this.props.update();

    this.setState({
      urlModalVisible: false,
      urlLoading: false,
    });
  };

  moveToFolderModalShow = async () => {
    this.setState({
      moveToFolderModalVisible: true,
    });

    const translate = item => {
      item.children && item.children.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      return {
        ...item,
        title: (
          <>
            <Icon type="folder" theme="twoTone" twoToneColor="#eb2f96" style={{ fontSize: '24px' }} />
            <Text> {item ? item.title : item}</Text>
          </>
        ),
        key: item.PK,
        value: item.PK,
        ...(item.children && { children: item.children.map(child => translate(child)) }),
      };
    };

    const treeData = translate((await getTree(this.props.project)).data).children;

    this.setState({
      treeData,
    });
  };

  moveToFolderHandleOk = async () => {
    this.setState({
      moveToFolderLoading: true,
    });

    await Promise.all(this.state.selectedRows.map(({ key }) => moveToFolder(key, this.state.moveToFolder)));
    this.props.update();

    this.setState({
      moveToFolderLoading: false,
      moveToFolderModalVisible: false,
    });
  };

  exportFilesModalShow = () => {
    this.setState({
      exportFilesModalVisible: true,
    });
  };

  exportFilesHandleOk = async () => {
    const transcripts = await Promise.all(
      this.state.selectedRows.filter(({ type }) => type === 'transcript').map(({ key }) => getTranscript(key))
    );

    transcripts.forEach(({ data: { title, blocks } }) =>
      exportTranscript('', title, '', blocks, this.state.exportValue)
    );

    this.setState({ exportFilesModalVisible: false });
  };

  exportFilesOnChange = e => {
    console.log('export modal radio checked', e.target.value);
    this.setState({
      exportValue: e.target.value,
    });
  };

  realign = async () => {
    const transcripts = await Promise.all(
      this.state.selectedRows
        .filter(({ type }) => type === 'transcript')
        .map(async ({ key }) => {
          const {
            data: { PK },
          } = await duplicateTranscript(key);
          return triggerAlignment(PK);
        })
    );

    console.log(transcripts);
  };

  sendToArchiveModalShow = () => {
    this.setState({
      sendToArchiveModalVisible: true,
    });
  };

  sendToArchiveHandleOk = async () => {
    this.setState({
      sendToArchiveLoading: true,
    });

    await Promise.all(this.state.selectedRows.map(({ key }) => moveToArchive(key, this.props.project)));
    this.props.update();

    this.setState({
      sendToArchiveLoading: false,
      sendToArchiveModalVisible: false,
    });
  };

  sendToTrashModalShow = () => {
    this.setState({
      sendToTrashModalVisible: true,
    });
  };

  sendToTrashHandleOk = async () => {
    this.setState({
      sendToTrashLoading: true,
    });

    await Promise.all(this.state.selectedRows.map(({ key }) => moveToTrash(key, this.props.project)));
    this.props.update();

    this.setState({
      sendToTrashLoading: false,
      sendToTrashModalVisible: false,
    });
  };

  updateValue = ({ nativeEvent }) => {
    const { name, value } = nativeEvent.srcElement;
    this.setState({ [name]: value });
  };

  columns = () => [
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      width: '33%',
      onCell: () => {
        return {
          style: {
            maxWidth: 150,
          },
        };
      },
      render: (title, record) => {
        switch (record.type) {
          case 'transcript':
            return (
              <span>
                <Link to={`/${this.props.match.params.project}/${this.props.match.params.parent}/${record.key}`}>
                  <Text>{title}</Text>
                </Link>
              </span>
            );
          case 'folder':
            return (
              <span>
                <Link to={`/${this.props.match.params.project}/${record.key}`}>
                  <Icon type="folder" theme="twoTone" style={{ fontSize: '24px' }} />
                  <Text> {title}</Text>
                </Link>
              </span>
            );
          case 'project':
            return (
              <span>
                <Link to={`/${this.props.match.params.project}/${record.key}`}>
                  <Icon type="folder" theme="twoTone" twoToneColor="#ff1880" style={{ fontSize: '24px' }} />
                  <Text> {title}</Text>
                </Link>
              </span>
            );
          case 'archive': // FIXME
            return (
              <span>
                <Icon type="hdd" theme="twoTone" style={{ fontSize: '24px' }} /> <Text>Archive</Text>
              </span>
            );
          case 'trash': // FIXME
            return (
              <span>
                <Icon type="delete" theme="twoTone" style={{ fontSize: '24px' }} /> <Text>Trash</Text>
              </span>
            );
          default:
            return <span>Error Unknown</span>;
        }
      },
      sorter: (a, b) => {
        if (a.title === 'TRASH' || b.title === 'TRASH') return 0;
        if (a.title === 'ARCHIVE' || b.title === 'ARCHIVE') return 0;
        return a.title.localeCompare(b.title);
      },
    },
    {
      title: 'Items',
      dataIndex: 'count',
      key: 'count',
      align: 'right',
      render: count => (count > 0 ? count : ''),
      sorter: (a, b) => a.count - b.count,
    },
    {
      title: 'Duration',
      dataIndex: 'duration',
      key: 'duration',
      align: 'right',
      render: duration => <Timecode className="timecode" time={duration * 1e3} />,
      sorter: (a, b) => a.duration - b.duration,
    },
    {
      title: (
        <span>
          Last modified <small>(ago)</small>
        </span>
      ),
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      // width: '128px',
      align: 'right',
      render: (updatedAt, record) => (
        <span
          title={new Date(updatedAt).toLocaleString()}
          className={
            new Date().getTime() - new Date(updatedAt).getTime() < 5 * 6 * 1e4 && record.updatedBy !== this.props.user
              ? 'editing'
              : null
          }
        >
          <Moment fromNow ago>
            {updatedAt}
          </Moment>
        </span>
      ),
      defaultSortOrder: 'descend',
      sorter: (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
    },
    {
      title: 'by',
      dataIndex: 'updatedBy',
      key: 'updatedBy',
      render: updatedBy => (true ? <UserName user={updatedBy} /> : null),
    },
    {
      title: (
        <span>
          Added <small>(ago)</small>
        </span>
      ),
      dataIndex: 'createdAt',
      key: 'createdAt',
      // width: '128px',
      align: 'right',
      render: createdAt => (
        <span title={new Date(createdAt).toLocaleString()}>
          <Moment fromNow ago>
            {createdAt}
          </Moment>
        </span>
      ),
      sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    },
    {
      title: 'by',
      dataIndex: 'createdBy',
      key: 'createdBy',
      render: createdBy => (true ? <UserName user={createdBy} /> : null),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      // width: '160px',
      render: (status, { message }) => {
        let tagColor = '';
        switch (status) {
          case 'aligning':
            tagColor = 'gold';
            break;
          case 'uploaded':
            tagColor = 'yellow';
            break;
          case 'transcribing':
            tagColor = 'magenta';
            break;
          case 'transcribed':
            tagColor = 'orange';
            break;
          case 'error':
            tagColor = '#f5222d';
            break;
          case 'corrected':
            tagColor = 'green';
            break;
          case 'in use':
            tagColor = 'magenta';
            break;
          default:
            tagColor = 'blue';
        }
        if (status === 'project' || status === 'folder' || status === 'archive' || status === 'trash') {
          return null;
        } else if (message) {
          return (
            <Tooltip placement="topLeft" title={message} arrowPointAtCenter>
              <Tag color={tagColor}>{status}</Tag>
            </Tooltip>
          );
        } else {
          return <Tag color={tagColor}>{status}</Tag>;
        }
      },
      filters: [
        { text: 'transcribing', value: 'transcribing' },
        { text: 'transcribed', value: 'transcribed' },
        { text: 'corrected', value: 'corrected' },
        { text: 'aligning', value: 'aligning' },
        // { text: 'in use', value: 'in use' },
      ],
      filterMultiple: true,
      onFilter: (value, record) => record.status === value,
    },
  ];

  render() {
    const { loading, data, folders, project, parent } = this.props;

    const rowSelection = {
      onChange: (selectedRowKeys, selectedRows) => {
        console.log(`selectedRowKeys: ${selectedRowKeys}`, 'selectedRows: ', selectedRows);
        if (selectedRows.length > 0) {
          this.setState({
            fileActionActive: true,
            selectedRows,
          });
        } else {
          this.setState({
            fileActionActive: false,
            selectedRows: [],
          });
        }
      },
      getCheckboxProps: record => ({
        // disabled: record.type === 'folder', // Column configuration not to be checked
        type: record.type,
      }),
    };

    return (
      <Content
        style={{
          background: '#fff',
        }}
      >
        <Table
          rowSelection={rowSelection}
          dataSource={data}
          columns={this.columns()}
          pagination={{
            pageSize: 20,
            itemRender: (page, type, element) =>
              type !== 'next' ? (
                element
              ) : (
                <>
                  {element}
                  <Link to={`/${project}/${computeId('ARCHIVE', project)}`}>
                    <Button icon="hdd" type="link" size="small" />
                  </Link>
                  <Link to={`/${project}/${computeId('TRASH', project)}`}>
                    <Button icon="delete" type="link" size="small" />
                  </Link>
                </>
              ),
          }}
          size="small"
          loading={data && !loading ? false : { indicator: <Icon type="loading" style={{ fontSize: 24 }} spin /> }}
        />
        <Modal
          destroyOnClose
          title="New Folder"
          visible={this.state.newFolderModalVisible}
          onOk={this.newFolderHandleOk}
          confirmLoading={this.state.newFolderLoading}
          onCancel={() => this.setState({ newFolderModalVisible: false })}
        >
          <Input
            name="newFolder"
            placeholder="New folder name"
            value={this.state.newFolder}
            onChange={e => this.updateValue(e)}
          />
        </Modal>

        <Modal
          destroyOnClose
          title="Import URL"
          visible={this.state.urlModalVisible}
          onOk={this.urlHandleOk}
          confirmLoading={this.state.urlLoading}
          onCancel={() => this.setState({ urlModalVisible: false })}
        >
          <Input name="url" placeholder="URL" value={this.state.url} onChange={e => this.updateValue(e)} />
        </Modal>

        <Modal
          destroyOnClose
          title="Move to Folder"
          visible={this.state.moveToFolderModalVisible}
          onOk={this.moveToFolderHandleOk}
          confirmLoading={this.state.moveToFolderLoading}
          onCancel={() => this.setState({ moveToFolderModalVisible: false })}
        >
          {' '}
          {this.state.treeData ? (
            <TreeSelect
              style={{ width: 300 }}
              value={this.state.moveToFolder}
              dropdownStyle={{ maxHeight: 400, overflow: 'auto' }}
              treeData={this.state.treeData}
              placeholder="select folder"
              onChange={moveToFolder => this.setState({ moveToFolder })}
            />
          ) : (
            <Icon type="loading" style={{ fontSize: 24 }} spin />
          )}
        </Modal>

        <Modal
          destroyOnClose
          title="Export transcripts"
          visible={this.state.exportFilesModalVisible}
          onOk={this.exportFilesHandleOk}
          onCancel={() => this.setState({ exportFilesModalVisible: false })}
        >
          <p>Select format:</p>
          <RadioGroup onChange={this.exportFilesOnChange} value={this.state.exportValue}>
            <Radio style={radioStyle} value={0}>
              {' '}
              Text Document
            </Radio>
            <Radio style={radioStyle} value={1}>
              {' '}
              Word Document
            </Radio>
            <Radio style={radioStyle} value={1.5}>
              {' '}
              Word Document (without timecodes)
            </Radio>
            <Radio style={radioStyle} value={2}>
              {' '}
              JSON Format (contains timings and other meta data)
            </Radio>
            <Radio style={radioStyle} value={3} disabled>
              {' '}
              Interactive Transcript
            </Radio>
          </RadioGroup>
        </Modal>

        <Modal
          destroyOnClose
          title="Please confirm archive?"
          okText="Yes"
          cancelText="No"
          visible={this.state.sendToArchiveModalVisible}
          onOk={this.sendToArchiveHandleOk}
          confirmLoading={this.state.sendToArchiveLoading}
          onCancel={() => this.setState({ sendToArchiveModalVisible: false })}
        >
          Note : you can unarchive later.
        </Modal>

        <Modal
          destroyOnClose
          title="Are you sure you want to delete?"
          okText="Yes"
          okType="danger"
          cancelText="No"
          visible={this.state.sendToTrashModalVisible}
          onOk={this.sendToTrashHandleOk}
          confirmLoading={this.state.sendToTrashLoading}
          onCancel={() => this.setState({ sendToTrashModalVisible: false })}
        >
          Note : this action cannot be undone.
        </Modal>

        <DashboardModal
          uppy={this.uppy}
          // closeModalOnClickOutside
          open={this.state.uploadModalVisible}
          onRequestClose={this.cancelUpload}
          plugins={['Url']}
        />

        {/* <Modal
          destroyOnClose
          maskClosable={false}
          footer={null}
          title="Upload Media"
          visible={this.state.uploadModalVisible}
          onOk={this.uploadModalHandleOk}
          confirmLoading={this.state.uploadModalLoading}
          onCancel={this.cancelUpload}
        >
          <Dashboard uppy={this.uppy} note="Media files only, ideally m4a or mp4" />
          {this.state.uploadAlert ? (
            <Alert
              message={this.state.uploadAlert}
              type="warning"
              closable
              onClose={() => this.setState({ uploadAlert: null })}
            />
          ) : null}
        </Modal> */}

        <Affix className="controls-holder" offsetBottom={1} type="flex" align="right">
          <div>
            <Tooltip placement="topLeft" title="Upload" arrowPointAtCenter>
              <Button
                className="action-button"
                type="primary"
                shape="circle"
                icon="cloud-upload"
                size="large"
                onClick={() => this.setState({ uploadModalVisible: true })}
              />
            </Tooltip>

            <Tooltip placement="topLeft" title="Import URL" arrowPointAtCenter>
              <Button
                className="action-button"
                type="primary"
                shape="circle"
                icon="link"
                size="large"
                disabled={true}
                onClick={() => this.setState({ urlModalVisible: true })}
              />
            </Tooltip>

            <Tooltip placement="topLeft" title="New Folder" arrowPointAtCenter>
              <Button
                className="action-button"
                type="primary"
                shape="circle"
                icon="folder-add"
                size="large"
                // disabled={this.props.project !== this.props.parent}
                onClick={() => this.setState({ newFolderModalVisible: true })}
              />
            </Tooltip>

            <Tooltip placement="topLeft" title="Move to Folder" arrowPointAtCenter>
              <Button
                className="action-button"
                type="primary"
                shape="circle"
                icon="menu-unfold"
                size="large"
                disabled={!this.state.fileActionActive}
                // disabled={true}
                onClick={this.moveToFolderModalShow}
              />
            </Tooltip>

            <Tooltip placement="topLeft" title="Export" arrowPointAtCenter>
              <Button
                className="action-button"
                type="primary"
                shape="circle"
                icon="export"
                size="large"
                disabled={!this.state.fileActionActive}
                // disabled={true}
                onClick={this.exportFilesModalShow}
              />
            </Tooltip>

            <Tooltip placement="topLeft" title="Realign" arrowPointAtCenter>
              <Button
                className="action-button"
                type="primary"
                shape="circle"
                icon="swap"
                size="large"
                disabled={!this.state.fileActionActive}
                // disabled={true}
                onClick={this.realign}
              />
            </Tooltip>

            <Tooltip placement="topLeft" title="Archive" arrowPointAtCenter>
              <Button
                className="action-button"
                type="primary"
                shape="circle"
                icon="hdd"
                size="large"
                disabled={!this.state.fileActionActive}
                onClick={this.sendToArchiveModalShow}
              />
            </Tooltip>

            <Tooltip placement="topLeft" title="Delete" arrowPointAtCenter>
              <Button
                className="action-button"
                type="primary"
                shape="circle"
                icon="delete"
                size="large"
                disabled={!this.state.fileActionActive}
                // style={{ marginLeft: 4 }}
                onClick={this.sendToTrashModalShow}
              />
            </Tooltip>
          </div>
        </Affix>
      </Content>
    );
  }
}

export default FileManager;
