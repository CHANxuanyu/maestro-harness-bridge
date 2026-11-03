import fs from 'fs';

/**
 * Read candidates for a local project, retaining its saved spelling as well
 * as the native process cwd. Missing or inaccessible projects keep their
 * saved path so archived history remains readable. Never use this for SSH.
 */
export function localProjectPathCandidates(projectPath: string): string[] {
	try {
		const physical = fs.realpathSync(projectPath);
		if (typeof physical === 'string' && physical !== projectPath) return [projectPath, physical];
	} catch {
		// Resolving a project must not make its existing history disappear.
	}
	return [projectPath];
}
