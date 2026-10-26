// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { YouTubePlayer, type YouTubeControls } from '../features/jukebox/YouTubePlayer';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('official embedded YouTube playback', () => {
  it('uses a visible player, reports real events and controls pause/volume/cleanup', async () => {
    const commands = { playVideo: vi.fn(), pauseVideo: vi.fn(), setVolume: vi.fn(), destroy: vi.fn() };
    type Events = { onReady(event: { target: typeof commands }): void; onStateChange(event: { data: number }): void; onError(event: { data: number }): void; onAutoplayBlocked(): void };
    let events!: Events;
    const constructor = vi.fn(function (_element: HTMLElement, options: { events: Events }) {
      events = options.events;
      return commands;
    });
    vi.stubGlobal('YT', { Player: constructor });
    const ref = createRef<YouTubeControls>(), playing = vi.fn(), ended = vi.fn(), error = vi.fn();
    const view = render(<YouTubePlayer ref={ref} videoId="M7lc1UVf-VE" volume={0.5} onPlaying={playing} onEnded={ended} onError={error} />);
    await waitFor(() => expect(constructor).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Trình phát YouTube').className).toContain('min-h-[200px]');
    expect(constructor.mock.calls[0]![1]).toMatchObject({ host: 'https://www.youtube-nocookie.com', videoId: 'M7lc1UVf-VE', playerVars: { origin: window.location.origin, autoplay: 0 } });
    expect(playing).not.toHaveBeenCalled();
    act(() => events.onReady({ target: commands }));
    expect(commands.setVolume).toHaveBeenCalledWith(50);
    expect(commands.playVideo).toHaveBeenCalledOnce();
    act(() => events.onStateChange({ data: 1 })); expect(playing).toHaveBeenLastCalledWith(true);
    act(() => ref.current?.pause()); expect(commands.pauseVideo).toHaveBeenCalledOnce();
    act(() => ref.current?.setVolume(0.8)); expect(commands.setVolume).toHaveBeenLastCalledWith(80);
    act(() => events.onAutoplayBlocked()); expect(error).toHaveBeenLastCalledWith(expect.stringContaining('chặn tự phát'));
    act(() => events.onError({ data: 101 })); expect(error).toHaveBeenLastCalledWith(expect.stringContaining('101'));
    expect(ended).not.toHaveBeenCalled();
    act(() => events.onStateChange({ data: 0 })); expect(ended).toHaveBeenCalledOnce();
    view.unmount(); expect(commands.destroy).toHaveBeenCalledOnce();
    events.onStateChange({ data: 0 }); expect(ended).toHaveBeenCalledOnce();
  });
});
