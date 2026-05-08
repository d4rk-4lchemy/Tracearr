// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StreamDetailsPanel } from './StreamDetailsPanel';

describe('StreamDetailsPanel speed placement', () => {
  it('renders Speed in main stream details with 2 decimal places', () => {
    render(
      <StreamDetailsPanel
        sourceVideoCodec="h264"
        sourceAudioCodec={null}
        sourceAudioChannels={null}
        sourceVideoWidth={1920}
        sourceVideoHeight={1080}
        streamVideoCodec="h264"
        streamAudioCodec={null}
        sourceVideoDetails={null}
        sourceAudioDetails={null}
        streamVideoDetails={null}
        streamAudioDetails={null}
        transcodeInfo={{ speed: 1.034, hwEncoding: 'nvenc' }}
        subtitleInfo={null}
        videoDecision="directplay"
        audioDecision="directplay"
        bitrate={8600}
        serverType="dispatcharr"
      />
    );

    expect(screen.getByText('Speed')).toBeTruthy();
    expect(screen.getByText('1.03x')).toBeTruthy();
    expect(screen.getByText('Transcode Details')).toBeTruthy();
    expect(screen.getAllByText('Speed')).toHaveLength(1);
  });
});
