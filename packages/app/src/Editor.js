import React from 'react';
import { Prompt } from 'react-router-dom';
import {
  Editor,
  EditorState,
  ContentState,
  SelectionState,
  CompositeDecorator,
  convertFromRaw,
  convertToRaw,
  Modifier,
} from 'draft-js';
import chunk from 'lodash.chunk';
import debounce from 'p-debounce';
import VisibilitySensor from 'react-visibility-sensor';
import {
  message,
  Empty,
  Form,
  Button,
  Tooltip,
  Affix,
  Icon,
  Modal,
  Layout,
  Input,
  Radio,
  Drawer,
  Row,
  Col,
  Spin,
} from 'antd';

import { alignSTT } from '@bbc/stt-align-node';
import { SequenceMatcher } from 'difflib';

import CustomBlock from './CustomBlock.js';

import exportTranscript from './utils/exportTranscript.js';
import { updateTranscript, getTranscript, generateId } from './api';

const { Content } = Layout;
const RadioGroup = Radio.Group;

const radioStyle = {
  display: 'block',
  height: '30px',
  lineHeight: '30px',
};

message.config({ top: 100 });

const WAVE = false;

class TranscriptEditor extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      message: 'Transcript loading…',
      loading: false,
      saving: false,
      readOnly: false,
      speakers: [],
      exportValue: 1,
      blockNavigation: false,
      overtype: '',
      search: '',
      replace: '',
    };

    this.queue = [];
    this.editorRefs = {};

    this.debouncedSave = debounce(this.save, 3000);

    window.addEventListener('beforeunload', e => {
      if (this.state.blockNavigation) {
        this.hide = message.loading('Saving in progress…', 0);
        e.preventDefault();
        e.returnValue = '';
      } else {
        delete e['returnValue'];
      }
    });
  }

  componentDidMount() {
    this.loadTranscript(this.props.transcript);
  }

  shouldComponentUpdate(nextProps, nextState) {
    // const { blockKey } = this.state;
    const time = nextProps.time * 1e3;

    if (time && time !== this.props.time * 1e3 && this.state.editors) {
      this.setPlayhead(time);

      return true;
    }

    // if (blockKey && blockKey !== nextState.blockKey) {
    //   console.log(blockKey, nextState.blockKey);
    //   const editor = this.state.editors.find(
    //     editor =>
    //       !!editor.editorState
    //         .getCurrentContent()
    //         .getBlocksAsArray()
    //         .find(block => block.getKey() === blockKey)
    //   );

    //   const block = editor.editorState
    //     .getCurrentContent()
    //     .getBlocksAsArray()
    //     .find(block => block.getKey() === blockKey);

    //   this.alignBlock(block, false);
    // }

    return true;
  }

  componentDidUpdate() {
    const { overtyperVisible, playheadEntityKey, playheadIgnore } = this.state;
    if (overtyperVisible && playheadEntityKey) {
      const playhead = document.querySelector(`span[data-entity-key="${playheadEntityKey}"]`);
      if (playhead) playhead.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    } else if (playheadEntityKey && !playheadIgnore) {
      const playhead = document.querySelector(`span[data-entity-key="${playheadEntityKey}"]`);
      console.log({ playhead });
      // if (!playhead) this.setPlayhead();
    }
  }

  setDomEditorRef = (key, ref) => (this.editorRefs[key] = ref);

  setPlayhead = (time = this.props.time * 1e3) => {
    console.log('setPlayhead', time);

    this.state.editors.forEach(({ editorState, key: playheadEditorKey }) => {
      const contentState = editorState.getCurrentContent();
      const blocks = contentState.getBlocksAsArray();
      let playheadBlockIndex = -1;

      playheadBlockIndex = blocks.findIndex(block => {
        const start = block.getData().get('start');
        const end = block.getData().get('end');
        return start <= time && time < end;
      });

      if (playheadBlockIndex > -1) {
        const playheadBlock = blocks[playheadBlockIndex];
        console.log({ playheadBlock });
        const entities = [
          ...new Set(
            playheadBlock
              .getCharacterList()
              .toArray()
              .map(character => character.getEntity())
          ),
        ].filter(value => !!value);

        const playheadEntityIndex = entities.findIndex(entity => {
          const { start, end } = contentState.getEntity(entity).getData();
          return start <= time && time < end;
        });

        const playheadEntity = entities[playheadEntityIndex];
        console.log({ playheadEntity });

        if (playheadEntity) {
          console.log(contentState.getEntity(playheadEntity).getData());
          const { key } = contentState.getEntity(playheadEntity).getData();
          if (key === this.state.playheadEntityKey) return;

          const playheadWindow = entities
            .slice(playheadEntityIndex > 10 ? playheadEntityIndex - 10 : 0, playheadEntityIndex + 1)
            .map(entity => contentState.getEntity(entity).getData().key);

          const text = playheadBlock.getText();
          const fullWindow = entities.map(entity => {
            const e = contentState.getEntity(entity).getData();
            return {
              text: text.substring(e.offset, e.offset + e.length),
              start: e.start,
              end: e.end,
              offset: e.offset,
              length: e.length,
            };
          });

          const textWindow = fullWindow.slice(
            playheadEntityIndex > 10 ? playheadEntityIndex - 10 : 0,
            playheadEntityIndex + 1
          );

          const textWindowStart = playheadEntityIndex > 10 ? playheadEntityIndex - 10 : 0;

          this.setState({
            playheadEditorKey,
            // playheadBlock,
            playheadBlockKey: playheadBlock.getKey(),
            playheadEntityKey: key,
            playheadIgnore: false,
            playheadWindow,
            textWindow,
            fullWindow,
            textWindowStart,
            // textBlock: text.split(' '),
          });

          console.log({ key });
        } else {
          this.setState({ playheadEditorKey, playheadBlockKey: playheadBlock.getKey(), playheadIgnore: true });
        }
      }
    });
  };

  addSpeaker = speaker => {
    const { speakers } = this.state;
    if (speakers.includes(speaker)) return;

    this.setState({ speakers: [...new Set([speaker, ...speakers])] });
  };

  customBlockRenderer = contentBlock => {
    const type = contentBlock.getType();
    if (type === 'paragraph' || type === 'waveform') {
      return {
        component: CustomBlock,
        editable: type === 'paragraph',
        props: {
          speakers: [...new Set(this.state.speakers)],
          addSpeaker: this.addSpeaker,
          onFocus: () => this.setState({ readOnly: true }),
          onBlur: () => this.setState({ readOnly: false }),
          changeBlockData: this.changeBlockData,
          alignBlock: this.alignBlock,
        },
      };
    }
    return null;
  };

  handleClick = event => {
    let element = event.nativeEvent.target;

    while (element && !element.hasAttribute('data-start') && element.parentElement) element = element.parentElement;
    if (element && element.hasAttribute('data-start')) {
      let t = parseFloat(element.getAttribute('data-start'));
      // console.log('found data-start', t, element);

      if (element.classList.contains('WrapperBlock')) {
        element = event.nativeEvent.target.parentElement.previousSibling;
        while (element && !element.hasAttribute('data-start') && element.previousSibling)
          element = element.previousSibling;
        if (element && element.hasAttribute('data-start')) {
          t = parseFloat(element.getAttribute('data-start'));
          // console.log('found sibling data-start', t, element);
        }
      }

      if (this.props.player) this.props.player.currentTime = t / 1e3;
    }
  };

  changeBlockData = (block, data) => {
    const blockKey = block.getKey();
    const editor = this.state.editors.find(
      editor =>
        !!editor.editorState
          .getCurrentContent()
          .getBlocksAsArray()
          .find(block => block.getKey() === blockKey)
    );

    console.log(editor.key, blockKey, { ...block.getData().toJS(), ...data });

    const editorState = editor.editorState;
    const currentContent = editorState.getCurrentContent();
    const blocks = createRaw(currentContent.getBlocksAsArray(), currentContent);
    blocks.find(({ key }) => key === blockKey).data = { ...block.getData().toJS(), ...data };

    console.log(blocks);

    const entityMap = createEntityMap(blocks);

    const contentState = convertFromRaw({
      blocks,
      entityMap,
    });

    this.onChange(EditorState.push(editorState, contentState, 'change-block-data'), editor.key);
  };

  alignBlock = (block, skipUpdate = false) => {
    const blockKey = block.getKey();
    console.log('alignBlock', blockKey);
    const editor = this.state.editors.find(
      editor =>
        !!editor.editorState
          .getCurrentContent()
          .getBlocksAsArray()
          .find(block => block.getKey() === blockKey)
    );

    const editorState = editor.editorState;
    const currentContent = editorState.getCurrentContent();
    const blocks = createRaw(currentContent.getBlocksAsArray(), currentContent);

    const blockIndex = blocks.findIndex(({ key }) => key === blockKey);

    const text = blocks[blockIndex].text;
    let words = blocks[blockIndex].entityRanges
      .map(({ start, end, offset, length }) => ({
        start: start / 1e3,
        end: end / 1e3,
        text: text.substring(offset, offset + length).trim(),
      }))
      .filter(({ text }) => text.length > 0);

    console.log(text === words.map(({ text }) => text).join(' '), text, words.map(({ text }) => text).join(' '));
    if (text === words.map(({ text }) => text).join(' ')) return blocks[blockIndex];

    words = [
      {
        text: 'STARTSTART',
        start: words[0].start - (0.08475 + 0.05379 * 'STARTSTART'.length),
        end: words[0].start,
      },
      ...words,
      {
        text: 'ENDEND',
        start: words[words.length - 1].end,
        end: words[words.length - 1].end + 0.08475 + 0.05379 * 'ENDEND'.length,
      },
    ];

    const resultAligned = alignSTT(
      {
        words,
      },
      `STARTSTART ${text} ENDEND`
    );

    // const matcher = new SequenceMatcher(null, words.map(({ text }) => text), resultAligned.map(({ text }) => text));
    // const opCodes = matcher.getOpcodes();
    // console.log(
    //   { text: `STARTSTART ${text} ENDEND`, input: words, output: resultAligned },
    //   opCodes.map(([op, a, b, c, d]) => ({
    //     op,
    //     input: words.slice(a, b),
    //     output: resultAligned.slice(c, d),
    //   }))
    // );

    resultAligned.splice(0, 1);
    resultAligned.pop();

    blocks[blockIndex].entityRanges = resultAligned
      .reduce((acc, { start, end, text }) => {
        const p = acc.pop();
        return [
          ...acc,
          p,
          {
            key: generateId(),
            start: start * 1e3,
            end: end * 1e3,
            offset: p ? p.offset + p.length + 1 : 0,
            length: text.length,
          },
        ];
      }, [])
      .filter(e => !!e);

    blocks[blockIndex].text = resultAligned.map(({ text }) => text).join(' ');

    if (skipUpdate) return blocks[blockIndex];

    const entityMap = createEntityMap(blocks);

    // const newEditorState = EditorState.push(
    //   editorState,
    //   convertFromRaw({
    //     blocks,
    //     entityMap,
    //   }),
    //   'change-block-data'
    // );

    const newEditorState = EditorState.set(
      EditorState.createWithContent(
        convertFromRaw({
          blocks: blocks,
          entityMap,
        }),
        decorator
      ),
      {
        selection: editorState.getSelection(),
        undoStack: editorState.getUndoStack(),
        redoStack: editorState.getRedoStack(),
        lastChangeType: editorState.getLastChangeType(),
        allowUndo: true,
      }
    );

    this.onChange(newEditorState, editor.key);
  };

  onChange = (editorState, key) => {
    const editorIndex = this.state.editors.findIndex(editor => editor.key === key);
    const prevEditorState = this.state.editors[editorIndex].editorState;

    const contentChange =
      editorState.getCurrentContent() === this.state.editors[editorIndex].editorState.getCurrentContent()
        ? null
        : editorState.getLastChangeType();
    console.log(contentChange);

    const blockKey = editorState.getSelection().getStartKey();

    const blocks = editorState.getCurrentContent().getBlocksAsArray();
    const blockIndex = blocks.findIndex(block => block.getKey() === blockKey);

    if (!contentChange && blockIndex === blocks.length - 1 && editorIndex < this.state.editors.length - 1) {
      const editorStateA = editorState;
      const editorStateB = this.state.editors[editorIndex + 1].editorState;

      const blocksA = editorStateA
        .getCurrentContent()
        .getBlockMap()
        .toArray();
      const blocksB = editorStateB
        .getCurrentContent()
        .getBlockMap()
        .toArray();

      const blocks = [
        ...createRaw(blocksA, editorStateA.getCurrentContent()),
        ...createRaw(blocksB, editorStateB.getCurrentContent()),
      ];

      const entityMap = createEntityMap(blocks);

      const editorStateAB = EditorState.set(
        EditorState.createWithContent(
          convertFromRaw({
            blocks,
            entityMap,
          }),
          decorator
        ),
        {
          selection: editorStateA.getSelection(),
          // undoStack: editorStateA.getUndoStack(),
          // redoStack: editorStateA.getRedoStack(),
          lastChangeType: editorStateA.getLastChangeType(),
          allowUndo: true,
        }
      );

      // const prevEditorState = this.state.editors[editorIndex].editorState;
      this.setState(
        {
          editors: [
            ...this.state.editors.slice(0, editorIndex),
            { editorState: editorStateAB, key, previewState: createPreview(editorStateAB) },
            ...this.state.editors.slice(editorIndex + 2),
          ],
        }
        // () => this.saveState(prevEditorState, editorStateAB)
      );
    } else if (contentChange === 'split-block') {
      const splitBlocks = createRaw(blocks, editorState.getCurrentContent());

      console.log(splitBlocks[blockIndex - 1], splitBlocks[blockIndex]);
      if (splitBlocks[blockIndex].text.length === 0) splitBlocks[blockIndex].text = ' ';

      // prev block
      splitBlocks[blockIndex - 1].data.end =
        splitBlocks[blockIndex - 1].entityRanges.length > 0
          ? splitBlocks[blockIndex - 1].entityRanges[splitBlocks[blockIndex - 1].entityRanges.length - 1].end
          : splitBlocks[blockIndex - 1].data.end;

      // new block
      splitBlocks[blockIndex].data.speaker = splitBlocks[blockIndex - 1].data.speaker;
      splitBlocks[blockIndex].data.start = splitBlocks[blockIndex - 1].data.end;
      splitBlocks[blockIndex].data.end =
        splitBlocks[blockIndex].entityRanges.length > 0
          ? splitBlocks[blockIndex].entityRanges[splitBlocks[blockIndex].entityRanges.length - 1].end
          : splitBlocks[blockIndex].data.start;

      const entityMap = createEntityMap(splitBlocks);
      const splitEditorState = EditorState.set(
        EditorState.createWithContent(
          convertFromRaw({
            blocks: splitBlocks,
            entityMap,
          }),
          decorator
        ),
        {
          selection: editorState.getSelection(),
          undoStack: editorState.getUndoStack(),
          redoStack: editorState.getRedoStack(),
          lastChangeType: editorState.getLastChangeType(),
          allowUndo: true,
        }
      );

      // const prevEditorState = this.state.editors[editorIndex].editorState;
      this.setState(
        {
          editors: [
            ...this.state.editors.slice(0, editorIndex),
            {
              editorState: splitEditorState,
              key,
              previewState: createPreview(editorState),
            },
            ...this.state.editors.slice(editorIndex + 1),
          ],
        },
        () => this.saveState(prevEditorState, splitEditorState)
      );
    } else {
      let newEditorState = editorState;

      if (
        contentChange === 'backspace-character' &&
        blocks.length < prevEditorState.getCurrentContent().getBlocksAsArray().length
      ) {
        // console.log('JOIN');
        const currentContent = editorState.getCurrentContent();
        const rawBlocks = createRaw(currentContent.getBlocksAsArray(), currentContent);
        const blockIndex = rawBlocks.findIndex(({ key }) => key === blockKey);

        // console.log(JSON.stringify(rawBlocks[blockIndex]));
        this.setState({ playheadBlockKey: rawBlocks[blockIndex].key });

        rawBlocks[blockIndex].data.start =
          rawBlocks[blockIndex].entityRanges.length > 0
            ? rawBlocks[blockIndex].entityRanges[0].start
            : rawBlocks[blockIndex].data.start;
        rawBlocks[blockIndex].data.end =
          rawBlocks[blockIndex].entityRanges.length > 0
            ? rawBlocks[blockIndex].entityRanges[rawBlocks[blockIndex].entityRanges.length - 1].end
            : rawBlocks[blockIndex].data.end;

        // console.log(rawBlocks[blockIndex]);
        const entityMap = createEntityMap(rawBlocks);

        // const contentState = convertFromRaw({
        //   blocks: rawBlocks,
        //   entityMap,
        // });

        // newEditorState = EditorState.push(editorState, contentState, 'change-block-data');

        // const selectionState = SelectionState.createEmpty(blockKey);
        // var updatedSelection = selectionState.merge({
        //   focusKey: blockKey,
        //   focusOffset: 0,
        // });
        // const selectionStateWithNewFocusOffset = selectionState.set('focusOffset', 1);
        // newEditorState = EditorState.acceptSelection(newEditorState, selectionStateWithNewFocusOffset);

        newEditorState = EditorState.set(
          EditorState.createWithContent(
            convertFromRaw({
              blocks: rawBlocks,
              entityMap,
            }),
            decorator
          ),
          {
            selection: editorState.getSelection(),
            undoStack: editorState.getUndoStack(),
            redoStack: editorState.getRedoStack(),
            lastChangeType: editorState.getLastChangeType(),
            allowUndo: true,
          }
        );
      }

      // const prevEditorState = this.state.editors[editorIndex].editorState;
      this.setState(
        {
          blockKey,
          editors: [
            ...this.state.editors.slice(0, editorIndex),
            { editorState: newEditorState, key, previewState: createPreview(newEditorState) },
            ...this.state.editors.slice(editorIndex + 1),
          ],
        },
        () => this.saveState(prevEditorState, newEditorState)
      );
    }
  };

  saveState = (editorStateA, editorStateB) => {
    const changes = this.getSegmentChanges(editorStateA, editorStateB);
    if (!changes || changes.length === 0) return;
    console.log({ changes });

    this.setState({ blockNavigation: true });
    this.debouncedSave();
  };

  save = async () => {
    const changes = this.getChanges(this.state.prevEditors);
    console.log({ allChanges: changes });
    if (!changes || changes.length === 0) {
      this.setState({ blockNavigation: false });
      return;
    }

    if (changes.length > 1) this.hide = message.loading('Saving in progress…', 0);

    this.setState({ saving: true });

    const blocks = this.state.editors.reduce(
      (acc, { editorState }) => [
        ...acc,
        ...editorState
          .getCurrentContent()
          .getBlocksAsArray()
          .filter(({ type }) => type !== 'waveform')
          .map(b => b.getKey()),
      ],
      []
    );

    await updateTranscript(this.props.transcript, blocks, changes);
    this.setState({ saving: false, blockNavigation: false, prevEditors: this.state.editors });
    this.hide && this.hide();
  };

  getChanges = (prevEditors = []) => {
    const { editors } = this.state;

    const changes = editors.reduce((acc, { editorState: editorStateB, key: bKey }) => {
      const editorA = prevEditors.find(({ key }) => key === bKey);
      const editorStateA = editorA ? editorA.editorState : null;
      const segmentChanges = this.getSegmentChanges(editorStateA, editorStateB);
      return segmentChanges.length > 0 ? [...acc, ...segmentChanges] : acc;
    }, []);

    return changes;
  };

  getSegmentChanges = (editorStateA, editorStateB) => {
    const blocksA = editorStateA && editorStateA.getCurrentContent().getBlocksAsArray();
    const blocksB = editorStateB.getCurrentContent().getBlocksAsArray();

    const changeSet = blocksB
      .filter(block => block.getType() !== 'waveform')
      .reduce((acc, block) => {
        const key = block.getKey();
        const blockA = editorStateA && blocksA.find(blockA => blockA.getKey() === key);

        if (
          !blockA ||
          block.getText() !== blockA.getText() ||
          block.getData().get('speaker') !== blockA.getData().get('speaker') ||
          block.getData().get('status') !== blockA.getData().get('status')
        )
          return [...acc, block];
        return [...acc];
      }, []);

    return changeSet.length === 0
      ? []
      : createRaw(changeSet, editorStateB.getCurrentContent()).map(
          ({ key, text, data: { start, end, speaker, status }, entityRanges }) => {
            const entityData = {};
            entityRanges.forEach(entity =>
              Object.keys(entity).forEach(key =>
                entityData[key] ? entityData[key].push(entity[key]) : (entityData[key] = [entity[key]])
              )
            );

            const { start: starts, end: ends, offset: offsets, length: lengths, key: keys } = entityData;

            return {
              key,
              start,
              end,
              speaker,
              text,
              starts,
              ends,
              offsets,
              lengths,
              keys,
              status,
            };
          }
        );
  };

  loadTranscript = async id => {
    this.setState({ loading: true });

    // try {
    const { data: transcript } = await getTranscript(id);
    console.log(transcript);

    const { blocks } = transcript;
    if (!blocks || blocks.length === 0) {
      this.setState({ loading: false, import: true });
      return;
    }

    const editors = chunk(blocks, 10).map(segments => {
      const blocks = segments
        .filter(segment => !!segment) // TODO: same fix on save
        .map(
          ({
            text,
            start,
            end,
            speaker,
            SK: key,
            starts = [],
            ends = [],
            keys = [],
            offsets = [],
            lengths = [],
            status,
          }) => {
            // const i = (start * 2 * waveform.sample_rate) / waveform.samples_per_pixel / 1e3;
            // const j = (end * 2 * waveform.sample_rate) / waveform.samples_per_pixel / 1e3;
            // const segment = waveform.data.slice(i, j);
            // const min = Math.min(...segment);
            // const max = Math.max(...segment);

            // // console.log(start, end, segment, min, max);

            // const wave = segment.map(v => (v === 0 ? 0 : v > 0 ? v / max : -v / min)).map(wavefont);
            return {
              text,
              key: key.substring('v0_block:'.length),
              type: 'paragraph',
              data: { start, end, speaker, status },
              // entityRanges: [],
              entityRanges: keys.map((key, i) => {
                return {
                  start: starts[i],
                  end: ends[i],
                  offset: offsets[i],
                  length: lengths[i],
                  key,
                };
              }),
              inlineStyleRanges: [],
            };
          }
        )
        .reduce((acc, block, index, blocks) => {
          if (block.entityRanges.length === 0) block.entityRanges = [{ offset: 0, length: 1 }];
          if (index < 1 || !WAVE) return [...acc, block];
        }, []);

      const editorState = EditorState.set(
        EditorState.createWithContent(convertFromRaw({ blocks, entityMap: createEntityMap(blocks) }), decorator),
        { allowUndo: true }
      );

      // console.log(blocks);

      return {
        editorState,
        key: `editor-${blocks[0].key}`,
        previewState: createPreview(editorState),
      };
    });

    const speakers = [...new Set(blocks.filter(block => !!block).map(b => b.speaker))].filter(s => !!s);

    const playheadEditorKey = editors[0].key;
    const playheadBlock = editors[0].editorState.getCurrentContent().getBlocksAsArray()[0];
    const playheadBlockKey = playheadBlock.getKey();

    const playheadEntity = [
      ...new Set(
        playheadBlock
          .getCharacterList()
          .toArray()
          .map(character => character.getEntity())
      ),
    ].filter(value => !!value)[0];

    const { key: playheadEntityKey, start } = editors[0].editorState
      .getCurrentContent()
      .getEntity(playheadEntity)
      .getData();

    if (this.props.player && start) this.props.player.currentTime = start / 1e3;

    this.setState({
      title: transcript.title,
      editors,
      speakers,
      loading: false,
      prevEditors: editors,
      playheadEditorKey,
      playheadBlockKey,
      playheadEntityKey,
    });
    // } catch (e) {
    //   console.log(e);
    //   this.setState({ loading: false, message: 'error loading transcript' });
    // }
  };

  onPaste = (text, key) => {
    const editor = this.state.editors.find(editor => editor.key === key);
    const editorState = editor.editorState;

    const blockKey = editorState.getSelection().getStartKey();
    const blocks = editorState.getCurrentContent().getBlocksAsArray();
    const block = blocks.find(block => block.getKey() === blockKey);
    const data = block.getData();
    console.log(data);

    const blockMap = ContentState.createFromText(text).blockMap;
    const newState = Modifier.replaceWithFragment(
      editorState.getCurrentContent(),
      editorState.getSelection(),
      blockMap
    );

    const newState2 = Modifier.setBlockData(newState, editorState.getSelection(), data);

    this.onChange(EditorState.push(editorState, newState2, 'insert-fragment'), key);

    return 'handled';
  };

  renderEditor = ({ editorState, key, previewState }, search, match) => {
    return (
      <section key={`s-${key}`} data-editor-key={key}>
        <VisibilitySensor intervalCheck={false} scrollCheck={true} partialVisibility={true}>
          {({ isVisible }) => {
            const state = isVisible ? editorState : previewState;

            return (
              <Editor
                editorKey={key}
                readOnly={!isVisible || this.state.readOnly || this.state.overtyperVisible}
                stripPastedStyles
                // editorState={match && search && search.length > 2 ? EditorState.set(editorState, { decorator: generateDecorator(search) }) : state}
                editorState={state}
                blockRendererFn={this.customBlockRenderer}
                onChange={editorState => this.onChange(editorState, key)}
                ref={ref => this.setDomEditorRef(key, ref)}
                handleDrop={() => true}
                handleDroppedFiles={() => true}
                handlePastedFiles={() => true}
                handlePastedText={text => this.onPaste(text, key)}
              />
            );
          }}
        </VisibilitySensor>
      </section>
    );
  };

  handleBlockNavigation = () => {
    this.hide = message.loading('Saving in progress…', 0);
    return 'You have unsaved changes, are you sure you want to leave?';
  };

  exportFilesHandleOk = e => {
    const blocks = this.state.editors.reduce(
      (acc, { editorState }) => [
        ...acc,
        ...editorState
          .getCurrentContent()
          .getBlocksAsArray()
          .filter(({ type }) => type !== 'waveform'),
      ],
      []
    );

    exportTranscript(this.props.transcript, this.state.title, '', blocks, this.state.exportValue);

    this.setState({ exportFilesModalVisible: false });
  };

  handleFindField = ({ nativeEvent }) => {
    const { value } = nativeEvent.srcElement;
    this.setState({ search: value, findMatches: null });
  };

  handleReplaceField = ({ nativeEvent }) => {
    const { value } = nativeEvent.srcElement;
    this.setState({ replace: value });
  };

  handleReplace = event => {
    const { editors, findMatch, replace } = this.state;
    const {
      editor: { index: editorIndex, key },
      index: anchorOffset,
      key: blockKey,
    } = findMatch;
    const editorState = editors[editorIndex].editorState;

    console.log({ editorState, replace });

    const updatedContentState = Modifier.replaceText(
      editorState.getCurrentContent(),
      editorState.getSelection(),
      replace
    );
    // const newState2 = Modifier.setBlockData(newState, editorState.getSelection(), data);

    const updatedEditorState = EditorState.push(editorState, updatedContentState, 'insert-characters');
    // this.onChange(EditorState.push(editorState, updatedEditorState, 'insert-characters'), key);

    this.setState(
      {
        editors: [
          ...this.state.editors.slice(0, editorIndex),
          { editorState: updatedEditorState, key, previewState: createPreview(updatedEditorState) },
          ...this.state.editors.slice(editorIndex + 1),
        ],
      },
      () => {
        this.saveState(editorState, updatedEditorState);
        this.handleFind(event);
      }
    );
  };

  handleFind = event => {
    event.preventDefault();
    event.stopPropagation();

    const { editors, search, searchIndex = 0 } = this.state;

    const regex = new RegExp(search, 'ig');

    const searchSpace = editors; // .slice(searchIndex);
    // console.log({ editors, searchSpace });

    const matches = searchSpace.reduce((acc, { key, editorState }, index) => {
      const blocks = editorState.getCurrentContent().getBlocksAsArray();
      const selection = editorState.getSelection();
      const anchorKey = selection.getAnchorKey();
      const anchorBlockIndex = blocks.findIndex(block => block.getKey() === anchorKey);

      const prevBlocks =
        anchorBlockIndex === 0 ? 0 : blocks.slice(0, anchorBlockIndex).reduce((acc, b) => acc + b.getText().length, 0);
      const offset = selection.getEndOffset();

      const matchedBlocks = blocks
        .slice(anchorBlockIndex)
        .map((block, index) => {
          const prevBlocks2 = index === 0 ? 0 : blocks.slice(0, index).reduce((acc, b) => acc + b.getText().length, 0);

          return {
            key: block.key,
            prevBlocks2,
            matches: [...block.getText().matchAll(regex)].filter(
              ({ index }) => index >= offset + prevBlocks - prevBlocks2
            ),
          };
        })
        .filter(({ matches }) => matches.length > 0);

      // console.log({ offset, prevBlocks, matchedBlocks });

      return [
        ...acc,
        ...matchedBlocks
          .reduce(
            (acc, { key, prevBlocks2, matches }) => [...acc, ...matches.map(m => ({ ...m, key, prevBlocks2 }))],
            []
          )
          .map(m => ({
            ...m,
            editor: {
              key,
              index,
              editorState,
            },
          })),
      ];
    }, []);

    // console.log({ matches });

    const match = matches.length > 0 ? matches[0] : null;

    console.log({ match });

    let nextSearchIndex = searchIndex;
    // if (matches.length === 1) {
    //   nextSearchIndex = searchIndex < editors.length - 1 ? searchIndex + 1 : 0;
    // } else {
    //   nextSearchIndex = 0;
    // }

    // if (!match && nextSearchIndex === 0) {
    //   this.setState({
    //     searchIndex: nextSearchIndex,
    //     editors: this.state.editors.map(editor => {
    //       const blocks = editor.editorState.getCurrentContent().getBlocksAsArray();
    //       const blockKey = blocks[0].getKey();
    //       const selectionState = SelectionState.createEmpty(blockKey);
    //       const updatedSelection = selectionState.merge({
    //         anchorOffset: 0,
    //         focusOffset: 0,
    //       });

    //       const updatedEditorState = EditorState.forceSelection(editor.editorState, updatedSelection);
    //       return {
    //         ...editor,
    //         editorState: updatedEditorState,
    //       };
    //     }),
    //   });
    // }

    if (match) {
      const {
        editor: { index: editorIndex, key, editorState },
        index: anchorOffset,
        key: blockKey,
      } = match;

      const selectionState = SelectionState.createEmpty(blockKey);
      const updatedSelection = selectionState.merge({
        anchorOffset,
        focusOffset: anchorOffset + search.length,
      });

      const updatedEditorState = EditorState.forceSelection(editorState, updatedSelection);
      this.setState(
        {
          searchIndex: nextSearchIndex,
          editors: [
            ...this.state.editors.slice(0, editorIndex),
            { editorState: updatedEditorState, key, previewState: createPreview(updatedEditorState) },
            ...this.state.editors.slice(editorIndex + 1),
          ],
          findMatch: match,
        },
        () =>
          setTimeout(() => {
            // TODO move to onchange/getSelectionState?
            let node = window.getSelection().anchorNode;
            node = node && node.nodeType === 3 ? node.parentNode : node;
            if (node) {
              node.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
              node = document.querySelector(`div[data-offset-key="${match.key}-0-0"]`);
              node && node.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 0)
      );
    }
  };

  closeSearch = () => {
    // this.setState({ findReplaceVisible: false, findMatch: null, searchIndex: 0, findMatches: null});
    this.setState({
      findReplaceVisible: false,
      findMatch: null,
      searchIndex: 0,
      editors: this.state.editors.map(editor => {
        const blocks = editor.editorState.getCurrentContent().getBlocksAsArray();
        const blockKey = blocks[0].getKey();
        const selectionState = SelectionState.createEmpty(blockKey);
        // const updatedSelection = selectionState.merge({
        //   anchorOffset: 0,
        //   focusOffset: 0,
        // });

        const updatedEditorState = EditorState.acceptSelection(editor.editorState, selectionState);
        return {
          ...editor,
          editorState: updatedEditorState,
        };
      }),
    });
  };

  render() {
    const {
      message,
      loading,
      editors,
      playheadEditorKey,
      playheadBlockKey,
      playheadEntityKey,
      playheadWindow,
      blockNavigation,
      textWindow,
      match,
      overtyperVisible,
      findReplaceVisible,
      search,
      replace,
      findMatch,
    } = this.state;

    if (loading || !editors)
      return (
        <Content
          style={{
            background: '#fff',
          }}
        >
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span>{message}</span>}>
            {loading ? <Spin indicator={<Icon type="loading" style={{ fontSize: 24 }} spin />} /> : null}
          </Empty>
        </Content>
      );

    return (
      <Content
        style={{
          background: '#fff',
        }}
      >
        <Prompt when={blockNavigation} message={this.handleBlockNavigation} />
        <article>
          <div onClick={event => this.handleClick(event)}>
            <style scoped>
              {`section[data-editor-key="${playheadEditorKey}"] ~ section .WrapperBlock div[data-offset-key] > span { font-weight: normal; color: #31465fcf !important; }`}
              {`div[data-offset-key="${playheadBlockKey}-0-0"] ~ div > .WrapperBlock div[data-offset-key] > span { font-weight: normal; color: #31465fcf !important;}`}
              {`span[data-entity-key="${playheadEntityKey}"] ~ span[data-entity-key] { font-weight: normal; color: #31465fcf !important;}`}
              {playheadWindow && overtyperVisible
                ? playheadWindow.map(key => `span[data-entity-key="${key}"] { font-weight: 700; }`)
                : null}
            </style>
            {editors.map((editorState, index) => this.renderEditor(editorState, search, findMatch))}
          </div>
        </article>
        <Row type="flex">
          <Col span={8}></Col>
          <Col span={8}></Col>

          <Col span={8}>
            <Affix className="controls-holder" offsetBottom={16} type="flex" align="right">
              <div>
                <Tooltip placement="topLeft" title="Find / Replace" arrowPointAtCenter>
                  <Button
                    className="action-button"
                    type="primary"
                    shape="circle"
                    icon="file-search"
                    size="large"
                    onClick={() => this.setState({ findReplaceVisible: true })}
                  />
                </Tooltip>

                <Tooltip placement="topLeft" title="Export" arrowPointAtCenter>
                  <Button
                    className="action-button"
                    type="primary"
                    shape="circle"
                    icon="export"
                    size="large"
                    onClick={() => this.setState({ exportFilesModalVisible: true })}
                  />
                </Tooltip>
              </div>
            </Affix>
          </Col>
        </Row>

        <Drawer
          title="Find / Replace"
          placement={'bottom'}
          closable={true}
          mask={false}
          onClose={this.closeSearch}
          visible={findReplaceVisible}
          height={'128'}
        >
          <Form layout="inline" onSubmit={this.handleFind} type="flex" align="center">
            <Form.Item>
              <Input
                value={search}
                prefix={<Icon type="search" style={{ color: 'rgba(0,0,0,.25)' }} />}
                placeholder="Find"
                onChange={this.handleFindField}
              />
            </Form.Item>
            <Form.Item>
              <Input
                value={replace}
                prefix={<Icon type="retweet" style={{ color: 'rgba(0,0,0,.25)' }} />}
                placeholder="Replace"
                onChange={this.handleReplaceField}
              />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit">
                Find
              </Button>{' '}
              <Button type="primary" disabled={!findMatch} onClick={this.handleReplace}>
                Replace
              </Button>
            </Form.Item>
          </Form>
        </Drawer>

        <Modal
          title="Export transcripts"
          visible={this.state.exportFilesModalVisible}
          onOk={this.exportFilesHandleOk}
          onCancel={() => this.setState({ exportFilesModalVisible: false })}
        >
          <p>Select format:</p>
          <RadioGroup onChange={e => this.setState({ exportValue: e.target.value })} value={this.state.exportValue}>
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
            <Radio style={radioStyle} value={2} disabled>
              {' '}
              JSON Format (contains timings and other meta data)
            </Radio>
            <Radio style={radioStyle} value={3} disabled>
              {' '}
              Interactive Transcript
            </Radio>
          </RadioGroup>
        </Modal>
      </Content>
    );
  }
}

