import React, { useState, useEffect } from 'react';
import { Spin, Icon } from 'antd';

import { getUserName } from '../api';

const UserName = ({ user, size = 'small' }) => {
  const [userName, setUserName] = useState(user ? <Spin indicator={<Icon type="loading" spin size={size} />} /> : '');

  useEffect(() => {
    const fetchData = async () => {
      const userName = await getUserName(user);

      if (userName) {
        setUserName(userName);
      } else {
        setUserName('');
      }
    };

    user && fetchData();
  }, [user]);

  return userName;
};

export default UserName;
