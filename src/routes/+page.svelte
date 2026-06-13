<script lang="ts">
	import type { Character, GameLogEntry } from '$lib/types';
	import { onMount } from 'svelte';

	// ── State ──────────────────────────────────────────────
	type Phase = 'name' | 'select' | 'create' | 'play' | 'dead';
	let phase = $state<Phase>('name');
	let playerId = $state<string | null>(null);
	let character = $state<Character | null>(null);
	let messages = $state<GameLogEntry[]>([]);
	let input = $state('');
	let isLoading = $state(false);
	let sidebarOpen = $state(true);
	let worldTime = $state<string>('');
	let dayNumber = $state<number>(0);
	let invasionLevel = $state<number>(0);
	let daysToCollapse = $state<number | null>(null);
	let gameOver = $state<{ result: 'won' | 'lost'; reason: string; invasionAtEnd: number; dayAtEnd: number } | null>(null);
	let quests = $state<Array<{id: string; name: string; description: string; status: string; objectives: Array<{description: string; complete: boolean}>}>>([]);
	let questsOpen = $state(true);
	let eventSource: EventSource | null = null;
	let logContainer: HTMLDivElement | undefined = $state();

	// ── Level-Up Celebration ──────────────────────────────
	let lastKnownLevel = $state(0);
	let showLevelUp = $state(false);
	let levelUpNumber = $state(0);
	let levelUpTimeout: ReturnType<typeof setTimeout> | null = null;

	function triggerLevelUp(level: number) {
		levelUpNumber = level;
		showLevelUp = true;
		if (levelUpTimeout) clearTimeout(levelUpTimeout);
		levelUpTimeout = setTimeout(() => {
			showLevelUp = false;
			levelUpTimeout = null;
		}, 4000);
	}

	function dismissLevelUp() {
		showLevelUp = false;
		if (levelUpTimeout) { clearTimeout(levelUpTimeout); levelUpTimeout = null; }
	}

	// ── Player Identity ────────────────────────────────────
	let playerName = $state('');
	let existingCharacters = $state<Array<{
		id: string; name: string; class: string; level: number;
		hp: number; maxHp: number; location: string; alive: boolean; active: boolean;
		xp: number; wealth: number;
	}>>([]);
	let isLoadingCharacters = $state(false);
	let deletingCharacterId = $state<string | null>(null);
	let deleteCharacterError = $state('');

	// ── Session Tracking ──────────────────────────────────
	let sessionStartTime = $state<number>(0);
	let sessionStartXp = $state<number>(0);
	let sessionStartKills = $state<number>(0);
	let sessionStartDamageDealt = $state<number>(0);
	let sessionStartDamageTaken = $state<number>(0);
	let sessionStartItemsFound = $state<number>(0);
	let sessionStartActions = $state<number>(0);
	let showSessionSummary = $state(false);

	function captureSessionStart(char: Character) {
		sessionStartTime = Date.now();
		sessionStartXp = char.xp ?? 0;
		sessionStartKills = char.stats?.enemiesKilled ?? 0;
		sessionStartDamageDealt = char.stats?.damageDealt ?? 0;
		sessionStartDamageTaken = char.stats?.damageTaken ?? 0;
		sessionStartItemsFound = char.stats?.itemsFound ?? 0;
		sessionStartActions = char.stats?.actionsPerformed ?? 0;
	}

	// ── Character Creation ─────────────────────────────────
	let characterName = $state('');
	let selectedClass = $state<string>('Strong Hero');
	let joinError = $state('');
	let isJoining = $state(false);

	// ── Stat Rolling & Feat Selection ─────────────────────
	type CreationStep = 'basics' | 'stats' | 'feats';
	let creationStep = $state<CreationStep>('basics');
	let useTemplate = $state(true); // true = auto-assign stats from class, false = 4d6 roll

	type AbilityKey = 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA';
	interface StatRoll {
		rolls: number[];   // the 4 dice
		dropped: number;   // which was dropped
		total: number;     // sum of kept 3
		locked: boolean;   // has been rolled
	}
	let rolledStats = $state<Record<AbilityKey, StatRoll>>({
		STR: { rolls: [], dropped: 0, total: 0, locked: false },
		DEX: { rolls: [], dropped: 0, total: 0, locked: false },
		CON: { rolls: [], dropped: 0, total: 0, locked: false },
		INT: { rolls: [], dropped: 0, total: 0, locked: false },
		WIS: { rolls: [], dropped: 0, total: 0, locked: false },
		CHA: { rolls: [], dropped: 0, total: 0, locked: false }
	});

	const ABILITY_LABELS: Record<AbilityKey, string> = {
		STR: 'STRENGTH', DEX: 'DEXTERITY', CON: 'CONSTITUTION',
		INT: 'INTELLIGENCE', WIS: 'WISDOM', CHA: 'CHARISMA'
	};

	function rollStat(key: AbilityKey) {
		const dice = Array.from({ length: 4 }, () => Math.floor(Math.random() * 6) + 1);
		dice.sort((a, b) => b - a);
		rolledStats[key] = {
			rolls: [...dice],
			dropped: dice[3],
			total: dice[0] + dice[1] + dice[2],
			locked: true
		};
	}

	function rollAllStats() {
		const keys: AbilityKey[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
		for (const key of keys) {
			if (!rolledStats[key].locked) rollStat(key);
		}
	}

	function rerollAllStats() {
		const keys: AbilityKey[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
		for (const key of keys) {
			rolledStats[key] = { rolls: [], dropped: 0, total: 0, locked: false };
		}
	}

	let allStatsRolled = $derived(
		Object.values(rolledStats).every(s => s.locked)
	);

	// ── Feats ─────────────────────────────────────────────
	interface FeatOption {
		name: string;
		desc: string;
		prereq?: string;
	}

	const GENERAL_FEATS: FeatOption[] = [
		{ name: 'Alertness', desc: '+2 Listen and Spot checks' },
		{ name: 'Brawl', desc: '+1 unarmed attack, 1d6 unarmed damage' },
		{ name: 'Cautious', desc: '+2 Demolitions and Disable Device' },
		{ name: 'Combat Martial Arts', desc: '+1 unarmed, 1d4 lethal unarmed damage', prereq: 'BAB +1' },
		{ name: 'Confident', desc: '+2 Gamble and Intimidate' },
		{ name: 'Creative', desc: '+2 Craft and Perform' },
		{ name: 'Deceptive', desc: '+2 Bluff and Disguise' },
		{ name: 'Dodge', desc: '+1 dodge bonus to AC vs. chosen target' },
		{ name: 'Educated', desc: '+2 to any two Knowledge skills' },
		{ name: 'Endurance', desc: '+4 on extended physical activity checks' },
		{ name: 'Focused', desc: '+2 to any two skills of your choice' },
		{ name: 'Great Fortitude', desc: '+2 Fortitude saves' },
		{ name: 'Guide', desc: '+2 Navigate and Survival' },
		{ name: 'Improved Initiative', desc: '+4 Initiative rolls' },
		{ name: 'Iron Will', desc: '+2 Will saves' },
		{ name: 'Lightning Reflexes', desc: '+2 Reflex saves' },
		{ name: 'Low Profile', desc: '+2 Hide, less likely to be recognized' },
		{ name: 'Meticulous', desc: '+2 Investigate and Search' },
		{ name: 'Nimble', desc: '+2 Escape Artist and Sleight of Hand' },
		{ name: 'Point Blank Shot', desc: '+1 attack and damage within 30 ft.' },
		{ name: 'Power Attack', desc: 'Trade attack bonus for melee damage' },
		{ name: 'Stealthy', desc: '+2 Hide and Move Silently' },
		{ name: 'Studious', desc: '+2 Decipher Script and Research' },
		{ name: 'Toughness', desc: '+3 hit points' },
		{ name: 'Trustworthy', desc: '+2 Diplomacy and Gather Information' }
	];

	const CLASS_BONUS_FEATS: Record<string, FeatOption[]> = {
		'Strong Hero': [
			{ name: 'Animal Affinity', desc: '+2 Handle Animal and Ride' },
			{ name: 'Archaic Weapons Proficiency', desc: 'No penalty with swords, axes, etc.' },
			{ name: 'Brawl', desc: '+1 unarmed attack, 1d6 unarmed damage' },
			{ name: 'Cleave', desc: 'Extra melee attack after dropping a foe', prereq: 'Power Attack' },
			{ name: 'Combat Reflexes', desc: 'Additional attacks of opportunity' },
			{ name: 'Great Cleave', desc: 'Unlimited cleave attacks per round', prereq: 'Cleave' },
			{ name: 'Improved Brawl', desc: '+2 unarmed, 1d8 unarmed damage', prereq: 'Brawl' },
			{ name: 'Power Attack', desc: 'Trade attack bonus for melee damage' }
		],
		'Fast Hero': [
			{ name: 'Combat Reflexes', desc: 'Additional attacks of opportunity' },
			{ name: 'Dodge', desc: '+1 dodge bonus to AC vs. chosen target' },
			{ name: 'Double Tap', desc: '+1 damage with firearms at close range', prereq: 'Point Blank Shot' },
			{ name: 'Mobility', desc: '+4 AC vs. attacks of opportunity from movement', prereq: 'Dodge' },
			{ name: 'Point Blank Shot', desc: '+1 attack and damage within 30 ft.' },
			{ name: 'Stealthy', desc: '+2 Hide and Move Silently' }
		],
		'Tough Hero': [
			{ name: 'Alertness', desc: '+2 Listen and Spot checks' },
			{ name: 'Brawl', desc: '+1 unarmed attack, 1d6 unarmed damage' },
			{ name: 'Endurance', desc: '+4 on extended physical activity checks' },
			{ name: 'Great Fortitude', desc: '+2 Fortitude saves' },
			{ name: 'Improved Damage Threshold', desc: '+3 massive damage threshold' },
			{ name: 'Toughness', desc: '+3 hit points' }
		],
		'Smart Hero': [
			{ name: 'Cautious', desc: '+2 Demolitions and Disable Device' },
			{ name: 'Educated', desc: '+2 to any two Knowledge skills' },
			{ name: 'Meticulous', desc: '+2 Investigate and Search' },
			{ name: 'Studious', desc: '+2 Decipher Script and Research' },
			{ name: 'Vehicle Expert', desc: '+2 Drive and Pilot' }
		],
		'Dedicated Hero': [
			{ name: 'Alertness', desc: '+2 Listen and Spot checks' },
			{ name: 'Attentive', desc: '+2 Investigate and Sense Motive' },
			{ name: 'Educated', desc: '+2 to any two Knowledge skills' },
			{ name: 'Focused', desc: '+2 to any two skills of your choice' },
			{ name: 'Iron Will', desc: '+2 Will saves' },
			{ name: 'Studious', desc: '+2 Decipher Script and Research' }
		],
		'Charismatic Hero': [
			{ name: 'Confident', desc: '+2 Gamble and Intimidate' },
			{ name: 'Creative', desc: '+2 Craft and Perform' },
			{ name: 'Deceptive', desc: '+2 Bluff and Disguise' },
			{ name: 'Dodge', desc: '+1 dodge bonus to AC vs. chosen target' },
			{ name: 'Trustworthy', desc: '+2 Diplomacy and Gather Information' },
			{ name: 'Windfall', desc: 'Start with extra wealth' }
		]
	};

	let selectedGeneralFeat = $state<string>('');
	let selectedBonusFeat = $state<string>('');

	// ── Slash Commands ────────────────────────────────────
	interface SlashCommand {
		command: string;
		label: string;
		description: string;
		category: 'action' | 'skill' | 'info';
		rank?: number;
	}

	const BASE_COMMANDS: SlashCommand[] = [
		{ command: '/look', label: 'Look', description: 'Examine your surroundings', category: 'action' },
		{ command: '/attack', label: 'Attack', description: 'Attack a target', category: 'action' },
		{ command: '/move', label: 'Move', description: 'Travel to a location', category: 'action' },
		{ command: '/use', label: 'Use', description: 'Use an item', category: 'action' },
		{ command: '/equip', label: 'Equip', description: 'Equip a weapon', category: 'action' },
		{ command: '/talk', label: 'Talk', description: 'Talk to someone', category: 'action' },
		{ command: '/rest', label: 'Rest', description: 'Take a breather', category: 'action' },
		{ command: '/pickup', label: 'Pick Up', description: 'Grab an item', category: 'action' },
		{ command: '/inventory', label: 'Inventory', description: 'Check your inventory', category: 'info' },
		{ command: '/stats', label: 'Stats', description: 'View character sheet', category: 'info' },
		{ command: '/admin', label: 'Admin', description: 'Toggle god mode (1000 HP, always nat 20)', category: 'info' },
		{ command: '/start', label: 'Start Scene', description: 'Enter romance mode', category: 'info' },
		{ command: '/end', label: 'End Scene', description: 'Exit romance mode', category: 'info' },
		{ command: '/party', label: 'Party', description: 'Show party info', category: 'info' },
		{ command: '/party create', label: 'Create Party', description: 'Form a new party', category: 'info' },
		{ command: '/party invite', label: 'Invite', description: 'Invite a player to your party', category: 'info' },
		{ command: '/party join', label: 'Join Party', description: 'Accept a party invite', category: 'info' },
		{ command: '/party leave', label: 'Leave Party', description: 'Leave your current party', category: 'info' },
		{ command: '/party disband', label: 'Disband', description: 'Disband party (leader only)', category: 'info' },
		{ command: '/party kick', label: 'Kick', description: 'Remove a player from party', category: 'info' },
	];

	const ALL_SKILLS = [
		'Balance', 'Bluff', 'Climb', 'Computer Use', 'Concentration', 'Craft',
		'Demolitions', 'Diplomacy', 'Disable Device', 'Disguise', 'Drive',
		'Escape Artist', 'Forgery', 'Gamble', 'Gather Information', 'Handle Animal',
		'Hide', 'Intimidate', 'Investigate', 'Jump', 'Knowledge (Arcane)',
		'Knowledge (Current Events)', 'Knowledge (Streetwise)', 'Knowledge (Technology)',
		'Listen', 'Move Silently', 'Navigate', 'Perception', 'Perform', 'Pilot',
		'Profession', 'Repair', 'Research', 'Search', 'Sense Motive',
		'Sleight of Hand', 'Spot', 'Survival', 'Swim', 'Treat Injury', 'Tumble'
	];

	function skillToCommand(skill: string): string {
		return '/' + skill.toLowerCase().replace(/[()]/g, '').replace(/\s+/g, '-');
	}

	let selectedCmdIdx = $state(0);

	let allCommands = $derived.by(() => {
		const cmds: SlashCommand[] = [...BASE_COMMANDS];
		if (character) {
			for (const skill of ALL_SKILLS) {
				const rank = (character.skills as Record<string, number>)[skill] ?? 0;
				cmds.push({
					command: skillToCommand(skill),
					label: skill,
					description: rank > 0 ? skill + ' check (+' + rank + ')' : skill + ' check (untrained)',
					category: 'skill',
					rank
				});
			}
		}
		cmds.sort((a, b) => {
			const order = { action: 0, skill: 1, info: 2 };
			if (order[a.category] !== order[b.category]) return order[a.category] - order[b.category];
			if (a.category === 'skill' && b.category === 'skill') {
				if ((a.rank ?? 0) > 0 && (b.rank ?? 0) === 0) return -1;
				if ((a.rank ?? 0) === 0 && (b.rank ?? 0) > 0) return 1;
			}
			return a.label.localeCompare(b.label);
		});
		return cmds;
	});

	let cmdMatch = $derived(input.match(/^\/(\S*)$/));
	let showCommands = $derived(cmdMatch !== null && !isLoading);
	let cmdFilter = $derived(cmdMatch ? cmdMatch[1].toLowerCase() : '');
	let filteredCommands = $derived.by(() => {
		if (!showCommands) return [];
		return allCommands.filter(c => {
			const name = c.command.slice(1);
			return name.startsWith(cmdFilter) || c.label.toLowerCase().startsWith(cmdFilter);
		}).slice(0, 10);
	});

	$effect(() => {
		cmdFilter;
		selectedCmdIdx = 0;
	});

	function selectCommand(cmd: SlashCommand) {
		input = cmd.command + ' ';
	}

	// ── Character Creation ─────────────────────────────────
	const heroClasses = [
		{ name: 'Strong Hero', key: 'STR', desc: 'Melee combat, feats of strength. The bat-swinger.', emoji: '💪' },
		{ name: 'Fast Hero', key: 'DEX', desc: 'Agility, stealth, reflexes. Hard to hit, hard to find.', emoji: '⚡' },
		{ name: 'Tough Hero', key: 'CON', desc: 'Takes a beating and keeps going. Wisconsin stubbornness personified.', emoji: '🛡️' },
		{ name: 'Smart Hero', key: 'INT', desc: 'Hacking, devices, research. The one who figures it out.', emoji: '🧠' },
		{ name: 'Dedicated Hero', key: 'WIS', desc: 'Perception, medicine, insight. Sees what others miss.', emoji: '👁️' },
		{ name: 'Charismatic Hero', key: 'CHA', desc: 'Persuasion, deception, leadership. Talks their way through.', emoji: '🎭' }
	];

	// ── Actions ────────────────────────────────────────────

	function logEntryKey(entry: GameLogEntry): string {
		return [
			entry.timestamp,
			entry.type,
			entry.actor ?? '',
			entry.text
		].join('|');
	}

	function resetMessages() {
		messages = [];
	}

	function appendEntries(entries: unknown) {
		if (!Array.isArray(entries)) return;

		const seen = new Set(messages.map(logEntryKey));
		const nextEntries = entries.filter((entry): entry is GameLogEntry => {
			if (!entry || typeof entry !== 'object') return false;
			const candidate = entry as GameLogEntry;
			if (!candidate.timestamp || !candidate.type || !candidate.text) return false;
			const key = logEntryKey(candidate);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});

		if (nextEntries.length > 0) {
			messages = [...messages, ...nextEntries];
			scrollToBottom();

			// Detect level-up log entries and trigger celebration
			for (const entry of nextEntries) {
				if (entry.type === 'system' && entry.text.includes('LEVEL UP')) {
					const lvMatch = entry.text.match(/Level\s+(\d+)/i);
					if (lvMatch) triggerLevelUp(parseInt(lvMatch[1], 10));
				}
			}
		}
	}

	function appendEntry(entry: GameLogEntry) {
		appendEntries([entry]);
	}

	async function enterName() {
		if (!playerName.trim()) return;
		localStorage.setItem('infiltration_playerName', playerName.trim());
		await loadCharacters();
	}

	async function loadCharacters() {
		isLoadingCharacters = true;
		deleteCharacterError = '';
		try {
			const res = await fetch(`/api/characters?playerName=${encodeURIComponent(playerName.trim())}`);
			const data = await res.json();
			existingCharacters = data.characters ?? [];
			phase = 'select';
		} catch {
			existingCharacters = [];
			phase = 'select';
		} finally {
			isLoadingCharacters = false;
		}
	}

	async function requestDeleteCharacter(charId: string, charName: string) {
		if (deletingCharacterId) return;
		if (!confirm(`Delete ${charName} permanently? This cannot be undone.`)) return;

		deletingCharacterId = charId;
		deleteCharacterError = '';
		try {
			const res = await fetch('/api/characters', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					playerName: playerName.trim(),
					characterId: charId
				})
			});
			const data = await res.json();

			if (!res.ok) {
				deleteCharacterError = data.error || 'Could not delete that character.';
				return;
			}

			existingCharacters = existingCharacters.filter(char => char.id !== charId);
			if (playerId === charId) {
				localStorage.removeItem('infiltration_playerId');
				playerId = null;
				character = null;
				resetMessages();
			}
		} catch {
			deleteCharacterError = 'Connection failed. Try again.';
		} finally {
			deletingCharacterId = null;
		}
	}

	function selectCharacter(charId: string) {
		playerId = charId;
		localStorage.setItem('infiltration_playerId', charId);

		// Fetch full character state and enter game
		fetch(`/api/state?playerId=${charId}`)
			.then(r => r.json())
			.then(data => {
				if (data.character) {
					character = data.character;
					lastKnownLevel = data.character.level;
					if (data.worldTime) worldTime = data.worldTime;
					if (data.dayNumber != null) dayNumber = data.dayNumber;
					resetMessages();
					captureSessionStart(data.character);
					phase = 'play';
					connectStream();
				}
			});
	}

	function goToCreate() {
		characterName = '';
		selectedClass = 'Strong Hero';
		joinError = '';
		creationStep = 'basics';
		useTemplate = true;
		rerollAllStats();
		selectedGeneralFeat = '';
		selectedBonusFeat = '';
		phase = 'create';
	}

	function advanceCreation() {
		if (creationStep === 'basics') {
			if (!characterName.trim()) {
				joinError = 'Your character needs a name.';
				return;
			}
			joinError = '';
			if (useTemplate) {
				// Skip stat rolling — server auto-assigns from class template
				creationStep = 'feats';
			} else {
				creationStep = 'stats';
			}
		} else if (creationStep === 'stats') {
			if (!allStatsRolled) {
				joinError = 'Roll all your stats first.';
				return;
			}
			joinError = '';
			creationStep = 'feats';
		} else if (creationStep === 'feats') {
			createCharacter();
		}
	}

	async function createCharacter() {
		if (!selectedGeneralFeat) {
			joinError = 'Pick a general feat.';
			return;
		}
		if (!selectedBonusFeat) {
			joinError = 'Pick a class bonus feat.';
			return;
		}

		isJoining = true;
		joinError = '';

		// Build abilities from rolled stats (only if manually rolled)
		let abilities: Record<string, number> | undefined;
		if (!useTemplate) {
			abilities = {};
			for (const [key, stat] of Object.entries(rolledStats)) {
				abilities[key] = stat.total;
			}
		}

		try {
			const res = await fetch('/api/join', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					playerName: playerName.trim(),
					characterName: characterName.trim(),
					heroClass: selectedClass,
					...(abilities ? { abilities } : {}),
					feats: [selectedGeneralFeat, selectedBonusFeat]
				})
			});

			const data = await res.json();

			if (!res.ok) {
				joinError = data.error || 'Failed to join. The Director is unresponsive.';
				return;
			}

			playerId = data.playerId;
			character = data.character;
			lastKnownLevel = data.character?.level ?? 1;

			localStorage.setItem('infiltration_playerId', data.playerId);
			localStorage.setItem('infiltration_playerName', playerName.trim());

			resetMessages();
			captureSessionStart(data.character);
			phase = 'play';
			connectStream(true);

			// Auto-fire a /look so the Director narrates the opening scene
			setTimeout(() => {
				if (playerId) {
					fetch('/api/action', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ playerId, action: '/look' })
					})
						.then((res) => res.json())
						.then((data) => appendEntries(data.entries))
						.catch(() => {});
				}
			}, 500);
		} catch (e) {
			joinError = 'Connection failed. Is the server running?';
		} finally {
			isJoining = false;
		}
	}

	async function submitAction() {
		if (!input.trim() || !playerId || isLoading) return;

		const action = input.trim();
		input = '';
		isLoading = true;

		try {
			const res = await fetch('/api/action', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ playerId, action })
			});

			const data = await res.json();
			appendEntries(data.entries);

			if (!res.ok) {
				appendEntry({
					timestamp: new Date().toISOString(),
					type: 'system',
					text: data.error || 'Action failed.'
				});
			}
			await refreshState();
		} catch (e) {
			appendEntry({
				timestamp: new Date().toISOString(),
				type: 'system',
				text: 'Connection lost. Try again.'
			});
		} finally {
			isLoading = false;
		}
	}

	function connectStream(fresh = false) {
		if (eventSource) eventSource.close();

		const params = new URLSearchParams();
		if (fresh) params.set('fresh', '1');
		if (playerId) params.set('playerId', playerId);
		const qs = params.toString();
		eventSource = new EventSource(`/api/stream${qs ? '?' + qs : ''}`);

		eventSource.onmessage = (event) => {
			try {
				const entry: GameLogEntry = JSON.parse(event.data);
				// Client-side safety filter: skip entries not meant for this player
				if (entry.targetPlayer && entry.targetPlayer !== playerId) return;
				if (entry.targetParty && (!character?.partyId || entry.targetParty !== character.partyId)) return;
				appendEntry(entry);
			} catch {}
		};

		eventSource.onerror = () => {
			console.log('[stream] Connection interrupted, reconnecting...');
		};
	}

	function switchCharacter() {
		// Show session summary before switching
		showSessionSummary = true;
	}

	function confirmSwitchCharacter() {
		showSessionSummary = false;
		// Deactivate current character
		if (playerId) {
			fetch('/api/logout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ playerId })
			}).catch(() => {});
		}
		if (eventSource) eventSource.close();
		eventSource = null;
		localStorage.removeItem('infiltration_playerId');
		playerId = null;
		character = null;
		resetMessages();
		// Keep playerName — go back to character select, not name entry
		loadCharacters();
	}

	function fullLogout() {
		if (playerId) {
			fetch('/api/logout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ playerId })
			}).catch(() => {});
		}
		if (eventSource) eventSource.close();
		eventSource = null;
		localStorage.removeItem('infiltration_playerId');
		localStorage.removeItem('infiltration_playerName');
		playerId = null;
		character = null;
		resetMessages();
		playerName = '';
		existingCharacters = [];
		phase = 'name';
	}

	async function refreshState() {
		if (!playerId) return;
		try {
			const res = await fetch(`/api/state?playerId=${playerId}`);
			const data = await res.json();
			if (data.worldTime) worldTime = data.worldTime;
			if (data.dayNumber != null) dayNumber = data.dayNumber;
			if (data.invasionLevel != null) invasionLevel = data.invasionLevel;
			if (data.daysToCollapse != null) daysToCollapse = data.daysToCollapse;
			gameOver = data.gameOver ?? null;
			if (data.character) {
				// Detect level-up via state poll
				if (lastKnownLevel > 0 && data.character.level > lastKnownLevel) {
					triggerLevelUp(data.character.level);
				}
				lastKnownLevel = data.character.level;
				character = data.character;
				// Detect death
				if (!data.character.alive && phase === 'play') {
					phase = 'dead';
				}
			}
			if (data.quests) {
				quests = Object.values(data.quests);
			}
		} catch {}
	}

	function scrollToBottom() {
		requestAnimationFrame(() => {
			if (logContainer) {
				logContainer.scrollTop = logContainer.scrollHeight;
			}
		});
	}

	function handleKeydown(event: KeyboardEvent) {
		if (showCommands && filteredCommands.length > 0) {
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				selectedCmdIdx = (selectedCmdIdx + 1) % filteredCommands.length;
				return;
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				selectedCmdIdx = (selectedCmdIdx - 1 + filteredCommands.length) % filteredCommands.length;
				return;
			}
			if (event.key === 'Tab') {
				event.preventDefault();
				selectCommand(filteredCommands[selectedCmdIdx]);
				return;
			}
			if (event.key === 'Enter') {
				event.preventDefault();
				selectCommand(filteredCommands[selectedCmdIdx]);
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				input = '';
				return;
			}
		} else if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			submitAction();
		}
	}

	function formatTime(timestamp: string): string {
		return new Date(timestamp).toLocaleTimeString('en-US', {
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function getEntryClass(type: string): string {
		switch (type) {
			case 'narration': return 'entry-narration';
			case 'action': return 'entry-action';
			case 'combat': return 'entry-combat';
			case 'system': return 'entry-system';
			case 'dialogue': return 'entry-dialogue';
			case 'roll': return 'entry-roll';
			default: return '';
		}
	}

	function getDrunkClass(): string {
		const level = character?.inebriation ?? 0;
		if (level <= 0) return '';
		if (level <= 2) return 'drunk-buzzed';
		if (level <= 4) return 'drunk-tipsy';
		if (level <= 6) return 'drunk-hammered';
		if (level <= 8) return 'drunk-wasted';
		return 'drunk-obliterated';
	}

	function abilityMod(score: number): string {
		const mod = Math.floor((score - 10) / 2);
		return mod >= 0 ? `+${mod}` : `${mod}`;
	}

	// ── Lifecycle ──────────────────────────────────────────
	onMount(() => {
		const savedName = localStorage.getItem('infiltration_playerName');
		const savedId = localStorage.getItem('infiltration_playerId');

		if (savedName) {
			playerName = savedName;
		}

		if (savedId && savedName) {
			// Try to reconnect to last character
			playerId = savedId;
			fetch(`/api/state?playerId=${savedId}`)
				.then(r => r.json())
				.then(data => {
					if (data.character) {
						character = data.character;
						lastKnownLevel = data.character.level;
						if (data.worldTime) worldTime = data.worldTime;
						if (data.dayNumber != null) dayNumber = data.dayNumber;
						resetMessages();
						captureSessionStart(data.character);
						phase = 'play';
						connectStream();
					} else {
						// Character gone — go to select screen
						localStorage.removeItem('infiltration_playerId');
						playerId = null;
						loadCharacters();
					}
				})
				.catch(() => {
					localStorage.removeItem('infiltration_playerId');
					playerId = null;
					if (savedName) loadCharacters();
				});
		} else if (savedName) {
			// Have a name but no active character — show select
			loadCharacters();
		}

		return () => {
			if (eventSource) eventSource.close();
		};
	});

	// Auto-scroll when messages change
	$effect(() => {
		if (messages.length > 0) {
			scrollToBottom();
		}
	});

	// Periodic state refresh
	$effect(() => {
		if (phase === 'play' && playerId) {
			const interval = setInterval(refreshState, 15000);
			return () => clearInterval(interval);
		}
	});
</script>

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- NAME ENTRY SCREEN                                          -->
<!-- ═══════════════════════════════════════════════════════════ -->

{#if phase === 'name'}
<div class="join-screen">
	<div class="join-container">
		<div class="title-block">
			<h1 class="title">INFILTRATION</h1>
			<p class="subtitle">Madison, Wisconsin — d20 Modern</p>
			<div class="title-rule"></div>
			<p class="tagline">Something is wrong. The city council voted unanimously.<br/>That never happens.</p>
		</div>

		<div class="join-form">
			<div class="form-group">
				<label for="playerName">YOUR NAME</label>
				<input
					id="playerName"
					type="text"
					bind:value={playerName}
					placeholder="Who are you, really?"
					maxlength="30"
					onkeydown={(e) => e.key === 'Enter' && enterName()}
				/>
			</div>

			<button
				class="join-button"
				onclick={enterName}
				disabled={!playerName.trim() || isLoadingCharacters}
			>
				{#if isLoadingCharacters}
					<span class="loading-dots">CONNECTING</span>
				{:else}
					CONTINUE
				{/if}
			</button>
		</div>

		<div class="join-footer">
			<p>One server. One world. Always running.</p>
			<p class="footer-sub">d20 Modern SRD | Persistent multiplayer text adventure</p>
		</div>
	</div>
</div>

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- CHARACTER SELECT SCREEN                                    -->
<!-- ═══════════════════════════════════════════════════════════ -->

{:else if phase === 'select'}
<div class="join-screen">
	<div class="join-container">
		<div class="title-block">
			<h1 class="title">INFILTRATION</h1>
			<p class="subtitle">Welcome back, {playerName}</p>
			<div class="title-rule"></div>
		</div>

		<div class="join-form">
			{#if existingCharacters.length > 0}
				<div class="form-group">
					<label>YOUR CHARACTERS</label>
					<div class="char-select-list">
						{#each existingCharacters as char}
							<div class="char-select-row">
								<button
									class="char-select-card"
									class:dead={!char.alive}
									onclick={() => char.alive && selectCharacter(char.id)}
									disabled={!char.alive || deletingCharacterId === char.id}
								>
									<div class="char-select-top">
										<span class="char-select-name">{char.name}</span>
										<span class="char-select-class">{char.class} L{char.level}</span>
									</div>
									<div class="char-select-bottom">
										<span class="char-select-hp" class:hp-low={char.hp / char.maxHp < 0.3}>
											HP {char.hp}/{char.maxHp}
										</span>
										<span class="char-select-loc">{char.location}</span>
										{#if !char.alive}
											<span class="char-select-dead">DEAD</span>
										{/if}
									</div>
								</button>
								<button
									class="char-delete-button"
									onclick={() => requestDeleteCharacter(char.id, char.name)}
									disabled={deletingCharacterId !== null}
									title={`Delete ${char.name}`}
									aria-label={`Delete ${char.name}`}
								>
									{deletingCharacterId === char.id ? '...' : 'DELETE'}
								</button>
							</div>
						{/each}
					</div>
				</div>
			{:else}
				<p class="no-chars">No characters yet. Time to make one.</p>
			{/if}

			{#if deleteCharacterError}
				<div class="error-msg">{deleteCharacterError}</div>
			{/if}

			<button class="join-button" onclick={goToCreate}>
				CREATE NEW CHARACTER
			</button>

			<button class="switch-player-button" onclick={fullLogout}>
				DIFFERENT PLAYER
			</button>
		</div>
	</div>
</div>

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- CHARACTER CREATION SCREEN                                  -->
<!-- ═══════════════════════════════════════════════════════════ -->

{:else if phase === 'create'}
<div class="join-screen">
	<div class="join-container">
		<div class="title-block">
			<h1 class="title">INFILTRATION</h1>
			<p class="subtitle">New character for {playerName}</p>
			<div class="title-rule"></div>
			<div class="creation-steps">
				<span class="step" class:active={creationStep === 'basics'} class:done={creationStep !== 'basics'}>1. BASICS</span>
				<span class="step-arrow">></span>
				{#if !useTemplate}
					<span class="step" class:active={creationStep === 'stats'} class:done={creationStep === 'feats'}>2. STATS</span>
					<span class="step-arrow">></span>
					<span class="step" class:active={creationStep === 'feats'}>3. FEATS</span>
				{:else}
					<span class="step" class:active={creationStep === 'feats'}>2. FEATS</span>
				{/if}
			</div>
		</div>

		<div class="join-form">

		<!-- ── STEP 1: NAME & CLASS ── -->
		{#if creationStep === 'basics'}
			<div class="form-group">
				<label for="characterName">CHARACTER NAME</label>
				<input
					id="characterName"
					type="text"
					bind:value={characterName}
					placeholder="What do they call you?"
					maxlength="30"
				/>
			</div>

			<div class="form-group">
				<label>HERO CLASS</label>
				<div class="class-grid">
					{#each heroClasses as cls}
						<button
							class="class-card"
							class:selected={selectedClass === cls.name}
							onclick={() => selectedClass = cls.name}
						>
							<span class="class-emoji">{cls.emoji}</span>
							<span class="class-name">{cls.name}</span>
							<span class="class-key">KEY: {cls.key}</span>
							<span class="class-desc">{cls.desc}</span>
						</button>
					{/each}
				</div>
			</div>

			<div class="form-group">
				<label>ABILITY SCORES</label>
				<div class="stat-method-toggle">
					<button
						class="stat-method-btn"
						class:active={useTemplate}
						onclick={() => useTemplate = true}
					>
						<span class="method-label">TEMPLATE</span>
						<span class="method-desc">Auto-assigned from class</span>
					</button>
					<button
						class="stat-method-btn"
						class:active={!useTemplate}
						onclick={() => useTemplate = false}
					>
						<span class="method-label">ROLL</span>
						<span class="method-desc">4d6 drop lowest, by hand</span>
					</button>
				</div>
			</div>

		<!-- ── STEP 2: ROLL STATS ── -->
		{:else if creationStep === 'stats'}
			<div class="form-group">
				<label>ROLL ABILITY SCORES <span class="label-sub">4d6, drop lowest</span></label>
				<div class="stats-roll-grid">
					{#each Object.entries(rolledStats) as [key, stat]}
						<button
							class="stat-roll-card"
							class:rolled={stat.locked}
							class:high-roll={stat.total >= 16}
							class:low-roll={stat.total <= 8}
							onclick={() => rollStat(key as AbilityKey)}
						>
							<span class="stat-roll-label">{ABILITY_LABELS[key as AbilityKey]}</span>
							{#if stat.locked}
								<span class="stat-roll-total">{stat.total}</span>
								<span class="stat-roll-dice">
									{#each stat.rolls as die, i}
										<span class="die" class:dropped={i === 3}>{die}</span>
									{/each}
								</span>
								<span class="stat-roll-mod">
									({Math.floor((stat.total - 10) / 2) >= 0 ? '+' : ''}{Math.floor((stat.total - 10) / 2)})
								</span>
							{:else}
								<span class="stat-roll-empty">CLICK TO ROLL</span>
							{/if}
						</button>
					{/each}
				</div>
				<div class="stat-roll-actions">
					<button class="roll-all-button" onclick={rollAllStats} disabled={allStatsRolled}>
						ROLL ALL
					</button>
					<button class="roll-all-button reroll" onclick={rerollAllStats}>
						REROLL ALL
					</button>
				</div>
			</div>

		<!-- ── STEP 3: CHOOSE FEATS ── -->
		{:else if creationStep === 'feats'}
			<div class="form-group">
				<label>GENERAL FEAT <span class="label-sub">pick one</span></label>
				<div class="feat-list">
					{#each GENERAL_FEATS as feat}
						<button
							class="feat-card"
							class:selected={selectedGeneralFeat === feat.name}
							onclick={() => selectedGeneralFeat = feat.name}
						>
							<span class="feat-name">{feat.name}</span>
							<span class="feat-desc">{feat.desc}</span>
						</button>
					{/each}
				</div>
			</div>

			<div class="form-group">
				<label>{selectedClass.toUpperCase()} BONUS FEAT <span class="label-sub">pick one</span></label>
				<div class="feat-list">
					{#each (CLASS_BONUS_FEATS[selectedClass] ?? []) as feat}
						<button
							class="feat-card"
							class:selected={selectedBonusFeat === feat.name}
							onclick={() => selectedBonusFeat = feat.name}
						>
							<span class="feat-name">{feat.name}</span>
							<span class="feat-desc">{feat.desc}</span>
							{#if feat.prereq}
								<span class="feat-prereq">Requires: {feat.prereq}</span>
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{/if}

			{#if joinError}
				<div class="error-msg">{joinError}</div>
			{/if}

			<button
				class="join-button"
				onclick={advanceCreation}
				disabled={isJoining}
			>
				{#if isJoining}
					<span class="loading-dots">ROLLING DICE</span>
				{:else if creationStep === 'feats'}
					ENTER MADISON
				{:else}
					CONTINUE
				{/if}
			</button>

			{#if creationStep !== 'basics'}
				<button class="switch-player-button" onclick={() => {
					if (creationStep === 'stats') creationStep = 'basics';
					else if (creationStep === 'feats') creationStep = useTemplate ? 'basics' : 'stats';
					joinError = '';
				}}>
					BACK
				</button>
			{:else if existingCharacters.length > 0}
				<button class="switch-player-button" onclick={() => phase = 'select'}>
					BACK TO CHARACTER SELECT
				</button>
			{/if}
		</div>
	</div>
</div>

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- DEATH SCREEN                                               -->
<!-- ═══════════════════════════════════════════════════════════ -->

{:else if phase === 'dead'}
<div class="death-screen">
	<div class="death-container">
		<div class="death-skull">💀</div>
		<h1 class="death-title">YOU DIED</h1>
		{#if character}
			<div class="death-name">{character.name} the {character.class}</div>
			<div class="death-epitaph">The infiltrators claimed another victim.</div>

			<div class="death-stats">
				<h2 class="stats-header">═══ FINAL REPORT ═══</h2>
				<div class="stats-grid">
					<div class="stat-row">
						<span class="stat-label">Survived</span>
						<span class="stat-value">{(() => {
							if (!character.createdAt) return '???';
							const ms = new Date(character.lastActive ?? Date.now()).getTime() - new Date(character.createdAt).getTime();
							const mins = Math.floor(ms / 60000);
							if (mins < 60) return mins + ' minutes';
							const hrs = Math.floor(mins / 60);
							return hrs + 'h ' + (mins % 60) + 'm';
						})()}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">Level Reached</span>
						<span class="stat-value">{character.level}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">XP Earned</span>
						<span class="stat-value">{character.xp}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">Enemies Killed</span>
						<span class="stat-value">{character.stats?.enemiesKilled ?? 0}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">Damage Dealt</span>
						<span class="stat-value">{character.stats?.damageDealt ?? 0}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">Damage Taken</span>
						<span class="stat-value">{character.stats?.damageTaken ?? 0}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">Money Earned</span>
						<span class="stat-value">${character.stats?.moneyEarned ?? 0}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">Money Spent</span>
						<span class="stat-value">${character.stats?.moneySpent ?? 0}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">Items Found</span>
						<span class="stat-value">{character.stats?.itemsFound ?? 0}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">Drinks Consumed</span>
						<span class="stat-value">{character.stats?.drinksConsumed ?? 0}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">Critical Hits</span>
						<span class="stat-value">{character.stats?.criticalHits ?? 0}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">Critical Fails</span>
						<span class="stat-value">{character.stats?.criticalFails ?? 0}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">Romances</span>
						<span class="stat-value">{character.stats?.romances ?? 0}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">Actions Performed</span>
						<span class="stat-value">{character.stats?.actionsPerformed ?? 0}</span>
					</div>
				</div>
			</div>
		{/if}

		<button class="death-button" onclick={() => { character = null; playerId = null; phase = 'name'; }}>
			RETURN TO CHARACTER SELECT
		</button>
	</div>
</div>

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- GAME INTERFACE                                             -->
<!-- ═══════════════════════════════════════════════════════════ -->

{:else}
<div class="game-layout">
	<!-- Game Over Overlay -->
	{#if gameOver}
		<div class="gameover-overlay" class:won={gameOver.result === 'won'} class:lost={gameOver.result === 'lost'}>
			<div class="gameover-card">
				<div class="gameover-title">
					{gameOver.result === 'won' ? 'MADISON STANDS' : 'THE CITY HAS FALLEN'}
				</div>
				<div class="gameover-sub">
					{gameOver.result === 'won' ? 'The breach is closed.' : 'The invasion reached 100%.'}
				</div>
				<div class="gameover-reason">{gameOver.reason}</div>
				<div class="gameover-stats">
					Day {gameOver.dayAtEnd} · Invasion held at {gameOver.invasionAtEnd}%
				</div>
				<button class="death-button" onclick={() => { character = null; playerId = null; phase = 'name'; }}>
					RETURN TO CHARACTER SELECT
				</button>
			</div>
		</div>
	{/if}

	<!-- Sidebar -->
	<aside class="sidebar" class:collapsed={!sidebarOpen}>
		<button class="sidebar-toggle" onclick={() => sidebarOpen = !sidebarOpen}>
			{sidebarOpen ? '◀' : '▶'}
		</button>

		{#if sidebarOpen && character}
			<div class="sidebar-content">
				<!-- World Clock -->
				{#if worldTime}
					<div class="world-clock">
						<div class="clock-time">{worldTime}</div>
						<div class="clock-day">DAY {dayNumber}</div>
					</div>
				{/if}

				<!-- Invasion Clock -->
				<div class="invasion-block" class:crit={invasionLevel >= 75} class:warn={invasionLevel >= 50 && invasionLevel < 75}>
					<div class="invasion-label">
						<span>INVASION</span>
						<span class="invasion-pct">{invasionLevel}%</span>
					</div>
					<div class="invasion-bar">
						<div class="invasion-fill" style="width: {invasionLevel}%"></div>
					</div>
					{#if daysToCollapse != null}
						<div class="invasion-eta">
							{#if invasionLevel >= 100}
								Madison has fallen.
							{:else}
								≈ {daysToCollapse} day{daysToCollapse === 1 ? '' : 's'} to collapse
							{/if}
						</div>
					{/if}
				</div>

				<!-- Character Header -->
				<div class="char-header">
					<h2 class="char-name">{character.name}</h2>
					<div class="char-class">{character.class} L{character.level}</div>
					<!-- XP Progress Bar -->
					<div class="xp-block">
						<div class="xp-label">
							XP <span class="xp-numbers">{character.xp} / {character.level * 1000}</span>
							<span class="xp-next">Next: {character.level * 1000 - character.xp} XP</span>
						</div>
						<div class="xp-bar">
							<div class="xp-fill" style="width: {Math.min(100, Math.max(0, ((character.xp - (character.level - 1) * 1000) / 1000) * 100))}%"></div>
						</div>
					</div>
				</div>

				<!-- Party Info -->
				{#if character.partyId}
					<div class="party-indicator">
						<span class="party-icon">⚔️</span>
						<span class="party-name">In a party</span>
					</div>
				{/if}

				<!-- HP Bar -->
				<div class="stat-block">
					<div class="hp-label">
						HP <span class="hp-numbers" class:hp-dying={character.hp < 0}>{character.hp}/{character.maxHp}</span>
						{#if character.hp === 0}
							<span class="hp-status disabled">DISABLED</span>
						{:else if character.hp < 0 && character.hp > -10}
							<span class="hp-status dying">DYING</span>
						{/if}
					</div>
					<div class="hp-bar">
						<div
							class="hp-fill"
							class:hp-low={character.hp / character.maxHp < 0.3}
							class:hp-mid={character.hp / character.maxHp >= 0.3 && character.hp / character.maxHp < 0.6}
							style="width: {Math.max(0, (character.hp / character.maxHp) * 100)}%"
						></div>
					</div>
				</div>

				<!-- Core Stats -->
				<div class="stat-block">
					<div class="stat-row">
						<span class="stat-label">AC</span>
						<span class="stat-value">{character.ac}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">INIT</span>
						<span class="stat-value">{character.initiative >= 0 ? '+' : ''}{character.initiative}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">AP</span>
						<span class="stat-value">{character.actionPoints}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">$$$</span>
						<span class="stat-value">${character.wealth}</span>
					</div>
				</div>

				<!-- Abilities -->
				<div class="stat-block">
					<h3 class="section-title">ABILITIES</h3>
					<div class="ability-grid">
						{#each Object.entries(character.abilities) as [name, score]}
							<div class="ability">
								<span class="ability-name">{name}</span>
								<span class="ability-score">{score}</span>
								<span class="ability-mod">{abilityMod(score)}</span>
							</div>
						{/each}
					</div>
				</div>

				<!-- Inventory -->
				<div class="stat-block">
					<h3 class="section-title">INVENTORY</h3>
					{#if character.inventory.length === 0}
						<div class="empty-note">Empty</div>
					{:else}
						<ul class="inventory-list">
							{#each character.inventory as item}
								<li class="inv-item" class:equipped={item.id === character.equippedWeapon || item.id === character.equippedArmor}>
									{item.name}
									{#if item.id === character.equippedWeapon}
										<span class="equipped-tag">WPN</span>
									{/if}
									{#if item.id === character.equippedArmor}
										<span class="equipped-tag">ARM</span>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>

				<!-- Quest Journal -->
				{#if quests.length > 0}
					<div class="stat-block quest-block">
						<button class="quest-toggle" onclick={() => questsOpen = !questsOpen}>
							<h3 class="section-title" style="margin-bottom: 0;">QUESTS ({quests.filter(q => q.status === 'active').length})</h3>
							<span class="quest-chevron">{questsOpen ? '▾' : '▸'}</span>
						</button>
						{#if questsOpen}
							<div class="quest-list">
								{#each quests as quest}
									<div class="quest-item" class:quest-complete={quest.status === 'complete'} class:quest-failed={quest.status === 'failed'}>
										<div class="quest-name">
											{#if quest.status === 'complete'}✓{:else if quest.status === 'failed'}✗{:else}◆{/if}
											{quest.name}
										</div>
										{#if quest.objectives && quest.objectives.length > 0}
											<ul class="quest-objectives">
												{#each quest.objectives as obj}
													<li class:obj-complete={obj.complete}>
														<span class="obj-marker">{obj.complete ? '☑' : '☐'}</span>
														{obj.description}
													</li>
												{/each}
											</ul>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}

				<!-- Conditions -->
				{#if character.conditions.length > 0}
					<div class="stat-block">
						<h3 class="section-title">CONDITIONS</h3>
						<div class="conditions">
							{#each character.conditions as condition}
								<span class="condition-tag">{condition}</span>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Feats -->
				<div class="stat-block">
					<h3 class="section-title">FEATS</h3>
					<ul class="feat-list">
						{#each character.feats as feat}
							<li>{feat}</li>
						{/each}
					</ul>
				</div>

				<!-- Switch Character -->
				<button class="logout-button" onclick={switchCharacter}>
					SWITCH CHARACTER
				</button>
			</div>
		{/if}
	</aside>

	<!-- Main Terminal -->
	<main class="terminal">
		<!-- Header Bar -->
		<div class="terminal-header">
			<div class="header-left">
				<span class="header-title">INFILTRATION</span>
				<span class="header-divider">|</span>
				<span class="header-location">{character ? character.location.replace(/_/g, ' ').toUpperCase() : '???'}</span>
				{#if worldTime}
					<span class="header-divider">|</span>
					<span class="header-clock">{worldTime} D{dayNumber}</span>
				{/if}
			</div>
			<div class="header-right">
				{#if isLoading}
					<span class="loading-indicator">THE DIRECTOR IS THINKING...</span>
				{/if}
				<span class="header-status">
					{character ? `HP ${character.hp}/${character.maxHp}` : ''}
					{#if character?.inebriation && character.inebriation > 0}
						<span class="drunk-indicator" title={(() => {
							const level = character.inebriation;
							const soberIn = Math.ceil(level * 1.5);
							const label = level <= 2 ? 'Buzzed' : level <= 4 ? 'Tipsy' : level <= 6 ? 'Hammered' : level <= 8 ? 'Wasted' : 'Obliterated';
							return `${label} (${level}/10) — sober in ~${soberIn} min`;
						})()}>{'🍺'.repeat(Math.min(character.inebriation, 5))}</span>
					{/if}
					{#if character?.romanceMode}
						<span class="romance-indicator">💋</span>
					{/if}
				</span>
			</div>
		</div>

		<!-- Message Log -->
		<div class="message-log {getDrunkClass()}" bind:this={logContainer}>
			{#if messages.length === 0}
				<div class="empty-log">
					<p>The terminal hums softly. A cursor blinks.</p>
					<p class="hint-actions">Try: <span class="hint-cmd">"look around"</span> <span class="hint-sep">•</span> <span class="hint-cmd">"talk to Mac"</span> <span class="hint-sep">•</span> <span class="hint-cmd">"go to State Street"</span> <span class="hint-sep">•</span> type <span class="hint-cmd">/</span> for commands</p>
				</div>
			{/if}

			{#each messages as entry, i}
				<div class="log-entry {getEntryClass(entry.type)}" style="animation-delay: {Math.min(i * 0.02, 0.5)}s">
					<span class="entry-time">{formatTime(entry.timestamp)}</span>
					{#if entry.actor}
						<span class="entry-actor">{entry.actor}</span>
					{/if}
					{#if entry.type === 'roll' && entry.roll}
						<span class="entry-roll-info">
							🎲 {entry.text}
							{#if entry.roll.success !== undefined}
								<span class:roll-success={entry.roll.success} class:roll-fail={!entry.roll.success}>
									{entry.roll.success ? 'SUCCESS' : 'FAIL'}
								</span>
							{/if}
						</span>
					{/if}
					{#if entry.type !== 'roll'}
						<span class="entry-text">{@html formatNarration(entry.text)}</span>
					{:else if !entry.roll}
						<span class="entry-text">{@html formatNarration(entry.text)}</span>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Input Bar -->
		<div class="input-bar">
			{#if showCommands && filteredCommands.length > 0}
				<div class="command-dropdown">
					{#each filteredCommands as cmd, i}
						<button
							class="command-option"
							class:selected={i === selectedCmdIdx}
							onmousedown={(e) => { e.preventDefault(); selectCommand(cmd); }}
						>
							<span class="cmd-name">{cmd.command}</span>
							<span class="cmd-desc">{cmd.description}</span>
							{#if cmd.category === 'skill' && cmd.rank !== undefined && cmd.rank > 0}
								<span class="cmd-rank">+{cmd.rank}</span>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
			<span class="input-prompt">&gt;</span>
			<input
				type="text"
				class="action-input"
				bind:value={input}
				onkeydown={handleKeydown}
				placeholder={isLoading ? 'Waiting for the Director...' : 'What do you do?'}
				disabled={isLoading}
				autofocus
			/>
			<button
				class="send-button"
				onclick={submitAction}
				disabled={isLoading || !input.trim()}
			>
				⏎
			</button>
		</div>
	</main>
</div>
{/if}

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- SESSION SUMMARY OVERLAY                                    -->
<!-- ═══════════════════════════════════════════════════════════ -->

{#if showSessionSummary && character}
<div class="session-overlay">
	<div class="session-container">
		<div class="session-icon">⏸</div>
		<h1 class="session-title">SESSION SUMMARY</h1>
		<div class="session-name">{character.name} the {character.class}</div>
		<div class="session-subtitle">Level {character.level} · {character.hp}/{character.maxHp} HP · {character.location}</div>

		<div class="session-stats">
			<h2 class="stats-header">═══ THIS SESSION ═══</h2>
			<div class="stats-grid">
				<div class="stat-row">
					<span class="stat-label">Session Duration</span>
					<span class="stat-value">{(() => {
						const ms = Date.now() - sessionStartTime;
						const secs = Math.floor(ms / 1000);
						if (secs < 60) return secs + 's';
						const mins = Math.floor(secs / 60);
						if (mins < 60) return mins + 'm ' + (secs % 60) + 's';
						const hrs = Math.floor(mins / 60);
						return hrs + 'h ' + (mins % 60) + 'm';
					})()}</span>
				</div>
				<div class="stat-row">
					<span class="stat-label">XP Earned</span>
					<span class="stat-value session-delta">+{(character.xp ?? 0) - sessionStartXp}</span>
				</div>
				<div class="stat-row">
					<span class="stat-label">Enemies Killed</span>
					<span class="stat-value session-delta">+{(character.stats?.enemiesKilled ?? 0) - sessionStartKills}</span>
				</div>
				<div class="stat-row">
					<span class="stat-label">Damage Dealt</span>
					<span class="stat-value session-delta">+{(character.stats?.damageDealt ?? 0) - sessionStartDamageDealt}</span>
				</div>
				<div class="stat-row">
					<span class="stat-label">Damage Taken</span>
					<span class="stat-value session-delta">+{(character.stats?.damageTaken ?? 0) - sessionStartDamageTaken}</span>
				</div>
				<div class="stat-row">
					<span class="stat-label">Items Found</span>
					<span class="stat-value session-delta">+{(character.stats?.itemsFound ?? 0) - sessionStartItemsFound}</span>
				</div>
				<div class="stat-row">
					<span class="stat-label">Actions Performed</span>
					<span class="stat-value session-delta">+{(character.stats?.actionsPerformed ?? 0) - sessionStartActions}</span>
				</div>
			</div>
		</div>

		<div class="session-stats session-lifetime">
			<h2 class="stats-header">═══ LIFETIME TOTALS ═══</h2>
			<div class="stats-grid">
				<div class="stat-row">
					<span class="stat-label">Total XP</span>
					<span class="stat-value">{character.xp}</span>
				</div>
				<div class="stat-row">
					<span class="stat-label">Enemies Killed</span>
					<span class="stat-value">{character.stats?.enemiesKilled ?? 0}</span>
				</div>
				<div class="stat-row">
					<span class="stat-label">Damage Dealt</span>
					<span class="stat-value">{character.stats?.damageDealt ?? 0}</span>
				</div>
				<div class="stat-row">
					<span class="stat-label">Critical Hits</span>
					<span class="stat-value">{character.stats?.criticalHits ?? 0}</span>
				</div>
				<div class="stat-row">
					<span class="stat-label">Wealth</span>
					<span class="stat-value">${character.wealth ?? 0}</span>
				</div>
			</div>
		</div>

		<button class="session-button" onclick={confirmSwitchCharacter}>
			CONTINUE TO CHARACTER SELECT
		</button>
		<button class="session-cancel" onclick={() => { showSessionSummary = false; }}>
			CANCEL
		</button>
	</div>
</div>
{/if}

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- LEVEL UP CELEBRATION OVERLAY                               -->
<!-- ═══════════════════════════════════════════════════════════ -->

{#if showLevelUp}
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="levelup-overlay" onclick={dismissLevelUp}>
	<div class="levelup-particles">
		{#each Array(20) as _, i}
			<div class="levelup-particle" style="--i:{i};--x:{Math.random() * 100}vw;--delay:{Math.random() * 0.8}s;--dur:{1.5 + Math.random() * 2}s"></div>
		{/each}
	</div>
	<div class="levelup-content">
		<div class="levelup-flash"></div>
		<div class="levelup-label">LEVEL UP</div>
		<div class="levelup-number">{levelUpNumber}</div>
		<div class="levelup-subtitle">Click to dismiss</div>
	</div>
</div>
{/if}

<script lang="ts" module>
	function formatNarration(text: string): string {
		// Bold: **text**
		text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
		// Italic: *text*
		text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
		// Dice notation highlight
		text = text.replace(/(\d+d\d+(?:[+-]\d+)?)/g, '<span class="dice-notation">$1</span>');
		return text;
	}
</script>

<style>
	/* ═══════════════════════════════════════════════════════ */
	/* DEATH SCREEN                                           */
	/* ═══════════════════════════════════════════════════════ */

	.death-screen {
		height: 100vh;
		overflow-y: auto;
		background: #0a0a0a;
		padding: 2rem;
	}

	.death-container {
		max-width: 500px;
		width: 100%;
		margin: 0 auto;
		text-align: center;
		padding-bottom: 4rem;
	}

	.death-skull {
		font-size: 4rem;
		margin-bottom: 0.5rem;
		animation: death-pulse 2s ease-in-out infinite;
	}

	@keyframes death-pulse {
		0%, 100% { opacity: 1; transform: scale(1); }
		50% { opacity: 0.6; transform: scale(1.1); }
	}

	.death-title {
		font-family: 'Courier New', monospace;
		font-size: 3rem;
		color: #cc0000;
		text-shadow: 0 0 20px rgba(204, 0, 0, 0.5);
		margin-bottom: 0.5rem;
		letter-spacing: 0.3em;
	}

	.death-name {
		color: var(--amber);
		font-family: 'Courier New', monospace;
		font-size: 1.2rem;
		margin-bottom: 0.25rem;
	}

	.death-epitaph {
		color: #666;
		font-style: italic;
		font-size: 0.9rem;
		margin-bottom: 2rem;
	}

	.death-stats {
		background: rgba(204, 0, 0, 0.05);
		border: 1px solid #331111;
		padding: 1.5rem;
		margin-bottom: 2rem;
		text-align: left;
	}

	.stats-header {
		font-family: 'Courier New', monospace;
		color: #cc0000;
		font-size: 1rem;
		text-align: center;
		margin-bottom: 1rem;
		letter-spacing: 0.15em;
	}

	.stats-grid {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.stat-row {
		display: flex;
		justify-content: space-between;
		font-family: 'Courier New', monospace;
		font-size: 0.85rem;
		padding: 0.2rem 0;
		border-bottom: 1px solid #1a1111;
	}

	.stat-label {
		color: #888;
	}

	.stat-value {
		color: var(--amber);
		font-weight: bold;
	}

	.death-button {
		background: transparent;
		border: 1px solid #cc0000;
		color: #cc0000;
		padding: 0.8rem 2rem;
		font-family: 'Courier New', monospace;
		font-size: 1rem;
		cursor: pointer;
		letter-spacing: 0.1em;
		transition: all 0.2s;
		width: 100%;
	}

	.death-button:hover {
		background: #cc0000;
		color: #0a0a0a;
	}


	/* ═══════════════════════════════════════════════════════ */
	/* SESSION SUMMARY                                        */
	/* ═══════════════════════════════════════════════════════ */

	.session-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.92);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		overflow-y: auto;
		animation: session-fade-in 0.3s ease-out;
	}

	@keyframes session-fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.session-container {
		max-width: 500px;
		width: 100%;
		text-align: center;
		padding-bottom: 2rem;
	}

	.session-icon {
		font-size: 3rem;
		margin-bottom: 0.5rem;
		opacity: 0.8;
	}

	.session-title {
		font-family: 'Courier New', monospace;
		font-size: 2rem;
		color: var(--amber);
		text-shadow: 0 0 20px rgba(255, 191, 0, 0.3);
		margin-bottom: 0.5rem;
		letter-spacing: 0.2em;
	}

	.session-name {
		color: var(--green);
		font-family: 'Courier New', monospace;
		font-size: 1.2rem;
		margin-bottom: 0.25rem;
	}

	.session-subtitle {
		color: #666;
		font-family: 'Courier New', monospace;
		font-size: 0.85rem;
		margin-bottom: 2rem;
	}

	.session-stats {
		background: rgba(255, 191, 0, 0.03);
		border: 1px solid #332b11;
		padding: 1.5rem;
		margin-bottom: 1rem;
		text-align: left;
	}

	.session-lifetime {
		background: rgba(0, 255, 0, 0.02);
		border-color: #1a331a;
		margin-bottom: 2rem;
	}

	.session-delta {
		color: var(--green) !important;
	}

	.session-button {
		background: transparent;
		border: 1px solid var(--amber);
		color: var(--amber);
		padding: 0.8rem 2rem;
		font-family: 'Courier New', monospace;
		font-size: 1rem;
		cursor: pointer;
		letter-spacing: 0.1em;
		transition: all 0.2s;
		width: 100%;
		margin-bottom: 0.5rem;
	}

	.session-button:hover {
		background: var(--amber);
		color: #0a0a0a;
	}

	.session-cancel {
		background: transparent;
		border: 1px solid #444;
		color: #666;
		padding: 0.6rem 2rem;
		font-family: 'Courier New', monospace;
		font-size: 0.85rem;
		cursor: pointer;
		letter-spacing: 0.1em;
		transition: all 0.2s;
		width: 100%;
	}

	.session-cancel:hover {
		border-color: #888;
		color: #aaa;
	}

	/* ═══════════════════════════════════════════════════════ */
	/* JOIN SCREEN                                            */
	/* ═══════════════════════════════════════════════════════ */

	.join-screen {
		height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		background: radial-gradient(ellipse at center, #0d1a0d 0%, #0a0a0a 70%);
	}

	.join-container {
		max-width: 640px;
		width: 100%;
	}

	.title-block {
		text-align: center;
		margin-bottom: 2.5rem;
	}

	.title {
		font-family: var(--font-display);
		font-size: 3rem;
		font-weight: 900;
		letter-spacing: 0.3em;
		color: var(--green);
		text-shadow: 0 0 20px var(--green-glow), 0 0 40px var(--green-glow);
		margin-bottom: 0.5rem;
	}

	.subtitle {
		font-size: 0.85rem;
		color: var(--gray);
		letter-spacing: 0.2em;
		text-transform: uppercase;
	}

	.title-rule {
		width: 60%;
		height: 1px;
		background: linear-gradient(90deg, transparent, var(--green-dark), transparent);
		margin: 1rem auto;
	}

	.tagline {
		color: var(--green-dim);
		font-size: 0.85rem;
		font-style: italic;
		line-height: 1.8;
	}

	.join-form {
		background: var(--bg-panel);
		border: 1px solid var(--green-dark);
		border-radius: 4px;
		padding: 2rem;
	}

	.form-group {
		margin-bottom: 1.5rem;
	}

	.form-group label {
		display: block;
		font-size: 0.75rem;
		letter-spacing: 0.15em;
		color: var(--green-dim);
		margin-bottom: 0.5rem;
	}

	.form-group input[type="text"] {
		width: 100%;
		background: var(--bg-input);
		border: 1px solid var(--green-dark);
		color: var(--green);
		font-family: var(--font-mono);
		font-size: 1rem;
		padding: 0.75rem 1rem;
		border-radius: 2px;
		outline: none;
		transition: border-color 0.2s;
	}

	.form-group input[type="text"]:focus {
		border-color: var(--green-dim);
		box-shadow: 0 0 8px var(--green-glow);
	}

	.form-group input[type="text"]::placeholder {
		color: var(--gray-dark);
	}

	.class-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
	}

	.class-card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.25rem;
		padding: 0.75rem;
		background: var(--bg-input);
		border: 1px solid var(--green-dark);
		border-radius: 3px;
		cursor: pointer;
		transition: all 0.2s;
		text-align: left;
		color: var(--green-dim);
		font-family: var(--font-mono);
	}

	.class-card:hover {
		border-color: var(--green-dim);
	}

	.class-card.selected {
		border-color: var(--green);
		background: rgba(0, 255, 65, 0.05);
		box-shadow: 0 0 12px var(--green-glow);
	}

	.class-emoji {
		font-size: 1.5rem;
		line-height: 1;
	}

	.class-name {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--green);
	}

	.class-key {
		font-size: 0.65rem;
		color: var(--cyan-dim);
		letter-spacing: 0.1em;
	}

	.class-desc {
		font-size: 0.7rem;
		color: var(--gray);
		line-height: 1.4;
	}

	/* ── Creation Steps Indicator ── */
	.creation-steps {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		margin-top: 0.75rem;
		font-family: var(--font-mono);
		font-size: 0.7rem;
		letter-spacing: 0.05em;
	}
	.step {
		color: var(--green-dark);
		transition: color 0.2s;
	}
	.step.active {
		color: var(--green);
		text-shadow: 0 0 8px var(--green-glow);
	}
	.step.done {
		color: var(--cyan-dim);
	}
	.step-arrow {
		color: var(--green-dark);
		font-size: 0.65rem;
	}

	/* ── Stat Method Toggle ── */
	.stat-method-toggle {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}
	.stat-method-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		padding: 0.75rem;
		background: var(--bg-dark);
		border: 1px solid var(--green-dark);
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.15s;
		font-family: var(--font-mono);
	}
	.stat-method-btn:hover {
		border-color: var(--green);
	}
	.stat-method-btn.active {
		border-color: var(--green);
		background: rgba(0, 255, 65, 0.08);
		box-shadow: 0 0 10px rgba(0, 255, 65, 0.15);
	}
	.method-label {
		font-size: 0.85rem;
		font-weight: bold;
		color: var(--green);
		letter-spacing: 0.1em;
	}
	.stat-method-btn:not(.active) .method-label {
		color: var(--green-dark);
	}
	.method-desc {
		font-size: 0.65rem;
		color: var(--gray);
	}

	/* ── Stat Rolling ── */
	.stats-roll-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.75rem;
	}
	.stat-roll-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		padding: 0.75rem 0.5rem;
		background: var(--bg-input);
		border: 1px solid var(--green-dark);
		border-radius: 3px;
		cursor: pointer;
		transition: all 0.2s;
		font-family: var(--font-mono);
		color: var(--green-dim);
		min-height: 5.5rem;
	}
	.stat-roll-card:not(:disabled):hover {
		border-color: var(--green-dim);
		background: rgba(0, 255, 65, 0.03);
	}
	.stat-roll-card.rolled {
		border-color: var(--green);
		cursor: pointer;
	}
	.stat-roll-card.high-roll {
		border-color: var(--cyan);
		background: rgba(0, 200, 255, 0.05);
		box-shadow: 0 0 10px rgba(0, 200, 255, 0.15);
	}
	.stat-roll-card.low-roll {
		border-color: var(--red-dim);
		background: rgba(255, 51, 51, 0.05);
	}
	.stat-roll-label {
		font-size: 0.6rem;
		letter-spacing: 0.15em;
		color: var(--green-dim);
		font-weight: 700;
	}
	.stat-roll-total {
		font-size: 1.6rem;
		font-weight: 900;
		color: var(--green);
		line-height: 1;
		text-shadow: 0 0 12px var(--green-glow);
	}
	.stat-roll-dice {
		display: flex;
		gap: 0.3rem;
		font-size: 0.75rem;
	}
	.die {
		color: var(--green);
		font-weight: 700;
	}
	.die.dropped {
		color: var(--red-dim);
		text-decoration: line-through;
	}
	.stat-roll-mod {
		font-size: 0.7rem;
		color: var(--cyan-dim);
	}
	.stat-roll-empty {
		font-size: 0.7rem;
		color: var(--green-dark);
		letter-spacing: 0.05em;
		padding: 0.5rem 0;
	}
	.stat-roll-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.roll-all-button {
		flex: 1;
		padding: 0.5rem;
		background: transparent;
		border: 1px solid var(--green-dim);
		color: var(--green);
		font-family: var(--font-mono);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		cursor: pointer;
		transition: all 0.2s;
		border-radius: 2px;
	}
	.roll-all-button:hover:not(:disabled) {
		background: rgba(0, 255, 65, 0.05);
		border-color: var(--green);
		box-shadow: 0 0 8px var(--green-glow);
	}
	.roll-all-button:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}
	.roll-all-button.reroll {
		border-color: var(--cyan-dim);
		color: var(--cyan-dim);
	}
	.roll-all-button.reroll:hover {
		border-color: var(--cyan);
		color: var(--cyan);
		background: rgba(0, 200, 255, 0.05);
	}
	.label-sub {
		font-size: 0.65rem;
		color: var(--green-dark);
		font-weight: 400;
		letter-spacing: 0.05em;
	}

	/* ── Feat Selection ── */
	.feat-list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		max-height: 18rem;
		overflow-y: auto;
		padding-right: 0.25rem;
	}
	.feat-card {
		display: flex;
		flex-direction: column;
		padding: 0.5rem 0.75rem;
		background: var(--bg-input);
		border: 1px solid var(--green-dark);
		border-radius: 2px;
		cursor: pointer;
		transition: all 0.15s;
		text-align: left;
		font-family: var(--font-mono);
		color: var(--green-dim);
	}
	.feat-card:hover {
		border-color: var(--green-dim);
		background: rgba(0, 255, 65, 0.03);
	}
	.feat-card.selected {
		border-color: var(--green);
		background: rgba(0, 255, 65, 0.08);
		box-shadow: 0 0 8px var(--green-glow);
	}
	.feat-name {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--green);
	}
	.feat-desc {
		font-size: 0.65rem;
		color: var(--gray);
		line-height: 1.3;
	}
	.feat-prereq {
		font-size: 0.6rem;
		color: var(--amber, #f0a030);
		font-style: italic;
		margin-top: 0.15rem;
	}

	.error-msg {
		background: rgba(255, 51, 51, 0.1);
		border: 1px solid var(--red-dim);
		color: var(--red);
		padding: 0.5rem 0.75rem;
		font-size: 0.85rem;
		border-radius: 2px;
		margin-bottom: 1rem;
	}

	.join-button {
		width: 100%;
		padding: 1rem;
		background: transparent;
		border: 2px solid var(--green);
		color: var(--green);
		font-family: var(--font-display);
		font-size: 1rem;
		letter-spacing: 0.2em;
		cursor: pointer;
		transition: all 0.3s;
		text-transform: uppercase;
	}

	.join-button:hover:not(:disabled) {
		background: rgba(0, 255, 65, 0.1);
		box-shadow: 0 0 20px var(--green-glow);
	}

	.join-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.loading-dots::after {
		content: '';
		animation: dots 1.5s steps(4, end) infinite;
	}

	@keyframes dots {
		0% { content: ''; }
		25% { content: '.'; }
		50% { content: '..'; }
		75% { content: '...'; }
	}

	.join-footer {
		text-align: center;
		margin-top: 1.5rem;
		color: var(--gray);
		font-size: 0.75rem;
	}

	.footer-sub {
		color: var(--gray-dark);
		margin-top: 0.25rem;
	}

	/* ── Character Select ──────────────────────────────── */

	.char-select-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.char-select-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 5.5rem;
		gap: 0.5rem;
		align-items: stretch;
	}

	.char-select-card {
		width: 100%;
		padding: 0.75rem 1rem;
		background: var(--bg-input);
		border: 1px solid var(--green-dark);
		border-radius: 3px;
		cursor: pointer;
		transition: all 0.2s;
		text-align: left;
		font-family: var(--font-mono);
		color: var(--green);
	}

	.char-select-card:hover:not(:disabled) {
		border-color: var(--green);
		background: rgba(0, 255, 65, 0.05);
		box-shadow: 0 0 12px var(--green-glow);
	}

	.char-select-card.dead {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.char-delete-button {
		width: 5.5rem;
		background: transparent;
		border: 1px solid var(--red);
		border-radius: 3px;
		color: var(--red);
		cursor: pointer;
		font-family: var(--font-mono);
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		transition: all 0.2s;
	}

	.char-delete-button:hover:not(:disabled) {
		background: rgba(255, 0, 64, 0.1);
		box-shadow: 0 0 10px rgba(255, 0, 64, 0.25);
	}

	.char-delete-button:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}

	.char-select-top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 0.25rem;
	}

	.char-select-name {
		font-weight: 700;
		font-size: 1rem;
	}

	.char-select-class {
		font-size: 0.75rem;
		color: var(--cyan-dim);
		letter-spacing: 0.1em;
	}

	.char-select-bottom {
		display: flex;
		gap: 1rem;
		font-size: 0.75rem;
		color: var(--gray);
	}

	.char-select-hp {
		color: var(--green-dim);
	}

	.char-select-hp.hp-low {
		color: var(--red);
	}

	.char-select-loc {
		color: var(--gray);
	}

	.char-select-dead {
		color: var(--red);
		font-weight: 700;
		letter-spacing: 0.1em;
	}

	.no-chars {
		text-align: center;
		color: var(--gray);
		font-style: italic;
		padding: 1.5rem 0;
	}

	.switch-player-button {
		width: 100%;
		margin-top: 0.75rem;
		padding: 0.6rem;
		background: transparent;
		border: 1px solid var(--gray-dark);
		color: var(--gray);
		font-family: var(--font-mono);
		font-size: 0.75rem;
		letter-spacing: 0.15em;
		cursor: pointer;
		transition: all 0.2s;
	}

	.switch-player-button:hover {
		border-color: var(--gray);
		color: var(--white);
	}

	/* ═══════════════════════════════════════════════════════ */
	/* GAME LAYOUT                                            */
	/* ═══════════════════════════════════════════════════════ */

	.game-layout {
		display: flex;
		height: 100vh;
		overflow: hidden;
	}

	/* ── Sidebar ────────────────────────────────────────── */

	.sidebar {
		width: 280px;
		min-width: 280px;
		background: var(--bg-panel);
		border-right: 1px solid var(--green-dark);
		display: flex;
		flex-direction: column;
		position: relative;
		transition: width 0.3s, min-width 0.3s;
	}

	.sidebar.collapsed {
		width: 36px;
		min-width: 36px;
	}

	.sidebar-toggle {
		position: absolute;
		top: 8px;
		right: 8px;
		background: none;
		border: none;
		color: var(--green-dim);
		cursor: pointer;
		font-size: 0.85rem;
		z-index: 10;
		padding: 4px;
	}

	.sidebar-content {
		padding: 1rem;
		overflow-y: auto;
		flex: 1;
	}

	/* ── World Clock ───────────────────────────────────── */

	.world-clock {
		text-align: center;
		padding: 0.6rem 0.5rem;
		margin-bottom: 0.75rem;
		border: 1px solid var(--green-dark);
		border-radius: 3px;
		background: var(--bg-input);
	}

	.clock-time {
		font-family: var(--font-display);
		font-size: 1.3rem;
		font-weight: 700;
		color: var(--amber);
		letter-spacing: 0.1em;
		text-shadow: 0 0 12px rgba(255, 176, 0, 0.3);
		line-height: 1.2;
	}

	.clock-day {
		font-family: var(--font-mono);
		font-size: 0.65rem;
		color: var(--green-dim);
		letter-spacing: 0.2em;
		margin-top: 0.15rem;
	}

	.invasion-block {
		padding: 0.5rem 0.6rem;
		margin-bottom: 0.75rem;
		border: 1px solid var(--green-dark);
		border-radius: 3px;
		background: var(--bg-input);
	}
	.invasion-block.warn { border-color: var(--amber-dim); }
	.invasion-block.crit { border-color: var(--red-dim); }

	.invasion-label {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		font-family: var(--font-mono);
		font-size: 0.6rem;
		letter-spacing: 0.18em;
		color: var(--green-dim);
		margin-bottom: 0.3rem;
	}
	.invasion-pct {
		font-weight: 700;
		color: var(--amber);
	}
	.invasion-block.warn .invasion-pct { color: var(--amber); }
	.invasion-block.crit .invasion-pct { color: var(--red); }

	.invasion-bar {
		height: 6px;
		background: var(--bg-dark);
		border-radius: 3px;
		overflow: hidden;
	}
	.invasion-fill {
		height: 100%;
		background: var(--green-dim);
		transition: width 0.4s ease;
	}
	.invasion-block.warn .invasion-fill { background: var(--amber); }
	.invasion-block.crit .invasion-fill {
		background: var(--red);
		animation: invasion-pulse 1.6s ease-in-out infinite;
	}
	@keyframes invasion-pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.55; }
	}

	.invasion-eta {
		font-family: var(--font-mono);
		font-size: 0.6rem;
		letter-spacing: 0.05em;
		color: var(--green-dim);
		margin-top: 0.35rem;
		text-align: right;
	}
	.invasion-block.crit .invasion-eta { color: var(--red); }

	.gameover-overlay {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.88);
		backdrop-filter: blur(3px);
	}
	.gameover-card {
		max-width: 480px;
		text-align: center;
		padding: 2.5rem 2rem;
		border: 1px solid var(--green-dark);
		border-radius: 4px;
		background: var(--bg-panel);
	}
	.gameover-overlay.won .gameover-card { border-color: var(--green-dim); }
	.gameover-overlay.lost .gameover-card { border-color: var(--red-dim); }

	.gameover-title {
		font-family: var(--font-display);
		font-size: 1.8rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		margin-bottom: 0.5rem;
	}
	.gameover-overlay.won .gameover-title {
		color: var(--green-dim);
		text-shadow: 0 0 18px rgba(0, 204, 51, 0.4);
	}
	.gameover-overlay.lost .gameover-title {
		color: var(--red);
		text-shadow: 0 0 18px rgba(255, 51, 51, 0.4);
	}
	.gameover-sub {
		font-family: var(--font-mono);
		font-size: 0.85rem;
		color: var(--amber);
		margin-bottom: 1.25rem;
		letter-spacing: 0.05em;
	}
	.gameover-reason {
		font-size: 0.95rem;
		color: var(--green-dim);
		line-height: 1.5;
		margin-bottom: 1rem;
	}
	.gameover-stats {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--green-dark);
		letter-spacing: 0.1em;
		margin-bottom: 1.75rem;
	}

	.header-clock {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--amber);
		letter-spacing: 0.05em;
	}

	.char-header {
		margin-bottom: 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--green-dark);
	}

	.char-name {
		font-family: var(--font-display);
		font-size: 1.1rem;
		color: var(--green);
		font-weight: 700;
		letter-spacing: 0.05em;
	}

	.char-class {
		font-size: 0.75rem;
		color: var(--cyan-dim);
		letter-spacing: 0.1em;
	}

	.char-xp {
		font-size: 0.7rem;
		color: var(--gray);
	}

	.party-indicator {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0.4rem 0 0.6rem;
		padding: 0.3rem 0.5rem;
		background: rgba(0, 255, 65, 0.06);
		border: 1px solid rgba(0, 255, 65, 0.15);
		border-radius: 3px;
		font-size: 0.7rem;
	}
	.party-icon { font-size: 0.85rem; }
	.party-name {
		color: var(--green-dim);
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.stat-block {
		margin-bottom: 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid rgba(0, 255, 65, 0.08);
	}

	.hp-label {
		font-size: 0.75rem;
		color: var(--green-dim);
		margin-bottom: 0.25rem;
		display: flex;
		justify-content: space-between;
	}

	.hp-numbers {
		color: var(--green);
	}

	.hp-bar {
		height: 8px;
		background: var(--bg-input);
		border-radius: 4px;
		overflow: hidden;
		border: 1px solid var(--green-dark);
	}

	.hp-fill {
		height: 100%;
		background: var(--green);
		transition: width 0.5s;
		border-radius: 3px;
	}

	.hp-fill.hp-low {
		background: var(--red);
		animation: pulse 1s infinite;
	}

	.hp-fill.hp-mid {
		background: var(--amber);
	}

	.hp-numbers.hp-dying {
		color: var(--red);
		animation: pulse 1s infinite;
	}

	.hp-status {
		font-size: 0.65rem;
		font-weight: bold;
		text-transform: uppercase;
		margin-left: 0.5rem;
		letter-spacing: 0.1em;
	}

	.hp-status.disabled {
		color: var(--amber);
	}

	.hp-status.dying {
		color: var(--red);
		animation: pulse 1s infinite;
	}

	.stat-row {
		display: flex;
		justify-content: space-between;
		padding: 0.2rem 0;
		font-size: 0.8rem;
	}

	.stat-label {
		color: var(--gray);
		letter-spacing: 0.1em;
	}

	.stat-value {
		color: var(--green);
		font-weight: 500;
	}

	.section-title {
		font-size: 0.7rem;
		color: var(--green-dim);
		letter-spacing: 0.15em;
		margin-bottom: 0.5rem;
		font-weight: 400;
	}

	.ability-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
	}

	.ability {
		text-align: center;
		padding: 0.35rem;
		background: var(--bg-input);
		border-radius: 2px;
		border: 1px solid rgba(0, 255, 65, 0.08);
	}

	.ability-name {
		display: block;
		font-size: 0.6rem;
		color: var(--gray);
		letter-spacing: 0.1em;
	}

	.ability-score {
		display: block;
		font-size: 1rem;
		color: var(--green);
		font-weight: 700;
	}

	.ability-mod {
		display: block;
		font-size: 0.7rem;
		color: var(--cyan-dim);
	}

	.inventory-list {
		list-style: none;
		padding: 0;
	}

	.inv-item {
		font-size: 0.8rem;
		padding: 0.2rem 0;
		color: var(--white);
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.inv-item.equipped {
		color: var(--green);
	}

	.equipped-tag {
		font-size: 0.6rem;
		padding: 0 0.3rem;
		background: var(--green-dark);
		color: var(--green);
		border-radius: 2px;
		letter-spacing: 0.05em;
	}

	.empty-note {
		color: var(--gray-dark);
		font-size: 0.8rem;
		font-style: italic;
	}

	.conditions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.condition-tag {
		font-size: 0.7rem;
		padding: 0.15rem 0.4rem;
		background: rgba(255, 51, 51, 0.15);
		color: var(--red);
		border: 1px solid var(--red-dim);
		border-radius: 2px;
	}

	.feat-list {
		list-style: none;
		padding: 0;
	}

	.feat-list li {
		font-size: 0.8rem;
		color: var(--amber-dim);
		padding: 0.15rem 0;
	}

	.logout-button {
		width: 100%;
		margin-top: 1rem;
		padding: 0.5rem;
		background: transparent;
		border: 1px solid var(--red-dim);
		color: var(--red-dim);
		font-family: var(--font-mono);
		font-size: 0.7rem;
		letter-spacing: 0.15em;
		cursor: pointer;
		transition: all 0.2s;
	}

	.logout-button:hover {
		border-color: var(--red);
		color: var(--red);
		background: rgba(255, 51, 51, 0.1);
	}

	/* ── Terminal ───────────────────────────────────────── */

	.terminal {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.terminal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 1rem;
		background: var(--bg-panel);
		border-bottom: 1px solid var(--green-dark);
		flex-shrink: 0;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.header-title {
		font-family: var(--font-display);
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--green);
		letter-spacing: 0.15em;
	}

	.header-divider {
		color: var(--green-dark);
	}

	.header-location {
		font-size: 0.75rem;
		color: var(--cyan-dim);
		letter-spacing: 0.1em;
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.loading-indicator {
		font-size: 0.7rem;
		color: var(--amber);
		animation: pulse 1.5s infinite;
		letter-spacing: 0.1em;
	}

	.header-status {
		font-size: 0.75rem;
		color: var(--green-dim);
	}

	/* ── Message Log ───────────────────────────────────── */

	.message-log {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.empty-log {
		margin: auto;
		text-align: center;
		color: var(--green-dim);
	}

	.empty-log .hint-actions {
		margin-top: 0.5rem;
		color: var(--gray);
		font-size: 0.85rem;
	}

	.hint-cmd {
		color: var(--green);
		font-family: inherit;
	}

	.hint-sep {
		color: var(--gray-dark);
		margin: 0 0.25rem;
	}

	.log-entry {
		padding: 0.35rem 0;
		animation: fadeIn 0.3s ease forwards;
		line-height: 1.7;
	}

	.entry-time {
		font-size: 0.65rem;
		color: var(--gray-dark);
		margin-right: 0.5rem;
	}

	.entry-actor {
		font-weight: 700;
		margin-right: 0.35rem;
	}

	/* Entry type colors */
	.entry-narration {
		color: var(--green);
	}

	.entry-narration .entry-text {
		line-height: 1.8;
	}

	.entry-action {
		color: var(--cyan);
	}

	.entry-action .entry-actor {
		color: var(--cyan);
	}

	.entry-combat {
		color: var(--red);
		font-weight: 500;
	}

	.entry-system {
		color: var(--yellow);
		font-style: italic;
	}

	.entry-dialogue {
		color: var(--amber);
	}

	.entry-roll {
		color: var(--cyan-dim);
		font-size: 0.85rem;
	}

	.entry-roll-info {
		font-size: 0.8rem;
		color: var(--cyan-dim);
		margin-right: 0.5rem;
	}

	.roll-success {
		color: var(--green);
		font-weight: 700;
	}

	.roll-fail {
		color: var(--red);
		font-weight: 700;
	}

	.entry-text :global(.dice-notation) {
		color: var(--cyan);
		font-weight: 500;
	}

	.entry-text :global(strong) {
		color: var(--green);
		font-weight: 700;
	}

	.entry-text :global(em) {
		color: var(--amber-dim);
		font-style: italic;
	}

	/* ── Input Bar ─────────────────────────────────────── */

	.input-bar {
		position: relative;
		display: flex;
		align-items: center;
		padding: 0.75rem 1rem;
		background: var(--bg-panel);
		border-top: 1px solid var(--green-dark);
		gap: 0.5rem;
		flex-shrink: 0;
	}

	/* ── Slash Command Dropdown ─────────────────────── */

	.command-dropdown {
		position: absolute;
		bottom: 100%;
		left: 0;
		right: 0;
		background: var(--bg-panel);
		border: 1px solid var(--green-dark);
		border-bottom: none;
		max-height: 320px;
		overflow-y: auto;
		z-index: 100;
	}

	.command-option {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.45rem 1rem;
		background: none;
		border: none;
		border-bottom: 1px solid rgba(0, 77, 25, 0.3);
		color: var(--green-dim);
		font-family: var(--font-mono);
		font-size: 0.85rem;
		cursor: pointer;
		text-align: left;
	}

	.command-option:last-child {
		border-bottom: none;
	}

	.command-option:hover,
	.command-option.selected {
		background: rgba(0, 255, 65, 0.08);
		color: var(--green);
	}

	.cmd-name {
		color: var(--green);
		font-weight: 600;
		min-width: 160px;
		flex-shrink: 0;
	}

	.cmd-desc {
		color: var(--gray);
		flex: 1;
	}

	.cmd-rank {
		color: var(--amber);
		font-weight: 700;
		font-size: 0.8rem;
		flex-shrink: 0;
	}

	.input-prompt {
		color: var(--green);
		font-weight: 700;
		font-size: 1.1rem;
		animation: blink 1s step-end infinite;
	}

	.action-input {
		flex: 1;
		background: var(--bg-input);
		border: 1px solid var(--green-dark);
		color: var(--green);
		font-family: var(--font-mono);
		font-size: 0.95rem;
		padding: 0.6rem 0.75rem;
		border-radius: 2px;
		outline: none;
	}

	.action-input:focus {
		border-color: var(--green-dim);
		box-shadow: 0 0 8px var(--green-glow);
	}

	.action-input::placeholder {
		color: var(--gray-dark);
	}

	.action-input:disabled {
		opacity: 0.5;
	}

	.send-button {
		background: none;
		border: 1px solid var(--green-dark);
		color: var(--green);
		font-size: 1.1rem;
		padding: 0.5rem 0.75rem;
		cursor: pointer;
		border-radius: 2px;
		transition: all 0.2s;
	}

	.send-button:hover:not(:disabled) {
		border-color: var(--green);
		background: rgba(0, 255, 65, 0.1);
	}

	.send-button:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	/* ═══════════════════════════════════════════════════════ */
	/* RESPONSIVE                                             */
	/* ═══════════════════════════════════════════════════════ */

	@media (max-width: 768px) {
		.title {
			font-size: 2rem;
			letter-spacing: 0.15em;
		}

		.class-grid {
			grid-template-columns: 1fr;
		}

		.stats-roll-grid {
			grid-template-columns: repeat(2, 1fr);
		}

		.char-select-row {
			grid-template-columns: 1fr;
		}

		.char-delete-button {
			width: 100%;
			min-height: 2.25rem;
		}

		.char-select-top {
			gap: 0.75rem;
		}

		.char-select-bottom {
			flex-wrap: wrap;
			gap: 0.5rem 0.75rem;
		}

		.sidebar {
			position: absolute;
			left: 0;
			top: 0;
			bottom: 0;
			z-index: 100;
			box-shadow: 4px 0 20px rgba(0, 0, 0, 0.5);
		}

		.sidebar.collapsed {
			width: 0;
			min-width: 0;
			border: none;
			overflow: hidden;
		}

		.sidebar-toggle {
			right: auto;
			left: 8px;
		}

		.sidebar.collapsed .sidebar-toggle {
			left: 0;
			position: fixed;
			background: var(--bg-panel);
			border: 1px solid var(--green-dark);
			border-radius: 0 4px 4px 0;
			padding: 8px;
		}
	}

	/* ── Inebriation Effects ───────────────────────────── */

	.drunk-buzzed .entry-narration .entry-text {
		text-shadow: 0 0 4px rgba(180, 220, 255, 0.35), 0 0 8px rgba(180, 220, 255, 0.15);
	}

	.drunk-tipsy .entry-narration .entry-text {
		animation: drunk-sway 3s ease-in-out infinite, drunk-rainbow 8s linear infinite;
		filter: blur(0.3px);
		letter-spacing: 0.02em;
	}

	.drunk-hammered .entry-narration .entry-text {
		animation: drunk-sway 2s ease-in-out infinite, drunk-rainbow 5s linear infinite;
		filter: blur(0.5px);
		letter-spacing: 0.05em;
		word-spacing: 0.1em;
	}

	.drunk-wasted .entry-narration .entry-text {
		animation: drunk-sway 1.5s ease-in-out infinite, drunk-rainbow 3s linear infinite;
		filter: blur(0.8px);
		letter-spacing: 0.08em;
		word-spacing: 0.2em;
	}

	.drunk-obliterated .entry-narration .entry-text {
		animation: drunk-sway 1s ease-in-out infinite, drunk-rainbow 2s linear infinite, drunk-zoom 3s ease-in-out infinite;
		filter: blur(1.2px);
		letter-spacing: 0.12em;
		word-spacing: 0.3em;
	}

	@keyframes drunk-sway {
		0%, 100% { transform: translateX(0) rotate(0deg); }
		25% { transform: translateX(3px) rotate(0.3deg); }
		50% { transform: translateX(-2px) rotate(-0.2deg); }
		75% { transform: translateX(4px) rotate(0.4deg); }
	}

	@keyframes drunk-rainbow {
		0% { color: #ff5555; }
		16% { color: #ffaa33; }
		33% { color: #ffff55; }
		50% { color: #55ff55; }
		66% { color: #5555ff; }
		83% { color: #ff55ff; }
		100% { color: #ff5555; }
	}

	@keyframes drunk-zoom {
		0%, 100% { transform: scale(1); }
		50% { transform: scale(1.02); }
	}

	.drunk-indicator {
		margin-left: 0.5rem;
	}

	.romance-indicator {
		margin-left: 0.5rem;
		animation: romance-pulse 2s ease-in-out infinite;
	}

	@keyframes romance-pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}

	/* ── XP Progress Bar ───────────────────────────── */

	.xp-block {
		margin-top: 0.35rem;
	}

	.xp-label {
		font-size: 0.75rem;
		color: var(--green-dim);
		margin-bottom: 0.25rem;
		display: flex;
		justify-content: space-between;
	}

	.xp-numbers {
		color: #a78bfa;
	}

	.xp-next {
		font-size: 0.65rem;
		color: var(--gray);
	}

	.xp-bar {
		height: 6px;
		background: var(--bg-input);
		border-radius: 3px;
		overflow: hidden;
		border: 1px solid rgba(167, 139, 250, 0.25);
	}

	.xp-fill {
		height: 100%;
		background: linear-gradient(90deg, #7c3aed, #a78bfa);
		transition: width 0.5s;
		border-radius: 2px;
	}

	/* ── Quest Journal ─────────────────────────────── */

	.quest-block {
		/* inherits stat-block */
	}

	.quest-toggle {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		color: inherit;
		font: inherit;
	}

	.quest-chevron {
		font-size: 0.75rem;
		color: var(--green-dim);
	}

	.quest-list {
		margin-top: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.quest-item {
		padding: 0.35rem 0;
		border-left: 2px solid #a78bfa;
		padding-left: 0.5rem;
	}

	.quest-item.quest-complete {
		border-left-color: var(--green);
		opacity: 0.6;
	}

	.quest-item.quest-failed {
		border-left-color: var(--red);
		opacity: 0.5;
	}

	.quest-name {
		font-size: 0.8rem;
		color: var(--green);
		font-weight: 500;
	}

	.quest-complete .quest-name {
		color: var(--gray);
		text-decoration: line-through;
	}

	.quest-failed .quest-name {
		color: var(--red);
	}

	.quest-objectives {
		list-style: none;
		margin: 0.25rem 0 0 0;
		padding: 0;
	}

	.quest-objectives li {
		font-size: 0.7rem;
		color: var(--gray);
		padding: 0.1rem 0;
	}

	.quest-objectives li.obj-complete {
		color: var(--green-dim);
	}

	.obj-marker {
		margin-right: 0.25rem;
		font-size: 0.65rem;
	}

	/* ═══════════════════════════════════════════════════════ */
	/* LEVEL UP CELEBRATION                                   */
	/* ═══════════════════════════════════════════════════════ */

	.levelup-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		background: radial-gradient(ellipse at center, rgba(30, 20, 0, 0.92) 0%, rgba(0, 0, 0, 0.96) 100%);
		display: flex;
		align-items: center;
		justify-content: center;
		animation: levelup-fade-in 0.3s ease-out;
		cursor: pointer;
		overflow: hidden;
	}

	@keyframes levelup-fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.levelup-content {
		position: relative;
		text-align: center;
		z-index: 2;
	}

	.levelup-flash {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 600px;
		height: 600px;
		margin: -300px 0 0 -300px;
		border-radius: 50%;
		background: radial-gradient(circle, rgba(255, 200, 50, 0.3) 0%, transparent 70%);
		animation: levelup-pulse 2s ease-in-out infinite;
	}

	@keyframes levelup-pulse {
		0%, 100% { transform: scale(0.8); opacity: 0.4; }
		50% { transform: scale(1.2); opacity: 0.8; }
	}

	.levelup-label {
		position: relative;
		font-family: 'JetBrains Mono', monospace;
		font-size: 4rem;
		font-weight: 900;
		letter-spacing: 0.3em;
		color: #ffd700;
		text-shadow:
			0 0 20px rgba(255, 215, 0, 0.8),
			0 0 40px rgba(255, 180, 0, 0.6),
			0 0 80px rgba(255, 150, 0, 0.4),
			0 0 120px rgba(255, 100, 0, 0.2);
		animation: levelup-text-glow 1.5s ease-in-out infinite alternate, levelup-text-enter 0.6s cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes levelup-text-enter {
		from { transform: scale(0.3) translateY(30px); opacity: 0; }
		to { transform: scale(1) translateY(0); opacity: 1; }
	}

	@keyframes levelup-text-glow {
		from {
			text-shadow:
				0 0 20px rgba(255, 215, 0, 0.8),
				0 0 40px rgba(255, 180, 0, 0.6),
				0 0 80px rgba(255, 150, 0, 0.4);
		}
		to {
			text-shadow:
				0 0 30px rgba(255, 215, 0, 1),
				0 0 60px rgba(255, 180, 0, 0.8),
				0 0 100px rgba(255, 150, 0, 0.6),
				0 0 140px rgba(255, 100, 0, 0.3);
		}
	}

	.levelup-number {
		position: relative;
		font-family: 'JetBrains Mono', monospace;
		font-size: 8rem;
		font-weight: 900;
		color: #fff;
		text-shadow:
			0 0 30px rgba(255, 215, 0, 0.9),
			0 0 60px rgba(255, 180, 0, 0.7);
		animation: levelup-number-enter 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both;
		line-height: 1;
		margin-top: -0.5rem;
	}

	@keyframes levelup-number-enter {
		from { transform: scale(3); opacity: 0; filter: blur(10px); }
		to { transform: scale(1); opacity: 1; filter: blur(0); }
	}

	.levelup-subtitle {
		position: relative;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8rem;
		color: rgba(255, 215, 0, 0.5);
		letter-spacing: 0.2em;
		margin-top: 2rem;
		animation: levelup-fade-in 1s ease-out 1s both;
	}

	/* Particles */
	.levelup-particles {
		position: absolute;
		inset: 0;
		z-index: 1;
		pointer-events: none;
		overflow: hidden;
	}

	.levelup-particle {
		position: absolute;
		bottom: -10px;
		left: var(--x);
		width: 4px;
		height: 4px;
		background: #ffd700;
		border-radius: 50%;
		box-shadow: 0 0 6px 2px rgba(255, 215, 0, 0.6);
		animation: levelup-particle-rise var(--dur) ease-out var(--delay) infinite;
	}

	.levelup-particle:nth-child(odd) {
		background: #ffaa00;
		width: 3px;
		height: 3px;
		box-shadow: 0 0 4px 1px rgba(255, 170, 0, 0.5);
	}

	.levelup-particle:nth-child(3n) {
		background: #fff;
		width: 2px;
		height: 2px;
		box-shadow: 0 0 8px 3px rgba(255, 255, 255, 0.4);
	}

	@keyframes levelup-particle-rise {
		0% {
			transform: translateY(0) translateX(0) scale(0);
			opacity: 0;
		}
		10% {
			opacity: 1;
			transform: translateY(-10vh) translateX(0) scale(1);
		}
		100% {
			transform: translateY(-110vh) translateX(calc((var(--i) - 10) * 5px)) scale(0.3);
			opacity: 0;
		}
	}
</style>
