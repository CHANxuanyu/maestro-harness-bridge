export function distribution(values) {
	const sorted = [...values].sort((a, b) => a - b);
	if (!sorted.length) return null;
	const middle = Math.floor(sorted.length / 2);
	return {
		n: sorted.length,
		median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
		p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
	};
}

export function summarize(samples) {
	const grouped = {};
	for (const sample of samples) {
		for (const [name, metric] of Object.entries(sample.metrics)) {
			const key = `${sample.variant}:${name}`;
			(grouped[key] ??= []).push(metric);
		}
	}
	return Object.fromEntries(
		Object.entries(grouped).map(([key, rows]) => [
			key,
			Object.fromEntries(
				Object.keys(rows[0])
					.filter((field) => typeof rows[0][field] === 'number')
					.map((field) => [field, distribution(rows.map((row) => row[field]))])
			),
		])
	);
}
