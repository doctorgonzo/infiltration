<script lang="ts">
	import type { Character, GameLogEntry } from '$lib/types';
	import { onMount } from 'svelte';

	// ── State ──────────────────────────────────────────────
	let phase = $state<'join' | 'play'>('join');
	let playerId = $state<string | null>(null);
	let character = $state<Character | null>(null);
	let messages = $state<GameLogEntry[]>([]);
	let input = $state('');
	let isLoading = $state(false);
	let sidebarOpen = $state(true);
	let eventSource: EventSource | null = null;
	let logContainer: HTMLDivElement | undefined = $state();

	// ── Character Creation ─────────────────────────────────
	let playerName = $state('');
	let characterName = $state('');
	let selectedClass = $state<string>('Strong Hero');
	let joinError = $state('');
	let isJoining = $state(false);
	let abilityRolls = $state<Array<{rolls: number[], dropped: number, total: number}>>([]);

	const heroClasses = [
		{ name: 'Strong Hero', key: 'STR', desc: 'Melee combat, feats of strength. The bat-swinger.', emoji: '💪' },
		{ name: 'Fast Hero', key: 'DEX', desc: 'Agility, stealth, reflexes. Hard to hit, hard to find.', emoji: '⚡' },
		{ name: 'Tough Hero', key: 'CON', desc: 'Takes a beating and keeps going. Wisconsin stubbornness personified.', emoji: '🛡️' },
		{ name: 'Smart Hero', key: 'INT', desc: 'Hacking, devices, research. The one who figures it out.', emoji: '🧠' },
		{ name: 'Dedicated Hero', key: 'WIS', desc: 'Perception, medicine, insight. Sees what others miss.', emoji: '👁️' },
		{ name: 'Charismatic Hero', key: 'CHA', desc: 'Persuasion, deception, leadership. Talks their way through.', emoji: '🎭' }
	];

	// ── Actions ────────────────────────────────────────────
	async function joinGame() {
		if (!playerName.trim() || !characterName.trim()) {
			joinError = 'Need both a player name and character name.';
			return;
		}

		isJoining = true;
		joinError = '';

		try {
			const res = await fetch('/api/join', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					playerName: playerName.trim(),
					characterName: characterName.trim(),
					heroClass: selectedClass
				})
			});

			const data = await res.json();

			if (!res.ok) {
				joinError = data.error || 'Failed to join. The Director is unresponsive.';
				return;
			}

			playerId = data.playerId;
			character = data.character;
			abilityRolls = data.abilityRolls;

			// Store in localStorage for reconnection
			localStorage.setItem('infiltration_playerId', data.playerId);

			phase = 'play';
			connectStream();
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

			if (!res.ok) {
				const data = await res.json();
				messages.push({
					timestamp: new Date().toISOString(),
					type: 'system',
					text: data.error || 'Action failed.'
				});
			}
			// Entries come through SSE stream, but refresh character state
			// so inventory/HP/location updates show immediately
			await refreshState();
		} catch (e) {
			messages.push({
				timestamp: new Date().toISOString(),
				type: 'system',
				text: 'Connection lost. Try again.'
			});
		} finally {
			isLoading = false;
		}
	}

	function connectStream() {
		if (eventSource) eventSource.close();

		eventSource = new EventSource('/api/stream');

		eventSource.onmessage = (event) => {
			try {
				const entry: GameLogEntry = JSON.parse(event.data);
				messages.push(entry);
				scrollToBottom();
			} catch {}
		};

		eventSource.onerror = () => {
			// Auto-reconnect is built into EventSource
			console.log('[stream] Connection interrupted, reconnecting...');
		};
	}

	function logout() {
		if (eventSource) eventSource.close();
		eventSource = null;
		localStorage.removeItem('infiltration_playerId');
		playerId = null;
		character = null;
		messages = [];
		playerName = '';
		characterName = '';
		phase = 'join';
	}

	async function refreshState() {
		if (!playerId) return;
		try {
			const res = await fetch(`/api/state?playerId=${playerId}`);
			const data = await res.json();
			if (data.character) {
				character = data.character;
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
		if (event.key === 'Enter' && !event.shiftKey) {
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

	function abilityMod(score: number): string {
		const mod = Math.floor((score - 10) / 2);
		return mod >= 0 ? `+${mod}` : `${mod}`;
	}

	// ── Lifecycle ──────────────────────────────────────────
	onMount(() => {
		// Check for existing session
		const savedId = localStorage.getItem('infiltration_playerId');
		if (savedId) {
			playerId = savedId;
			// Try to reconnect
			fetch(`/api/state?playerId=${savedId}`)
				.then(r => r.json())
				.then(data => {
					if (data.character) {
						character = data.character;
						phase = 'play';
						connectStream();
					} else {
						localStorage.removeItem('infiltration_playerId');
					}
				})
				.catch(() => {
					localStorage.removeItem('infiltration_playerId');
				});
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
<!-- CHARACTER CREATION SCREEN                                  -->
<!-- ═══════════════════════════════════════════════════════════ -->

{#if phase === 'join'}
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
				/>
			</div>

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

			{#if joinError}
				<div class="error-msg">{joinError}</div>
			{/if}

			<button
				class="join-button"
				onclick={joinGame}
				disabled={isJoining}
			>
				{#if isJoining}
					<span class="loading-dots">ROLLING DICE</span>
				{:else}
					ENTER MADISON
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
<!-- GAME INTERFACE                                             -->
<!-- ═══════════════════════════════════════════════════════════ -->

{:else}
<div class="game-layout">
	<!-- Sidebar -->
	<aside class="sidebar" class:collapsed={!sidebarOpen}>
		<button class="sidebar-toggle" onclick={() => sidebarOpen = !sidebarOpen}>
			{sidebarOpen ? '◀' : '▶'}
		</button>

		{#if sidebarOpen && character}
			<div class="sidebar-content">
				<!-- Character Header -->
				<div class="char-header">
					<h2 class="char-name">{character.name}</h2>
					<div class="char-class">{character.class} L{character.level}</div>
					<div class="char-xp">XP: {character.xp}</div>
				</div>

				<!-- HP Bar -->
				<div class="stat-block">
					<div class="hp-label">
						HP <span class="hp-numbers">{character.hp}/{character.maxHp}</span>
					</div>
					<div class="hp-bar">
						<div
							class="hp-fill"
							class:hp-low={character.hp / character.maxHp < 0.3}
							class:hp-mid={character.hp / character.maxHp >= 0.3 && character.hp / character.maxHp < 0.6}
							style="width: {(character.hp / character.maxHp) * 100}%"
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

				<!-- Logout -->
				<button class="logout-button" onclick={logout}>
					NEW CHARACTER
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
			</div>
			<div class="header-right">
				{#if isLoading}
					<span class="loading-indicator">THE DIRECTOR IS THINKING...</span>
				{/if}
				<span class="header-status">
					{character ? `HP ${character.hp}/${character.maxHp}` : ''}
				</span>
			</div>
		</div>

		<!-- Message Log -->
		<div class="message-log" bind:this={logContainer}>
			{#if messages.length === 0}
				<div class="empty-log">
					<p>The terminal hums softly. A cursor blinks.</p>
					<p class="hint">Type what you want to do. Look around. Talk to people. The world responds.</p>
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
							🎲 [{entry.roll.dice}] {entry.roll.result}
							{#if entry.roll.modifier !== 0}
								{entry.roll.modifier > 0 ? '+' : ''}{entry.roll.modifier} = {entry.roll.total}
							{/if}
							{#if entry.roll.dc}
								vs DC {entry.roll.dc}
							{/if}
							{#if entry.roll.success !== undefined}
								<span class:roll-success={entry.roll.success} class:roll-fail={!entry.roll.success}>
									{entry.roll.success ? 'SUCCESS' : 'FAIL'}
								</span>
							{/if}
						</span>
					{/if}
					<span class="entry-text">{@html formatNarration(entry.text)}</span>
				</div>
			{/each}
		</div>

		<!-- Input Bar -->
		<div class="input-bar">
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

	.empty-log .hint {
		margin-top: 0.5rem;
		color: var(--gray);
		font-size: 0.85rem;
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
		display: flex;
		align-items: center;
		padding: 0.75rem 1rem;
		background: var(--bg-panel);
		border-top: 1px solid var(--green-dark);
		gap: 0.5rem;
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
</style>
