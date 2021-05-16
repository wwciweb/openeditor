import React from 'react';
import { EditorBlock } from 'draft-js';
import VisibilitySensor from 'react-visibility-sensor';
import Timecode from 'smpte-timecode';
import { AutoComplete, Button, Row, Col, Popover, Badge, Spin } from 'antd';

class CustomBlock extends React.Component {
  constructor(props) {
    super(props);

    const status = props.block.getData().get('status');

    this.state = {
      speaker: props.block.getData().get('speaker'),
      status: status ? status : 'transcribed',
    };
  }

  toggleStatus = () => {
    const {
      block,
      blockProps: { changeBlockData },
    } = this.props;

    this.setState({ status: this.state.status === 'corrected' ? 'edited' : 'corrected' }, () =>
      changeBlockData(block, this.state)
    );
  };

  setSpeaker = speaker => {
    // const {
    //   blockProps: { addSpeaker },
    // } = this.props;

    this.setState({ speaker });
    // addSpeaker(speaker);
  };

  align = () => {
    const {
      block,
      blockProps: { alignBlock },
    } = this.props;

    alignBlock(block);
  };

  handleBlur = () => {
    const {
      block,
      blockProps: { changeBlockData, onBlur, addSpeaker },
    } = this.props;

    const { speaker } = this.state;

    changeBlockData(block, this.state);
    addSpeaker(speaker);
    onBlur();
  };

  render() {
    const {
      block,
      blockProps: { speakers, onFocus },
    } = this.props;
    const { speaker, status } = this.state;

    const start = block.getData().get('start');
    // const end = block.getData().get('end');
    // const wave = block.getData().get('wave');
    const key = block.getKey();
    const type = block.getType();

    const [hh, mm, ss] = new Timecode((start / 1e3) * 30, 30)
      .toString()
      .split(':')
      .slice(0, 3);

    return (
      <Row gutter={24} className="WrapperBlock" data-start={start} key={key}>
        <Col span={2} className="timecode" contentEditable={false} onClick={e => e.stopPropagation()}>
          <span className={hh === '00' ? 'zero' : null}>{hh}</span>
          <span className="separator">:</span>
          <span className={hh === '00' && mm === '00' ? 'zero' : null}>
            {mm.charAt(0) !== '0' ? (
              mm
            ) : (
              <>
                <span className="zero">0</span>
                {mm.charAt(1)}
              </>
            )}
          </span>
          <span className="separator">:</span>
          <span>{ss}</span>
          {/* <br />[{start} - {end}] */}
        </Col>
        <Col span={2} className="speaker" contentEditable={false} onClick={e => e.stopPropagation()}>
          <Popover
            content={
              <AutoComplete
                dataSource={speakers.includes(speaker) || speaker === '' ? speakers : [speaker, ...speakers]}
                value={speaker}
                onSelect={this.setSpeaker}
                onSearch={this.setSpeaker}
                placeholder="speaker name"
                onFocus={onFocus}
                onBlur={this.handleBlur}
              />
            }
            trigger="click"
          >
            {speaker}
          </Popover>
        </Col>
        <Col span={16} className={type === 'waveform' ? 'wave' : ''}>
          {/* <div contentEditable={false} className="wave">
            {wave}
          </div> */}
          <VisibilitySensor intervalCheck={false} scrollCheck={true} partialVisibility={true}>
            {({ isVisible }) =>
              isVisible ? (
                <EditorBlock {...this.props} />
              ) : (
                <div className="text" contentEditable={false}>
                  {block.text}
                </div>
              )
            }
          </VisibilitySensor>
        </Col>
        <Col span={1} offset={1} className="status" contentEditable={false} onClick={e => e.stopPropagation()}>
          <Badge status={status === 'corrected' ? 'success' : 'default'} text={status} onClick={this.toggleStatus} />
          {/* <br /> */}
          <Button type="dashed" size="small" onClick={this.align}>
            align
          </Button>
        </Col>
      </Row>
    );
  }
}

export default CustomBlock;
