import type { DiffHunk, GitChangeKind, GitChangeRange } from './types';

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function parseRange(startText: string, countText: string | undefined): GitChangeRange {
	return {
		start: Number.parseInt(startText, 10),
		count: countText === undefined ? 1 : Number.parseInt(countText, 10),
	};
}

function classifyChangeKind(baseRange: GitChangeRange, currentRange: GitChangeRange): GitChangeKind {
	if (baseRange.count === 0 && currentRange.count > 0) {
		return 'insert';
	}

	if (baseRange.count > 0 && currentRange.count === 0) {
		return 'delete';
	}

	return 'modify';
}

export function parseUnifiedDiffHunks(diffText: string): DiffHunk[] {
	const hunks: DiffHunk[] = [];
	const lines = diffText.split(/\r?\n/u);

	for (const line of lines) {
		const match = HUNK_HEADER_PATTERN.exec(line);
		if (!match) {
			continue;
		}

		const baseRange = parseRange(match[1], match[2]);
		const currentRange = parseRange(match[3], match[4]);

		hunks.push({
			kind: classifyChangeKind(baseRange, currentRange),
			baseRange,
			currentRange,
			header: line,
		});
	}

	return hunks;
}

function rangeEnd(range: GitChangeRange): number {
	return range.start + range.count - 1;
}

function insertionPointOverlapsRange(point: number, range: GitChangeRange): boolean {
	if (range.count === 0) {
		return point === range.start;
	}

	return point >= range.start && point <= rangeEnd(range) + 1;
}

export function doBaseRangesOverlap(left: GitChangeRange, right: GitChangeRange): boolean {
	if (left.count === 0) {
		return insertionPointOverlapsRange(left.start, right);
	}

	if (right.count === 0) {
		return insertionPointOverlapsRange(right.start, left);
	}

	return left.start <= rangeEnd(right) && right.start <= rangeEnd(left);
}