const flatten = list => list.reduce((a, b) => a.concat(Array.isArray(b) ? flatten(b) : b), []);

const getEntityStrategy = mutability => (contentBlock, callback, contentState) => {
  contentBlock.findEntityRanges(character => {
    const entityKey = character.getEntity();
    return entityKey && contentState.getEntity(entityKey).getMutability() === mutability;
  }, callback);
};

const decorator = new CompositeDecorator([
  {
    strategy: getEntityStrategy('MUTABLE'),
    component: ({ entityKey, contentState, children }) => {
      const data = entityKey ? contentState.getEntity(entityKey).getData() : {};
      return (
        <span data-start={data.start} data-entity-key={data.key} className="Token">
          {children}
        </span>
      );
    },
  },
]);

const findWithRegex = (regex, contentBlock, callback) => {
  const text = contentBlock.getText();
  let matchArr, start, end;
  while ((matchArr = regex.exec(text)) !== null) {
    start = matchArr.index;
    end = start + matchArr[0].length;
    callback(start, end);
  }
};

const generateDecorator = (highlightTerm = '') => {
  const regex = new RegExp(highlightTerm, 'gi');

  return new CompositeDecorator([
    {
      strategy: (contentBlock, callback) => {
        if (highlightTerm !== '') {
          findWithRegex(regex, contentBlock, callback);
        }
      },
      component: ({ children }) => <span className="searchHit">{children}</span>,
    },
    {
      strategy: getEntityStrategy('MUTABLE'),
      component: ({ entityKey, contentState, children }) => {
        const data = entityKey ? contentState.getEntity(entityKey).getData() : {};
        return (
          <span data-start={data.start} data-end={data.end} data-entity-key={data.key} className="Token">
            {children}
          </span>
        );
      },
    },
  ]);
};

