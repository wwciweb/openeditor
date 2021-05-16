import Timecode from 'smpte-timecode';
import { Document, Paragraph, TextRun, Packer } from 'docx';
import sanitize from 'sanitize-filename';
import { ContentBlock } from 'draft-js';

const exportTranscript = (id, title, description = '', blocks, format, options = {}) => {
  let data = blocks;

  if (blocks[0] instanceof ContentBlock) {
    data = blocks.map(block => ({
      start: block.getData().get('start'),
      speaker: block.getData().get('speaker'),
      text: block.getText(),
    }));
  }

  // console.log(data);

  if (format === 0) {
    const lines = [title, ''];

    data.forEach(({ start, speaker, text }) => {
      const tc = new Timecode((start / 1e3) * 30, 30)
        .toString()
        .split(':')
        .slice(0, 3)
        .join(':');

      lines.push(`${speaker} [${tc}]`);
      lines.push(text);
      lines.push('');
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const filename = `${sanitize(title)
      .replace(/ /g, '_')
      .replace(/\./g, '_')}.txt`;

    const a = document.createElement('a');
    a.href = window.URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  } else if (format === 1 || format === 1.5) {
    const doc = new Document({
      creator: `OpenEditor (%REACT_APP_GIT_SHA%)`,
      description,
      title,
    });

    const paragraphTitle = new Paragraph();
    paragraphTitle.addRun(new TextRun(title));
    paragraphTitle.heading1();
    doc.addParagraph(paragraphTitle);
    doc.addParagraph(new Paragraph());

    data.forEach(({ start, speaker, text }) => {
      const tc = new Timecode((start / 1e3) * 30, 30)
        .toString()
        .split(':')
        .slice(0, 3)
        .join(':');

      const paragraphSpeakerTimecodes = new Paragraph();
      paragraphSpeakerTimecodes.addRun(new TextRun(speaker).bold().tab());
      if (format !== 1.5) paragraphSpeakerTimecodes.addRun(new TextRun(` [${tc}]`));

      doc.addParagraph(paragraphSpeakerTimecodes);

      const paragraphText = new Paragraph(text);
      const textBreak = new TextRun('').break();
      paragraphText.addRun(textBreak);
      doc.addParagraph(paragraphText);
    });

    const packer = new Packer();
    packer.toBlob(doc).then(blob => {
      const filename = `${sanitize(title)
        .replace(/ /g, '_')
        .replace(/\./g, '_')}.docx`;
      const a = document.createElement('a');
      a.href = window.URL.createObjectURL(blob);
      a.download = filename;
      a.click();

      return blob;
    });
  } else if (format === 2 || format === 3) {
    const transcript = { title, content: {} };
    transcript.content.paragraphs = data.map(
      ({ start, end, speaker, text, starts = [], ends = [], offsets = [], lengths = [] }) => {
        const words = text
          .split(' ')
          .map(text => ({ text }))
          .reduce((acc, word) => {
            const offset = acc.map(({ text }) => text).join(' ').length + 1;
            const index = offsets.findIndex(o => o === offset);

            return [
              ...acc,
              {
                start: index && starts[index],
                end: index && ends[index],
                text: word.text,
                offset,
                length: word.text.length,
              },
            ];
          }, []);

        return {
          speaker,
          start: start / 1e3,
          end: end / 1e3,
          text,
          words,
        };
      }
    );

    transcript.content.words = transcript.content.paragraphs.reduce((acc, { words }) => [...acc, ...words], []);

    // TODO check overlaps

    const blob = new Blob([JSON.stringify(transcript, null, 2)], { type: 'application/json' });
    const filename = `${sanitize(title)
      .replace(/ /g, '_')
      .replace(/\./g, '_')}.json`;

    const a = document.createElement('a');
    a.href = window.URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }
};

export default exportTranscript;
