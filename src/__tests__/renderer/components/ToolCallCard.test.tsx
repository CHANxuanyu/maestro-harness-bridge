import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolCallCard } from '../../../renderer/components/ToolCallCard';
import { mockTheme } from '../../helpers/mockTheme';

const card = (state?: Record<string, unknown>) =>
	render(
		<ToolCallCard theme={mockTheme} toolUse={[{ id: 'call-1', tool: 'run_command', state }]} />
	);

describe('ToolCallCard status', () => {
	it('draws a recorded success as one', () => {
		const { container } = card({ status: 'completed', output: 'ok' });
		expect(container.querySelector('[data-tool-card-status="completed"]')).not.toBeNull();
	});

	it('does not pass an unknown outcome off as a success', () => {
		const { container } = card({ status: 'unknown', output: 'a.txt' });
		expect(container.querySelector('[data-tool-card-status="completed"]')).toBeNull();
		expect(container.querySelector('[data-tool-card-status="unknown"]')).not.toBeNull();
		fireEvent.click(screen.getByText('Tool: run_command'));
		expect(screen.getByText('Status: unknown')).toBeInTheDocument();
		expect(container.querySelector('[data-tool-card-status="completed"]')).toBeNull();
	});

	it('treats a call with no recorded status as unknown, not completed', () => {
		const { container } = card({ output: 'a.txt' });
		expect(container.querySelector('[data-tool-card-status="completed"]')).toBeNull();
		fireEvent.click(screen.getByText('Tool: run_command'));
		expect(screen.getByText('Status: unknown')).toBeInTheDocument();
	});
});
