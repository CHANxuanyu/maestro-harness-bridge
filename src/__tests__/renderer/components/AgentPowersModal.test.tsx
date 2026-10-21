import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../renderer/contexts/LayerStackContext', () => ({
	useLayerStack: () => ({
		registerLayer: vi.fn(() => 'layer-test'),
		unregisterLayer: vi.fn(),
		updateLayerHandler: vi.fn(),
	}),
}));

import { AgentPowersModal } from '../../../renderer/components/AgentPowersModal';
import { mockTheme } from '../../helpers/mockTheme';
import { useSettingsStore } from '../../../renderer/stores/settingsStore';

function renderModal(overrides: Partial<React.ComponentProps<typeof AgentPowersModal>> = {}) {
	const props = {
		theme: mockTheme,
		isOpen: true,
		onDismiss: vi.fn(),
		...overrides,
	};
	render(<AgentPowersModal {...props} />);
	return props;
}

beforeEach(() => {
	useSettingsStore.setState({ uiLanguage: 'en' });
});

afterEach(() => {
	cleanup();
	useSettingsStore.setState({ uiLanguage: 'system' });
});

describe('AgentPowersModal', () => {
	it('renders nothing when closed', () => {
		renderModal({ isOpen: false });
		expect(screen.queryByTestId('agent-powers-modal')).not.toBeInTheDocument();
	});

	it('leads with the settings the user was just offered, then keeps going', () => {
		// The font and the theme are immediately checkable, which is what makes
		// the broader "any setting" claim credible - so the pill names both and
		// then names a third thing neither wizard step showed.
		renderModal();

		expect(screen.getByText('Change Any Setting')).toBeInTheDocument();
		const prompt = screen.getByTestId('agent-powers-example-change-any-setting').textContent ?? '';
		expect(prompt).toMatch(/font/i);
		expect(prompt).toMatch(/theme/i);
		expect(prompt).toMatch(/notifications/i);
	});

	it('shows the range beyond appearance', () => {
		renderModal();

		expect(screen.getByText('Create Agents')).toBeInTheDocument();
		expect(screen.getByText('Write an Auto Run Doc')).toBeInTheDocument();
		expect(screen.getByText('Schedule a Task')).toBeInTheDocument();
		expect(screen.getByText('Build a Cue Pipeline')).toBeInTheDocument();
		expect(screen.getByText('Build Me a Dashboard')).toBeInTheDocument();
	});

	it('splits the two automation pills by what starts them', () => {
		// A Scheduled Task is clock-driven and a pipeline hangs off an event, so
		// two wall-clock prompts would present one feature twice.
		renderModal();

		const scheduled = screen.getByTestId('agent-powers-example-schedule-a-task').textContent ?? '';
		const pipeline =
			screen.getByTestId('agent-powers-example-build-a-cue-pipeline').textContent ?? '';

		expect(scheduled).toMatch(/9am|weekday/i);
		expect(pipeline).toMatch(/whenever|pull request/i);
		expect(pipeline).not.toMatch(/\bam\b|every (morning|weekday|day)/i);
	});

	it('tells the user they do not have to be a power user', () => {
		// The grid can read as a list of things you need to learn. The closing
		// paragraph exists to say the opposite: the keyboard-driven way is real
		// and it is optional, because plain language reaches the same places.
		renderModal();

		const closing = screen.getByText(/power tool/i).textContent ?? '';
		expect(closing).toMatch(/do not have to/i);
		expect(closing).toMatch(/plain language/i);
	});

	it('names the advanced features the agent is taught, as proof of the claim', () => {
		// "Your agent knows how to drive Maestro" is only worth saying if it names
		// something the user would not expect it to reach on its own.
		renderModal();

		const closing = screen.getByText(/power tool/i).textContent ?? '';
		expect(closing).toMatch(/Auto Run/);
		expect(closing).toMatch(/Cue/);
	});

	it('closes on Got it', () => {
		const { onDismiss } = renderModal();

		fireEvent.click(screen.getByTestId('agent-powers-confirm'));
		expect(onDismiss).toHaveBeenCalled();
	});

	it('switches all example displays to Chinese while preserving the original composer prompts', () => {
		const onTryExample = vi.fn();
		const { onDismiss } = renderModal({ onTryExample });
		const firstExample = screen.getByTestId('agent-powers-example-change-any-setting');

		act(() => useSettingsStore.setState({ uiLanguage: 'zh-CN' }));

		expect(screen.getByText('智能体也能操作 Maestro')).toBeVisible();
		expect(screen.getByTestId('agent-powers-confirm')).toHaveTextContent('知道了');
		expect(screen.getByText(/点击上方任一示例，即可将请求填入输入框/)).toBeVisible();
		expect(screen.getByTestId('agent-powers-example-change-any-setting')).toBe(firstExample);

		const examples = [
			[
				'change-any-setting',
				'修改任意设置',
				'将 AI 对话字体设为 Inter',
				'Set my AI chat font to Inter, switch me to a light theme, and turn on OS notifications.',
			],
			[
				'create-agents',
				'创建智能体',
				'创建一个名为 Scratch 的新智能体',
				'Create a new agent called Scratch pointed at my home directory.',
			],
			[
				'write-an-auto-run-doc',
				'编写 Auto Run 文档',
				'检查此仓库中的 TODO',
				'Write me an Auto Run document that reviews this repo for TODOs and lists them as tasks.',
			],
			[
				'schedule-a-task',
				'安排定时任务',
				'每个工作日上午 9 点',
				'Every weekday at 9am, summarize what changed in this repo overnight.',
			],
			[
				'build-a-cue-pipeline',
				'构建 Cue 流程',
				'每当此仓库新建拉取请求时',
				'Whenever a pull request opens on this repo, have an agent review it and report back.',
			],
			[
				'build-me-a-dashboard',
				'创建仪表盘',
				'为此仓库创建一个 HTML 仪表盘',
				'Build me an HTML dashboard of this repo: commits per week, top contributors, open TODOs.',
			],
		];
		for (const [index, [id, label, displayPrompt, nativePrompt]] of examples.entries()) {
			const example = screen.getByTestId('agent-powers-example-' + id);
			expect(example).toHaveTextContent(label);
			expect(example).toHaveTextContent(displayPrompt);
			expect(example).not.toHaveTextContent(nativePrompt);
			fireEvent.click(example);
			expect(onTryExample).toHaveBeenNthCalledWith(index + 1, nativePrompt);
		}
		expect(onTryExample).toHaveBeenCalledTimes(6);
		expect(onDismiss).toHaveBeenCalledTimes(6);
	});

	it('keeps Chinese examples disabled and hides the composer instruction without an agent', () => {
		useSettingsStore.setState({ uiLanguage: 'zh-CN' });
		renderModal();
		expect(screen.getByTestId('agent-powers-example-create-agents')).toBeDisabled();
		expect(screen.queryByText(/点击上方任一示例，即可将请求填入输入框/)).not.toBeInTheDocument();
	});

	describe('example prompts', () => {
		it('drops the prompt into the composer rather than sending it', () => {
			// The user should see what is being asked, and get to edit it, before
			// an agent acts on their app.
			const onTryExample = vi.fn();
			renderModal({ onTryExample });

			fireEvent.click(screen.getByTestId('agent-powers-example-change-any-setting'));
			expect(onTryExample).toHaveBeenCalledWith(expect.stringContaining('theme'));
		});

		it('closes after handing over an example', () => {
			const onTryExample = vi.fn();
			const { onDismiss } = renderModal({ onTryExample });

			fireEvent.click(screen.getByTestId('agent-powers-example-create-agents'));
			expect(onDismiss).toHaveBeenCalled();
		});

		it('renders the examples inert when there is no agent to talk to', () => {
			// A fresh install may have no agent yet; the examples still explain
			// the idea, they just cannot be handed anywhere.
			renderModal({ onTryExample: undefined });

			const example = screen.getByTestId('agent-powers-example-change-any-setting');
			expect(example).toBeDisabled();
		});

		it('mentions the composer only when an example can reach one', () => {
			const withAgent = renderModal({ onTryExample: vi.fn() });
			expect(screen.getByText(/drop it into the composer/i)).toBeInTheDocument();
			void withAgent;

			cleanup();
			renderModal({ onTryExample: undefined });
			expect(screen.queryByText(/drop it into the composer/i)).not.toBeInTheDocument();
		});
	});
});
