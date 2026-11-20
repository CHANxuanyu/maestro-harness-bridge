import React from 'react';
import { act, render, screen, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ElapsedTimeDisplay } from '../../../../renderer/components/ui/ElapsedTimeDisplay';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-11-17T12:00:00Z'));
	useSettingsStore.setState({ newShell: true, uiLanguage: 'en' });
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('ElapsedTimeDisplay', () => {
	it('does not wake each second and steps from ten seconds to minutes', () => {
		const startTime = Date.now();
		const timer = vi.spyOn(globalThis, 'setTimeout');
		render(<ElapsedTimeDisplay startTime={startTime} />);
		expect(screen.getByText('just started')).toBeInTheDocument();
		expect(timer).toHaveBeenLastCalledWith(expect.any(Function), 10000);
		act(() => vi.advanceTimersByTime(9999));
		expect(timer).toHaveBeenCalledTimes(1);
		expect(screen.getByText('just started')).toBeInTheDocument();
		act(() => vi.advanceTimersByTime(1));
		expect(screen.getByText('10s')).toBeInTheDocument();
		act(() => vi.advanceTimersByTime(49000));
		expect(screen.getByText('50s')).toBeInTheDocument();
		act(() => vi.advanceTimersByTime(1000));
		expect(screen.getByText('1m')).toBeInTheDocument();
		expect(timer).toHaveBeenLastCalledWith(expect.any(Function), 60000);
		const calls = timer.mock.calls.length;
		act(() => vi.advanceTimersByTime(59999));
		expect(timer).toHaveBeenCalledTimes(calls);
		act(() => vi.advanceTimersByTime(1));
		expect(screen.getByText('2m')).toBeInTheDocument();
		timer.mockRestore();
	});
	it('uses Chinese copy and resets when switching turns', () => {
		useSettingsStore.setState({ uiLanguage: 'zh-CN' });
		const { rerender } = render(<ElapsedTimeDisplay startTime={Date.now() - 60000} />);
		expect(screen.getByText('1m')).toBeInTheDocument();
		rerender(<ElapsedTimeDisplay startTime={Date.now()} />);
		expect(screen.getByText('刚开始')).toBeInTheDocument();
	});
	it('parks a paused clock and cleans up a running timer on unmount', () => {
		const { rerender, unmount } = render(
			<ElapsedTimeDisplay startTime={Date.now()} accumulatedElapsedMs={30000} />
		);
		expect(screen.getByText('30s')).toBeInTheDocument();
		expect(vi.getTimerCount()).toBe(0);
		rerender(
			<ElapsedTimeDisplay
				startTime={Date.now()}
				accumulatedElapsedMs={30000}
				lastActiveTimestamp={Date.now()}
			/>
		);
		expect(vi.getTimerCount()).toBe(1);
		unmount();
		expect(vi.getTimerCount()).toBe(0);
	});
	it('preserves the classic second ticker', () => {
		useSettingsStore.setState({ newShell: false });
		render(<ElapsedTimeDisplay startTime={Date.now()} />);
		act(() => vi.advanceTimersByTime(1000));
		expect(screen.getByText('0m 1s')).toBeInTheDocument();
	});
});
