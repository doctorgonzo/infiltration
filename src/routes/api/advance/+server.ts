// ═══════════════════════════════════════════════════════════
// ADVANCE — Spend a character's pending level-up advancement
// POST { playerId, generalFeats[], classFeats[], abilityIncreases[], skillRanks{} }
// ═══════════════════════════════════════════════════════════

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCharacter, saveState, withPlayerLock } from '$lib/server/engine/state';
import {
	GENERAL_FEATS,
	CLASS_BONUS_FEATS,
	ALL_SKILLS,
	applyFeatBonuses,
	applyAbilityIncrease,
	maxSkillRank,
	isClassSkill,
	hasPendingAdvancement
} from '$lib/progression';
import type { AbilityName, Skill } from '$lib/types';

const ABILITIES: AbilityName[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { playerId } = body;
	if (!playerId) return json({ error: 'Missing playerId' }, { status: 400 });

	const character = getCharacter(playerId);
	if (!character) return json({ error: 'Unknown player. Join the game first.' }, { status: 401 });

	const pending = character.pendingAdvancement;
	if (!hasPendingAdvancement(pending) || !pending) {
		return json({ error: 'You have no pending advancement to spend.' }, { status: 409 });
	}

	const generalFeats: string[] = Array.isArray(body.generalFeats) ? body.generalFeats : [];
	const classFeats: string[] = Array.isArray(body.classFeats) ? body.classFeats : [];
	const abilityIncreases: string[] = Array.isArray(body.abilityIncreases) ? body.abilityIncreases : [];
	const skillRanks: Record<string, number> =
		body.skillRanks && typeof body.skillRanks === 'object' ? body.skillRanks : {};

	// ── Validate feats ─────────────────────────────────────
	const generalNames = new Set(GENERAL_FEATS.map((f) => f.name));
	const classNames = new Set((CLASS_BONUS_FEATS[character.class] ?? []).map((f) => f.name));
	const owned = new Set(character.feats);
	const chosen = new Set<string>();

	if (generalFeats.length !== pending.generalFeats) {
		return json({ error: `Choose exactly ${pending.generalFeats} general feat(s).` }, { status: 400 });
	}
	if (classFeats.length !== pending.classFeats) {
		return json({ error: `Choose exactly ${pending.classFeats} class feat(s).` }, { status: 400 });
	}
	for (const feat of generalFeats) {
		if (!generalNames.has(feat)) return json({ error: `Unknown general feat: ${feat}` }, { status: 400 });
		if (owned.has(feat) || chosen.has(feat)) return json({ error: `Duplicate feat: ${feat}` }, { status: 400 });
		chosen.add(feat);
	}
	for (const feat of classFeats) {
		if (!classNames.has(feat)) return json({ error: `${feat} isn't a ${character.class} bonus feat.` }, { status: 400 });
		if (owned.has(feat) || chosen.has(feat)) return json({ error: `Duplicate feat: ${feat}` }, { status: 400 });
		chosen.add(feat);
	}

	// ── Validate ability increases ─────────────────────────
	if (abilityIncreases.length !== pending.abilityPoints) {
		return json({ error: `Assign exactly ${pending.abilityPoints} ability point(s).` }, { status: 400 });
	}
	for (const ab of abilityIncreases) {
		if (!ABILITIES.includes(ab as AbilityName)) return json({ error: `Invalid ability: ${ab}` }, { status: 400 });
	}

	// ── Validate skill ranks (these are ranks to ADD) ──────
	let skillSpent = 0;
	for (const [skill, rawAmt] of Object.entries(skillRanks)) {
		if (!ALL_SKILLS.includes(skill as Skill)) return json({ error: `Unknown skill: ${skill}` }, { status: 400 });
		const add = Math.floor(Number(rawAmt) || 0);
		if (add < 0) return json({ error: `Can't remove skill ranks (${skill}).` }, { status: 400 });
		if (add === 0) continue;
		const current = character.skills[skill as Skill] ?? 0;
		const cap = maxSkillRank(character.level, isClassSkill(character.class, skill as Skill));
		if (current + add > cap) {
			return json({ error: `${skill} can't exceed rank ${cap} at level ${character.level}.` }, { status: 400 });
		}
		skillSpent += add;
	}
	if (skillSpent !== pending.skillPoints) {
		return json({ error: `Spend exactly ${pending.skillPoints} skill point(s); you spent ${skillSpent}.` }, { status: 400 });
	}

	// ── Apply atomically ───────────────────────────────────
	return withPlayerLock(playerId, async () => {
		for (const feat of [...generalFeats, ...classFeats]) {
			character.feats.push(feat);
			applyFeatBonuses(character, feat);
		}
		for (const ab of abilityIncreases) {
			applyAbilityIncrease(character, ab as AbilityName);
		}
		for (const [skill, rawAmt] of Object.entries(skillRanks)) {
			const add = Math.floor(Number(rawAmt) || 0);
			if (add > 0) character.skills[skill as Skill] = (character.skills[skill as Skill] ?? 0) + add;
		}
		delete character.pendingAdvancement;
		saveState();
		return json({ character });
	});
};
