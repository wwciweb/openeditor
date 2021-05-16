/* eslint-disable jsx-a11y/anchor-is-valid */
import React from 'react';
import { Auth } from 'aws-amplify';
import { Link } from 'react-router-dom';
import { Route } from 'react-router-dom';
import * as Sentry from '@sentry/browser';

import Timecode from 'smpte-timecode';
import {
  Modal,
  Select,
  Affix,
  Slider,
  Tag,
  Button,
  PageHeader,
  Spin,
  Icon,
  Menu,
  Dropdown,
  Layout,
  Typography,
} from 'antd';

import { getProjects, getItems, getItem, clearCache, newProject, add2Project, getUsers } from './api';
import Title from './components/Title';
import InfoDrawer from './components/InfoDrawer';

import FileManager from './FileManager';
import Editor from './Editor';

import UserName from './components/UserName';

import 'antd/dist/antd.css';
import './App.css';

const { Footer } = Layout;
// const { SubMenu } = Menu;
const { Option } = Select;
const { Text } = Typography;

Spin.setDefaultIndicator(<Icon type="loading" />);

class App extends React.Component {
  state = {
    projects: null,
    loading: true,
    data: null,
    folders: null,
    time: 0,
    playhead: 0,
    duration: 0,
    canplay: false,
    playing: false,
    src: null,
    users: [{ sub: 1111, name: 'LG', email: 'a@a.com' }],
  };

  player = React.createRef();

  async componentDidMount() {
    const {
      authData,
      match: {
        params: { project, parent, transcript },
      },
      history,
    } = this.props;

    const {
      username: user,
      attributes: { email, name: username },
    } = authData;
    console.log(authData, user);
    this.setState({ user });

    Sentry.configureScope(scope => {
      scope.setUser({ id: user, email, username });
    });

    const projects = await getProjects(user);
    this.setState({ projects });

    // defaults to 1st project
    const currentProject = project ? projects.find(({ id }) => id === project) : projects[0];
    this.setState({ currentProject });

    if (!project && currentProject) {
      history.push(`/${currentProject.id}`);
    } else if (!project) {
      // first time user, create default project
      const project = await newProject(`Default Project ${new Date().toISOString()}`, this.state.user);
      this.props.history.push(`/${project}`);
    }

    if (currentProject) this.retrieveItems(currentProject.id, parent ? parent : currentProject.id);
    transcript && this.retrieveTranscript(project, parent, transcript);
  }

  async shouldComponentUpdate(nextProps, nextState) {
    if (
      this.props.match.params.parent !== nextProps.match.params.parent ||
      this.props.match.params.project !== nextProps.match.params.project
    ) {
      const projects = await getProjects(this.state.user);
      this.setState({ projects });

      // defaults to 1st project
      const currentProject = nextProps.match.params.project
        ? projects.find(({ id }) => id === nextProps.match.params.project)
        : projects[0];
      this.setState({ currentProject });

      await this.retrieveItems(
        nextProps.match.params.project,
        nextProps.match.params.parent ? nextProps.match.params.parent : nextProps.match.params.project
      );
    }

    if (nextProps.match.params.transcript && this.props.match.params.transcript !== nextProps.match.params.transcript)
      await this.retrieveTranscript(
        nextProps.match.params.project,
        nextProps.match.params.parent,
        nextProps.match.params.transcript
      );

    if (!nextProps.match.params.transcript && this.props.match.params.transcript !== nextProps.match.params.transcript)
      this.resetPlayerState();

    if (!nextProps.match.params.transcript && this.state.src) this.resetPlayerState();

    return true;
  }

  retrieveItems = async (project, parent, silent = false) => {
    this.setState({ loading: !silent });
    const data = await getItems(project, parent);
    // const folders = silent
    //   ? this.state.folders
    //   : (project === parent ? data : await getItems(project, project)).filter(({ type }) => type === 'folder');
    this.setState({ loading: false, data /*, folders */ });
  };

  retrieveTranscript = async (project, parent = project, transcript) => {
    const {
      data: {
        status,
        updatedAt,
        updatedBy,
        src: [namespace, name],
      },
    } = await getItem(transcript, parent);
    this.setState({ src: await this.props.uriResolver(namespace, name), status, updatedAt, updatedBy });
  };

  resetPlayerState = () =>
    this.setState({
      time: 0,
      playhead: 0,
      duration: 0,
      canplay: false,
      playing: false,
      src: null,
      status: null,
    });

  update = (silent = false) => {
    const {
      match: {
        params: { project, parent = project },
      },
    } = this.props;

    clearCache();
    return this.retrieveItems(project, parent, silent);
  };

