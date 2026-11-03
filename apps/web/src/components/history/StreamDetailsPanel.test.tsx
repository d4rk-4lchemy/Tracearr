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

    expect(screen.getByText('pages:history.stream.speed')).toBeTruthy();
    expect(screen.getByText('1.03x')).toBeTruthy();
    expect(screen.getByText('pages:history.stream.transcodeDetails')).toBeTruthy();
    expect(screen.getAllByText('pages:history.stream.speed')).toHaveLength(1);
  });
});


describe('StreamDetailsPanel without technical stream metadata', () => {
  it('shows the playback decision when codec and resolution details are unavailable', () => {
    render(
      <StreamDetailsPanel
        sourceVideoCodec={null}
        sourceAudioCodec={null}
        sourceAudioChannels={null}
        sourceVideoWidth={null}
        sourceVideoHeight={null}
        streamVideoCodec={null}
        streamAudioCodec={null}
        sourceVideoDetails={null}
        sourceAudioDetails={null}
        streamVideoDetails={null}
        streamAudioDetails={null}
        transcodeInfo={null}
        subtitleInfo={null}
        videoDecision="directplay"
        audioDecision="directplay"
        bitrate={0}
        serverType="channels_dvr"
      />
    );

    expect(screen.getByText('pages:history.stream.video')).toBeTruthy();
    expect(screen.getByText('pages:history.stream.audio')).toBeTruthy();
    expect(screen.getAllByText('playback.directPlay')).toHaveLength(2);
    expect(screen.queryByText('pages:history.stream.noDetails')).toBeNull();
  });
});
