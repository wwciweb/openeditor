import React, { useState, useEffect } from 'react';
import { Spin, Icon, Typography } from 'antd';
import { Helmet } from 'react-helmet';

import { getTitle, updateTitle } from '../api';

const { Text } = Typography;

const Title = ({ id, size = 'small', editable = false }) => {
  const [title, setTitle] = useState(<Spin indicator={<Icon type="loading" spin size={size} />} />);

  useEffect(() => {
    const fetchData = async title => {
      title = title || (await getTitle(id));
      title &&
        setTitle(
          <>
            {editable ? (
              <Helmet>
                <title>{title}</title>
              </Helmet>
            ) : null}
            <Text
              editable={
                editable && {
                  onChange: async title => (await updateTitle(id, title)) && fetchData(title),
                }
              }
            >
              {title}
            </Text>
          </>
        );
    };

    id && fetchData();
  }, [id, editable]);

  return title;
};

export default Title;
