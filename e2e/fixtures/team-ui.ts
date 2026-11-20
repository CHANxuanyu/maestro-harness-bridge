import { expect, type Locator } from '@playwright/test';

/** Open history through its real disclosure controls, including nested phase folds. */
export async function revealTeamCard(card: Locator, expand = false) {
	await expect(card).toHaveCount(1);
	const closedAncestors = card.locator('xpath=ancestor::details[not(@open)]');
	while (await closedAncestors.count())
		await closedAncestors.first().locator(':scope > summary').click();
	if (
		expand &&
		(await card.evaluate(
			(element) => element.tagName === 'DETAILS' && !element.hasAttribute('open')
		))
	)
		await card.locator(':scope > summary').click();
	await card.scrollIntoViewIfNeeded();
	await expect(card).toBeVisible();
}
