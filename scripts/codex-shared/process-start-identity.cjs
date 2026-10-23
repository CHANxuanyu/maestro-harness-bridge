'use strict';
const { execFileSync } = require('node:child_process');
// Compare complete local creation times, independent of the caller's locale.
// Legacy descriptors on Chinese-language macOS contain Darwin's zh_CN lstart format.
// Unknown formats fail closed. PID, command and socket identity remain separate checks.
function canonicalStart(value) {
	const s = String(value).trim();
	let m = s.match(
		/^\S+\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})\s+(\d{4})$/
	);
	if (m)
		return `${m[4]}-${String(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(m[1]) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}T${m[3]}`;
	m = s.match(/^\S+\s+(\d{1,2})月\/(\d{1,2})\s+(\d{2}:\d{2}:\d{2})\s+(\d{4})$/);
	if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31)
		return `${m[4]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}T${m[3]}`;
	throw Error('Unknown native process creation time format');
}
function readStart(pid) {
	return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], {
		encoding: 'utf8',
		env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
	}).trim();
}
module.exports = { canonicalStart, readStart };