const createPreview = editorState =>
  EditorState.set(
    EditorState.createWithContent(
      convertFromRaw({
        blocks: convertToRaw(editorState.getCurrentContent()).blocks.map(block => ({
          ...block,
          entityRanges: [],
          inlineStyleRanges: [],
        })),
        entityMap: {},
      }),
      decorator
    ),
    { allowUndo: false }
  );

const createEntityMap = blocks =>
  flatten(blocks.map(block => block.entityRanges)).reduce(
    (acc, data) => ({
      ...acc,
      [data.key]: { type: 'TOKEN', mutability: 'MUTABLE', data },
    }),
    {}
  );

const createRaw = (blocks, contentState) =>
  blocks.map(block => {
    const key = block.getKey();
    const type = block.getType();
    const text = block.getText();
    const data = block.getData().toJS();

    const entityRanges = [];
    block.findEntityRanges(
      character => !!character.getEntity(),
      (start, end) =>
        entityRanges.push({
          offset: start,
          length: end - start,
        })
    );

    return {
      key,
      type,
      text,
      data,
      entityRanges: entityRanges.map(({ offset, length }) => {
        const entityKey = block.getEntityAt(offset);
        const entity = contentState.getEntity(entityKey);
        return {
          ...entity.getData(),
          offset,
          length,
        };
      }),
      inlineStyleRanges: [],
    };
  });

export default TranscriptEditor;
