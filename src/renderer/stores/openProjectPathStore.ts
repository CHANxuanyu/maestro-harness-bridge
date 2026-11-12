import { create } from 'zustand';

/**
 * Whether the "Open project" path prompt is showing. A browser or phone has no
 * native folder dialog: `dialog.selectFolder` would open one on the computer
 * running Maestro, where nobody holding the phone can see it. `chooseProject()`
 * opens this prompt instead, so every "Open project" entry behaves the same in
 * the browser. Kept apart from the modal so the service does not import a
 * component.
 */
export const useOpenProjectPathStore = create<{
	open: boolean;
	setOpen: (open: boolean) => void;
}>((set) => ({ open: false, setOpen: (open) => set({ open }) }));