  createNewProject = async () => {
    const project = await newProject(`Project ${new Date().toISOString()}`, this.state.user);
    this.props.history.push(`/${project}`);
  };

  addUserModalShow = async () => {
    this.setState({ addUserModalVisible: true, addUserListLoading: true });
    const users = await getUsers();
    // console.log(users);
    this.setState({ users, addUserListLoading: false });
  };

  addUserHandleOk = async () => {
    this.setState({ addUserLoading: true });
    if (this.state.addUser) await add2Project(this.state.currentProject.id, this.state.addUser);
    this.setState({ addUserLoading: false, users: null, addUser: null, addUserModalVisible: false });
  };

  addUserModalHide = async () => {
    this.setState({ addUserLoading: false, users: null, addUser: null, addUserModalVisible: false });
  };

  render() {
    // cacheStats();
    const {
      projects,
      currentProject,
      loading,
      data,
      status,
      updatedAt,
      updatedBy,
      folders,
      canplay,
      playing,
      src,
      duration,
      time,
      playhead,
      disjoint,
      user,
      users,
    } = this.state;
    const {
      storageBucket,
      authState,
      authData,
      match: {
        params: { project, parent, transcript },
      },
    } = this.props;

    let title = <Spin indicator={<Icon type="loading" spin size="big" />} />;
    const routes = [];

    if (transcript) {
      routes.push({
        path: `/${project}/${parent}`,
        breadcrumbName: <Title id={parent} />,
      });

      title = <Title key={transcript} id={transcript} editable />;
    } else if (parent) {
      console.log('parent', parent);
      title = <Title key={parent} id={parent} editable />;
    } else if (currentProject) {
      console.log('currentProject', currentProject);
      title = currentProject.type === 'private' ? currentProject.title : <Title key={project} id={project} editable />;
    }

    routes.push({
      path: `/${project}`,
      breadcrumbName: currentProject ? currentProject.title : null,
    });

    routes.reverse();

    let tags = null;
    if (transcript && status) {
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
      tags = <Tag color={tagColor}>{status}</Tag>;

      // console.log(updatedAt, updatedBy);

      if (new Date().getTime() - new Date(updatedAt).getTime() < 5 * 6 * 1e4) {
        tags = (
          <Tag color={user === updatedBy ? 'blue' : '#f5222d'}>
            in use by <UserName user={updatedBy} />
          </Tag>
        );
      }
    }
    return (
      <Layout>
        <Layout>
          <Affix offsetTop={-40}>
            <PageHeader
              breadcrumb={{
                routes,
                itemRender: (route, params, routes, paths) => {
                  if (route.path === `/${project}` && projects && route.breadcrumbName)
                    return (
                      <>
                        <Link to={route.path}>{route.breadcrumbName}</Link>
                        <Dropdown
                          key={project}
                          trigger="click"
                          overlay={
                            <Menu>
                              {/* currentProject.type === 'private' ? null : (
                                <SubMenu title={currentProject.title}>
                                  <Menu.Item onClick={this.addUserModalShow}>
                                    <Icon type="user-add" /> Add User
                                  </Menu.Item>
                                </SubMenu>
                              ) */}
                              {projects
                                ? projects
                                    .filter(({ id }) => id !== project)
                                    .map(({ id, title }) => (
                                      <Menu.Item key={id}>
                                        <Link to={`/${id}`}>{title}</Link>
                                      </Menu.Item>
                                    ))
                                : null}

                              <Menu.Divider />
                              <Menu.Item onClick={this.createNewProject}>
                                <Icon type="plus-square" /> Create Project
                              </Menu.Item>
                            </Menu>
                          }
                          placement="bottomLeft"
                          className="float-right"
                        >
                          <Link to={route.path}>
                            <Icon type="down" size="large" />
                          </Link>
                        </Dropdown>
                      </>
                    );

                  return (
                    <Link key={route.path} to={route.path}>
                      {route.breadcrumbName ? (
                        route.breadcrumbName
                      ) : (
                        <Spin indicator={<Icon type="loading" spin size="small" />} />
                      )}
                    </Link>
                  );
                },
              }}
              title={
                <>
                  {transcript && (
                    <Button
                      type="primary"
                      shape="circle"
                      icon={playing ? 'pause' : 'caret-right'}
                      size="large"
                      loading={!canplay}
                      onClick={() => (playing ? this.player.current.pause() : this.player.current.play())}
                      style={{ fontSize: 16, marginRight: 10 }}
                    />
                  )}
                  {title}
                  {!transcript && (
                    <Button
                      type="link"
                      shape="round"
                      icon="info-circle"
                      size="large"
                      onClick={() => this.setState({ projectDrawerVisible: true })}
                    />
                  )}
                </>
              }
              tags={tags}
              extra={
                <Dropdown
                  overlay={
                    <Menu>
                      <Menu.Item disabled>
                        <a target="_blank" rel="noopener noreferrer" href="#" disabled>
                          <Icon type="setting" /> Preferences
                        </a>
                      </Menu.Item>
                      <Menu.Item>
                        <a rel="noopener noreferrer" href="/" onClick={() => Auth.signOut()}>
                          <Icon type="logout" /> Log Out
                        </a>
                      </Menu.Item>
                    </Menu>
                  }
                  placement="bottomRight"
                  trigger={['click']}
                  className="float-right"
                >
                  <a className="ant-dropdown-link" href="#">
                    {this.props.authData.attributes.name} <Icon type="down" size="large" />
                  </a>
                </Dropdown>
              }
              footer={
                transcript && (
                  <Slider
                    disabled={!canplay}
                    min={0}
                    max={duration}
                    value={playhead}
                    marks={{
                      [time]: '',
                      [duration]:
                        duration > 0
                          ? new Timecode(duration * 30, 30)
                              .toString()
                              .split(':')
                              .slice(0, 3)
                              .join(':')
                          : '',
                    }}
                    onChange={playhead => {
                      this.setState({ playhead, disjoint: true });
                      this.player.current.currentTime = playhead;
                    }}
                    onAfterChange={() => this.setState({ disjoint: false })}
                    tipFormatter={value =>
                      new Timecode(playhead * 30, 30)
                        .toString()
                        .split(':')
                        .slice(0, 3)
                        .join(':')
                    }
                    getTooltipPopupContainer={() => document.getElementsByClassName('toolTipContainer')[0]}
                  />
                )
              }
              style={{ backgroundColor: '#f0f2f5' }}
            ></PageHeader>
          </Affix>

          <Route
            path="/:project?/:parent?"
            exact
            render={props => (
              <FileManager
                {...{
                  storageBucket,
                  authState,
                  authData,
                  ...props,
                  project,
                  parent: parent ? parent : project,
                  update: this.update,
                  loading,
                  data,
                  folders,
                  user,
                }}
              />
            )}
          />
          <Route
            path="/:project/:parent/:transcript"
            render={props => (
              <>
                <Editor
                  {...{
                    authState,
                    authData,
                    ...props,
                    project,
                    parent: parent ? parent : project,
                    transcript,
                    player: this.player.current,
                    time,
                  }}
                />
                <div style={{ display: 'none' }}>
                  {src && (
                    <audio
                      key={transcript}
                      controls
                      preload="true"
                      ref={this.player}
                      src={src}
                      onTimeUpdate={() =>
                        this.setState({
                          time: this.player.current.currentTime,
                          [disjoint ? '_' : 'playhead']: this.player.current.currentTime,
                        })
                      }
                      onLoadedMetadata={() => this.setState({ duration: this.player.current.duration })}
                      onCanPlay={() => this.setState({ canplay: true })}
                      onPlay={() => this.setState({ playing: true })}
                      onPause={() => this.setState({ playing: false })}
                    />
                  )}
                </div>
              </>
            )}
          />

          <Footer style={{ textAlign: 'center' }}>
            <small>
              All code open source,{' '}
              <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer">
                GNU AGPL Licensed
              </a>{' '}
              and available on{' '}
              <a href="https://github.com/wwciweb/openeditor" target="_blank" rel="noopener noreferrer">
                github.com/wwciweb/openeditor
              </a>{' '}
              ©{new Date().getYear() + 1900}
            </small>
          </Footer>
          <div className="toolTipContainer"></div>
        </Layout>
        <InfoDrawer
          id={!!parent ? parent : project}
          user={user}
          visible={this.state.projectDrawerVisible}
          setVisible={projectDrawerVisible => this.setState({ projectDrawerVisible })}
        />
        <Modal
          destroyOnClose
          title="Add User"
          visible={this.state.addUserModalVisible}
          onOk={this.addUserHandleOk}
          confirmLoading={this.state.addUserLoading}
          onCancel={this.addUserModalHide}
        >
          {' '}
          {this.state.addUserListLoading || users ? (
            <Select
              placeholder="select user"
              style={{ width: 360 }}
              onChange={addUser => this.setState({ addUser })}
              loading={this.state.addUserListLoading}
            >
              {users &&
                users.map(({ sub, name, email }) => (
                  <Option key={sub} value={sub}>
                    <Icon type="user-add" theme="twoTone" style={{ fontSize: '24px' }} /> {`${name} <${email}>`}
                  </Option>
                ))}
            </Select>
          ) : null}
        </Modal>
      </Layout>
    );
  }
}

export default App;
