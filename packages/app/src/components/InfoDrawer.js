import React, { useState, useEffect } from 'react';
import { Select, Drawer, Button, Icon, Row, Col, Typography, List, Avatar, Spin } from 'antd';
import Timecode from 'react-timecode';

import { projectUsers, getUsers, getUser, getItem, joinProject, leaveProject, clearCache } from '../api';

const { Text } = Typography;
const { Option } = Select;

const User = ({ id, size = 'small' }) => {
  const [user, setUser] = useState(<Spin indicator={<Icon type="loading" spin size={size} />} />);

  useEffect(() => {
    const fetchData = async () => {
      const {
        data: { name, email },
      } = await getUser(id);

      setUser({ name, email });
    };

    fetchData();
  }, [id]);

  return (
    <List.Item.Meta
      avatar={<Avatar icon="user" />}
      title={user.name}
      description={<a href={`mailto:${user.email}`}>{user.email}</a>}
    />
  );
};

const InfoDrawer = ({ id, visible, setVisible, user: currentUser }) => {
  const [item, setItem] = useState();
  const [members, setMembers] = useState();
  const [users, setUsers] = useState();
  const [user, setUser] = useState();
  const [timeStamp, setTimeStamp] = useState(0);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      const { data } = await getItem(id);
      setItem(data);
    };

    visible && fetchData();
  }, [visible, id, timeStamp]);

  useEffect(() => {
    const fetchData = async () => {
      const { data } = await projectUsers(id);
      setMembers(data.map(({ SK }) => ({ key: SK.split(':').pop() })));
      setPending(false);
    };

    visible && fetchData();
  }, [visible, id, timeStamp]);

  useEffect(() => {
    const fetchData = async () => {
      const { Items } = await getUsers();
      setUsers(Items.filter(({ PK }) => !members.find(({ key }) => key === PK)));
    };

    visible && members && fetchData();
  }, [visible, members, timeStamp]);

  const addMember = async member => {
    setUser(null);
    setPending(true);
    await joinProject(id, member);
    setTimeStamp(Date.now());
  };

  const removeMember = async member => {
    setPending(true);
    await leaveProject(id, member);
    setTimeStamp(Date.now());
  };

  const convertToProject = async () => {
    setPending(true);
    await joinProject(id, currentUser);
    clearCache();
    setTimeStamp(Date.now());
  };

  return (
    <Drawer
      width={'50%'}
      placement="right"
      closable={true}
      onClose={() => setVisible(false)}
      visible={visible}
      destroyOnClose
    >
      <Typography.Title level={4}>{item?.title ?? <Spin />}</Typography.Title>
      <Row>
        <Col span={12}>Type: {item?.RowType}</Col>
        <Col span={12}>
          ID:{' '}
          <Text copyable className="monospace">
            {id}
          </Text>
        </Col>
      </Row>
      <Row style={{ marginBottom: '2em' }}>
        <Col span={12}>Items: {item?.count}</Col>
        <Col span={12}>
          Duration: <Timecode className="timecode" time={item?.duration * 1e3} />
        </Col>
      </Row>
      {item?.RowType === 'project' ? (
        <List
          loading={!members || pending}
          header={<div>Members</div>}
          footer={
            <>
              <Select
                placeholder="select user"
                style={{ width: 360 }}
                onChange={selected => setUser(selected)}
                loading={!users}
              >
                {users &&
                  users.map(({ PK, name, email }) => (
                    <Option key={PK} value={PK}>
                      {`${name} <${email}>`}
                    </Option>
                  ))}
              </Select>
              <Button type="link" size="small" disabled={!user} onClick={() => addMember(user)}>
                <Icon type="user-add" /> Add
              </Button>
            </>
          }
          itemLayout="horizontal"
          bordered
          dataSource={members}
          renderItem={item => (
            <List.Item
              actions={[
                <Button type="link" size="small" onClick={() => removeMember(item.key)}>
                  <Icon type="user-delete" /> remove
                </Button>,
              ]}
            >
              <User id={item.key} />
            </List.Item>
          )}
        />
      ) : (
        <Button type="primary" size="small" onClick={() => convertToProject()}>
          Convert to project
        </Button>
      )}
    </Drawer>
  );
};

export default InfoDrawer;
