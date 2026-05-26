// ═══════════════════════════════════════════════════════════
// d20 Dice Engine
// ═══════════════════════════════════════════════════════════

export interface RollResult {
	dice: string;         // "1d20", "2d6", etc.
	rolls: number[];      // individual die results
	natural: number;      // sum of dice (before modifier)
	modifier: number;
	total: number;
	criticalHit: boolean;
	criticalMiss: boolean;
}

/**
 * Roll dice. Format: "1d20", "2d6+3", "1d8-1"
 */
export function roll(expression: string): RollResult {
	const match = expression.match(/^(\d+)d(\d+)([+-]\d+)?$/);
	if (!match) {
		return { dice: expression, rolls: [0], natural: 0, modifier: 0, total: 0, criticalHit: false, criticalMiss: false };
	}

	const count = parseInt(match[1]);
	const sides = parseInt(match[2]);
	const modifier = match[3] ? parseInt(match[3]) : 0;

	const rolls: number[] = [];
	for (let i = 0; i < count; i++) {
		rolls.push(Math.floor(Math.random() * sides) + 1);
	}

	const natural = rolls.reduce((a, b) => a + b, 0);
	const total = natural + modifier;

	return {
		dice: expression,
		rolls,
		natural,
		modifier,
		total,
		criticalHit: count === 1 && sides === 20 && natural === 20,
		criticalMiss: count === 1 && sides === 20 && natural === 1
	};
}

/**
 * Roll a d20 with modifier
 */
export function d20(modifier = 0): RollResult {
	return roll(`1d20${modifier >= 0 ? '+' + modifier : modifier}`);
}

/**
 * Get ability modifier from score (standard d20 formula)
 */
export function abilityModifier(score: number): number {
	return Math.floor((score - 10) / 2);
}

/**
 * Roll 4d6 drop lowest for ability score generation
 */
export function rollAbilityScore(): { rolls: number[]; dropped: number; total: number } {
	const rolls = Array.from({ length: 4 }, () => Math.floor(Math.random() * 6) + 1);
	rolls.sort((a, b) => b - a);
	const dropped = rolls[3];
	const total = rolls[0] + rolls[1] + rolls[2];
	return { rolls, dropped, total };
}

/**
 * Roll initiative: d20 + DEX modifier
 */
export function rollInitiative(dexModifier: number): RollResult {
	return d20(dexModifier);
}

/**
 * Skill check: d20 + skill ranks + ability modifier vs DC
 */
export function skillCheck(
	skillRanks: number,
	abilityMod: number,
	dc: number,
	miscModifier = 0
): { roll: RollResult; success: boolean; margin: number } {
	const totalModifier = skillRanks + abilityMod + miscModifier;
	const result = d20(totalModifier);
	const success = result.total >= dc || result.criticalHit;
	return {
		roll: result,
		success: success && !result.criticalMiss,
		margin: result.total - dc
	};
}

/**
 * Attack roll: d20 + attack bonus vs AC
 */
export function attackRoll(
	attackBonus: number,
	targetAC: number,
	critRange = 20,
	critMultiplier = 2
): { roll: RollResult; hit: boolean; critical: boolean } {
	const result = d20(attackBonus);

	if (result.criticalMiss) {
		return { roll: result, hit: false, critical: false };
	}

	const naturalHit = result.natural >= critRange;
	const hit = result.total >= targetAC || result.criticalHit;

	// Confirm critical with second roll
	let critical = false;
	if (naturalHit && hit) {
		const confirm = d20(attackBonus);
		critical = confirm.total >= targetAC;
	}

	return { roll: result, hit, critical };
}

/**
 * Saving throw: d20 + save bonus vs DC
 */
export function savingThrow(
	saveBonus: number,
	dc: number
): { roll: RollResult; success: boolean } {
	const result = d20(saveBonus);
	return {
		roll: result,
		success: (result.total >= dc && !result.criticalMiss) || result.criticalHit
	};
}

/**
 * Roll damage: e.g. "2d6+3"
 */
export function rollDamage(expression: string, critical = false, critMultiplier = 2): RollResult {
	const result = roll(expression);
	if (critical) {
		// Roll additional damage dice for critical
		for (let i = 1; i < critMultiplier; i++) {
			const extra = roll(expression);
			result.rolls.push(...extra.rolls);
			result.natural += extra.natural;
			result.total += extra.natural; // Only dice are multiplied, not modifier
		}
	}
	return result;
}
