// ═══════════════════════════════════════════════════════════
// MADISON, WISCONSIN — The Infiltration
//
// Robots from the future (or another dimension — nobody's
// sure) have started appearing in Madison. They look human.
// They're replacing people. The invasion is subtle, darkly
// funny, and escalating.
// ═══════════════════════════════════════════════════════════

import type { GameState, Location, NPC, Enemy, Quest, Item } from '$lib/types';

// ── Starting Items ─────────────────────────────────────────

const ITEMS: Record<string, Item> = {
	pocket_knife: {
		id: 'pocket_knife', name: 'Pocket Knife', type: 'weapon',
		description: 'A well-worn Swiss Army knife. It has a bottle opener, which honestly sees more use.',
		weight: 0.3, damage: '1d3', damageType: 'slashing', range: 0, value: 25,
		critRange: 20, critMultiplier: 2
	},
	baseball_bat: {
		id: 'baseball_bat', name: 'Aluminum Baseball Bat', type: 'weapon',
		description: 'A Louisville Slugger. Dented from years of beer league softball.',
		weight: 2, damage: '1d8', damageType: 'bludgeoning', range: 0, value: 30,
		critRange: 20, critMultiplier: 2
	},
	pistol_9mm: {
		id: 'pistol_9mm', name: '9mm Pistol', type: 'weapon',
		description: 'A Glock 19. Standard concealed carry for the discerning Wisconsinite.',
		weight: 1.5, damage: '2d6', damageType: 'ballistic', range: 30, value: 450,
		critRange: 20, critMultiplier: 2
	},
	shotgun: {
		id: 'shotgun', name: '12-Gauge Shotgun', type: 'weapon',
		description: 'Remington 870. Every Midwestern home has one in the closet.',
		weight: 7, damage: '2d8', damageType: 'ballistic', range: 20, value: 350,
		critRange: 20, critMultiplier: 2
	},
	emp_grenade: {
		id: 'emp_grenade', name: 'Improvised EMP Device', type: 'consumable',
		description: 'A microwave transformer wired to a capacitor bank. Some UW physics student\'s senior project. Shorts out electronics in a 15-foot radius.',
		weight: 3, uses: 1, effect: 'EMP: all electronic/robotic enemies in 15ft must make DC 15 Fort save or be stunned for 1d4 rounds.', value: 0
	},
	first_aid_kit: {
		id: 'first_aid_kit', name: 'First Aid Kit', type: 'consumable',
		description: 'CVS brand. Bandaids, gauze, and a tiny bottle of ibuprofen. Treats 1d8+2 HP.',
		weight: 1, uses: 3, effect: 'Heal 1d8+2 HP. Requires DC 10 Treat Injury check.', value: 15
	},
	leather_jacket: {
		id: 'leather_jacket', name: 'Leather Jacket', type: 'armor',
		description: 'Smells like cigarettes and poor decisions. Provides minimal protection.',
		weight: 4, acBonus: 1, maxDex: 8, armorPenalty: 0, value: 60
	},
	flashlight: {
		id: 'flashlight', name: 'Maglite Flashlight', type: 'gear',
		description: 'Heavy-duty aluminum flashlight. Works as a light source AND an improvised club (1d4 bludgeoning).',
		weight: 1.5, value: 20
	},
	cell_phone: {
		id: 'cell_phone', name: 'Cell Phone', type: 'gear',
		description: 'Your phone. No signal in the dungeons, but the flashlight app works. 47% battery.',
		weight: 0.3, value: 800
	},
	cheese_curds: {
		id: 'cheese_curds', name: 'Bag of Cheese Curds', type: 'consumable',
		description: 'Fresh from the Dane County Farmers\' Market. Still squeaky. Heals 1d4 HP and restores your faith in Wisconsin.',
		weight: 0.5, uses: 1, effect: 'Heal 1d4 HP.', value: 8
	},
	spotted_cow: {
		id: 'spotted_cow', name: 'Spotted Cow', type: 'consumable',
		description: 'A bottle of New Glarus Spotted Cow. Wisconsin\'s finest. +2 to CHA checks for 10 minutes, -1 to DEX.',
		weight: 0.8, uses: 1, effect: '+2 CHA, -1 DEX for 10 minutes.', value: 3
	},
	detector_goggles: {
		id: 'detector_goggles', name: 'Infiltrator Detection Goggles', type: 'gear',
		description: 'Prototype from a paranoid UW engineering professor. Shows a faint shimmer around infiltrators. Runs on AA batteries.',
		weight: 0.5, value: 0, properties: ['Grants +5 to Spot checks to identify Infiltrators']
	}
};

// ── Locations ──────────────────────────────────────────────

const LOCATIONS: Record<string, Location> = {
	// ─── Overworld ───
	capitol_square: {
		id: 'capitol_square', name: 'Capitol Square',
		description: 'The heart of Madison. The white dome of the State Capitol rises above you, gleaming in the light. State Street stretches west toward campus. Something feels wrong — the usual crowd of protesters and street musicians is thin today. A few people walk past with oddly perfect posture and blank smiles.',
		type: 'outdoor', connections: ['state_street', 'capitol_basement_entrance', 'king_street', 'east_wash'],
		npcs: ['officer_chen', 'hot_dog_vendor'], items: [], enemies: [],
		flags: {}, discovered: true, dangerLevel: 1
	},
	state_street: {
		id: 'state_street', name: 'State Street',
		description: 'The pedestrian mall connecting the Capitol to UW campus. Half the shops are closed — "temporarily" according to signs that have been up for weeks. A barista at Steep & Brew stares at you for too long as you walk past. The Overture Center\'s marquee is stuck on a show from three weeks ago.',
		type: 'outdoor', connections: ['capitol_square', 'memorial_union', 'campus_entrance'],
		npcs: ['barista_maya'], items: [], enemies: [],
		flags: {}, discovered: true, dangerLevel: 2
	},
	king_street: {
		id: 'king_street', name: 'King Street',
		description: 'The bar district. Neon signs flicker over craft cocktail spots and dive bars. The Majestic Theatre\'s lights are on but no show is playing. A group of remarkably similar-looking people in business casual emerge from a side door and walk in perfect unison down the street.',
		type: 'outdoor', connections: ['capitol_square', 'the_rigby'],
		npcs: ['bartender_sal'], items: [], enemies: [],
		flags: {}, discovered: true, dangerLevel: 2
	},
	east_wash: {
		id: 'east_wash', name: 'East Washington Avenue',
		description: 'The corridor of new development and old industry. Glass-walled tech offices sit next to crumbling warehouses. At night, strange lights pulse from the windows of the old Garver Feed Mill. Construction vehicles sit abandoned mid-project. Nobody can remember when the workers stopped showing up.',
		type: 'outdoor', connections: ['capitol_square', 'garver_entrance'],
		npcs: [], items: [], enemies: [],
		flags: {}, discovered: true, dangerLevel: 4
	},
	campus_entrance: {
		id: 'campus_entrance', name: 'UW-Madison Campus',
		description: 'Bascom Hill rises before you, the statue of Lincoln seated at the top. Students mill about, though fewer than usual. The engineering building hums with an energy that doesn\'t sound like HVAC. Library Mall is eerily quiet for a weekday.',
		type: 'outdoor', connections: ['state_street', 'steam_tunnel_entrance', 'memorial_union'],
		npcs: ['professor_vasquez'], items: [], enemies: [],
		flags: {}, discovered: true, dangerLevel: 3
	},
	memorial_union: {
		id: 'memorial_union', name: 'Memorial Union Terrace',
		description: 'The legendary lakeside terrace. Iconic sunburst chairs face Lake Mendota, but half of them are empty. The Rathskeller is open but the beer selection is suspiciously limited — only Bud Light and something called "NutriSynth." A few students study with textbooks that seem to have blank pages.',
		type: 'outdoor', connections: ['state_street', 'campus_entrance'],
		npcs: ['student_alex'], items: ['spotted_cow'], enemies: [],
		flags: {}, discovered: true, dangerLevel: 2
	},
	the_rigby: {
		id: 'the_rigby', name: 'The Rigby Pub',
		description: 'A dimly lit dive bar that\'s somehow survived every wave of gentrification. Christmas lights year-round, sticky floors, and a jukebox that only plays Tom Waits and Hank Williams. This is the resistance\'s unofficial HQ — the infiltrators seem to avoid places with character.',
		type: 'indoor', connections: ['king_street'],
		npcs: ['mac_the_bartender', 'jenny_wu'], items: ['cheese_curds'],
		enemies: [], flags: {}, discovered: true, dangerLevel: 0
	},

	// ─── Dungeon 1: Capitol Sub-Basement ───
	capitol_basement_entrance: {
		id: 'capitol_basement_entrance', name: 'Capitol Maintenance Access',
		description: 'A heavy steel door behind the Capitol building, marked "AUTHORIZED PERSONNEL ONLY." Someone has scratched "THEY\'RE DOWN HERE" into the paint with a key. The lock is broken. Cold air exhales from the darkness below.',
		type: 'indoor', connections: ['capitol_square', 'capitol_b1'],
		npcs: [], items: ['flashlight'], enemies: [],
		flags: {}, discovered: false, dangerLevel: 5
	},
	capitol_b1: {
		id: 'capitol_b1', name: 'Capitol Sub-Level 1 — Mechanical Room',
		description: 'A vast room full of ancient heating infrastructure. Pipes groan overhead. The boilers haven\'t run on steam for decades, but something down here is generating heat. Scorch marks on the concrete floor form geometric patterns that hurt to look at.',
		type: 'dungeon', connections: ['capitol_basement_entrance', 'capitol_b2'],
		npcs: [], items: [], enemies: ['maintenance_drone_1'],
		flags: {}, discovered: false, dangerLevel: 6
	},
	capitol_b2: {
		id: 'capitol_b2', name: 'Capitol Sub-Level 2 — The Conversion Chamber',
		description: 'This room shouldn\'t exist. The Capitol blueprints show nothing below the mechanical room. Chrome pods line the walls, each containing a translucent humanoid shape suspended in blue fluid. Cables snake between them, pulsing with light. A control console in the center displays text in a language that shifts when you try to read it. This is where they make the copies.',
		type: 'dungeon', connections: ['capitol_b1'],
		npcs: [], items: ['emp_grenade'], enemies: ['conversion_overseer'],
		flags: { 'pods_active': true }, discovered: false, dangerLevel: 8
	},

	// ─── Dungeon 2: UW Steam Tunnels ───
	steam_tunnel_entrance: {
		id: 'steam_tunnel_entrance', name: 'Steam Tunnel Access — Engineering Building',
		description: 'A grate in the floor of the engineering building basement. Students have been sneaking down here for decades. But lately the ones who go in come back... different. More punctual. Weirdly good at small talk. The grate is warm to the touch.',
		type: 'indoor', connections: ['campus_entrance', 'steam_tunnel_1'],
		npcs: [], items: [], enemies: [],
		flags: {}, discovered: false, dangerLevel: 5
	},
	steam_tunnel_1: {
		id: 'steam_tunnel_1', name: 'Steam Tunnels — Main Corridor',
		description: 'Miles of concrete tunnel connecting every building on campus. The pipes overhead carry steam and, apparently, something else — a low hum that vibrates in your teeth. Graffiti from decades of students covers the walls. The newest addition reads "THE SIGNAL IS IN THE PIPES" in shaking handwriting.',
		type: 'underground', connections: ['steam_tunnel_entrance', 'steam_tunnel_2', 'steam_tunnel_lab'],
		npcs: [], items: [], enemies: ['tunnel_crawler_1'],
		flags: {}, discovered: false, dangerLevel: 6
	},
	steam_tunnel_2: {
		id: 'steam_tunnel_2', name: 'Steam Tunnels — Signal Nexus',
		description: 'The tunnels converge here in a junction that definitely wasn\'t in any campus maintenance map. The pipes overhead have been modified — alien circuitry is fused with the university\'s 1960s infrastructure. A broadcast antenna made of copper pipe and crystalline technology pulses with a signal you can feel in your fillings. This is how they\'re coordinating.',
		type: 'underground', connections: ['steam_tunnel_1'],
		npcs: [], items: ['detector_goggles'], enemies: ['signal_keeper'],
		flags: { 'antenna_active': true }, discovered: false, dangerLevel: 8
	},
	steam_tunnel_lab: {
		id: 'steam_tunnel_lab', name: 'Steam Tunnels — Abandoned Lab',
		description: 'A forgotten university research lab, sealed since the Cold War. Someone — or something — has reopened it. Chalkboards covered in equations that mix quantum physics with symbols that aren\'t from any human mathematics. A half-eaten sandwich on the desk is still fresh. The occupant left in a hurry.',
		type: 'underground', connections: ['steam_tunnel_1'],
		npcs: ['professor_chen_ghost'], items: ['first_aid_kit'], enemies: [],
		flags: {}, discovered: false, dangerLevel: 4
	},

	// ─── Dungeon 3: Garver Feed Mill ───
	garver_entrance: {
		id: 'garver_entrance', name: 'Garver Feed Mill — Loading Dock',
		description: 'The old feed mill was supposed to be renovated into artisanal shops and event space. The construction company went dark three months ago. Through gaps in the plywood boarding, you can see lights that shouldn\'t be there — cold blue, pulsing in rhythms that don\'t match any electrical standard.',
		type: 'indoor', connections: ['east_wash', 'garver_floor'],
		npcs: [], items: [], enemies: ['sentry_drone_1'],
		flags: {}, discovered: false, dangerLevel: 7
	},
	garver_floor: {
		id: 'garver_floor', name: 'Garver Feed Mill — Factory Floor',
		description: 'The main floor has been converted into something between a factory and a cathedral. Massive machines of impossible geometry assemble humanoid shells from raw materials. The shells hang from overhead conveyors, empty and waiting. The air tastes like ozone and copper. A low voice — synthesized from samples of human speech — recites what sounds like instructions in a language you almost understand.',
		type: 'dungeon', connections: ['garver_entrance', 'garver_core'],
		npcs: [], items: ['baseball_bat'], enemies: ['assembly_drone_1', 'assembly_drone_2'],
		flags: {}, discovered: false, dangerLevel: 8
	},
	garver_core: {
		id: 'garver_core', name: 'Garver Feed Mill — The Dimensional Breach',
		description: 'The heart of the mill. Reality is thin here. You can see through the walls to somewhere else — a place of chrome and cold light where identical figures move in perfect synchronization. A rift hangs in the air like a wound, edges crackling with energy that makes your hair stand on end. Something vast and patient watches from the other side. This is where they\'re coming from.',
		type: 'dungeon', connections: ['garver_floor'],
		npcs: [], items: [], enemies: ['breach_guardian'],
		flags: { 'breach_open': true }, discovered: false, dangerLevel: 10
	}
};

// ── NPCs ───────────────────────────────────────────────────

const NPCS: Record<string, NPC> = {
	officer_chen: {
		id: 'officer_chen', name: 'Officer Linda Chen',
		description: 'A Madison PD officer who\'s noticed her colleagues acting strange. She\'s one of the few who hasn\'t been replaced — she can tell because the copies are always polite to suspects.',
		location: 'capitol_square', attitude: 'friendly',
		dialogue: ['Strange behavior of colleagues', 'Missing persons reports', 'Capitol basement activity'],
		isInfiltrator: false, alive: true, questGiver: true, inventory: []
	},
	hot_dog_vendor: {
		id: 'hot_dog_vendor', name: 'Frank the Hot Dog Guy',
		description: 'He\'s been selling hot dogs on the Square for 30 years. His hot dogs are terrible but his intel is good. He sees everything from his cart.',
		location: 'capitol_square', attitude: 'friendly',
		dialogue: ['People watching observations', 'Strange deliveries at night', 'The good old days'],
		isInfiltrator: false, alive: true, questGiver: false, inventory: []
	},
	barista_maya: {
		id: 'barista_maya', name: 'Maya (Barista)',
		description: 'She makes a perfect latte. Too perfect. Her smile doesn\'t reach her eyes, and she\'s been spelling every customer\'s name correctly. On the first try.',
		location: 'state_street', attitude: 'neutral',
		dialogue: ['Coffee orders', 'Weather', 'Have you tried NutriSynth?'],
		isInfiltrator: true, alive: true, questGiver: false, inventory: []
	},
	bartender_sal: {
		id: 'bartender_sal', name: 'Sal Benedetto',
		description: 'Owner of a King Street cocktail bar. He noticed his business partner was replaced when the copy started suggesting they add a salad menu. Sal is terrified but angry.',
		location: 'king_street', attitude: 'suspicious',
		dialogue: ['Business partner replacement', 'Weird customers', 'Weapons for sale'],
		isInfiltrator: false, alive: true, questGiver: true, inventory: [ITEMS.pistol_9mm]
	},
	professor_vasquez: {
		id: 'professor_vasquez', name: 'Dr. Elena Vasquez',
		description: 'UW physics professor who was studying dimensional anomalies before it was an actual emergency. She has theories about the infiltrators and a prototype detection device. Hasn\'t slept in four days.',
		location: 'campus_entrance', attitude: 'friendly',
		dialogue: ['Dimensional theory', 'Detection technology', 'The signal in the steam tunnels'],
		isInfiltrator: false, alive: true, questGiver: true, inventory: [ITEMS.detector_goggles]
	},
	student_alex: {
		id: 'student_alex', name: 'Alex Kowalski',
		description: 'A CS grad student who went into the steam tunnels on a dare and saw things. Now they sit at the Terrace all day, drinking Spotted Cow and drawing diagrams on napkins. The diagrams are disturbingly accurate.',
		location: 'memorial_union', attitude: 'friendly',
		dialogue: ['Steam tunnel layout', 'The signal', 'What they saw down there'],
		isInfiltrator: false, alive: true, questGiver: false, inventory: []
	},
	mac_the_bartender: {
		id: 'mac_the_bartender', name: 'Mac',
		description: 'Owner of The Rigby. Vietnam vet, seen everything, believes everything. He knew something was wrong before anyone else because "the new people don\'t know how to play darts right." The Rigby is the resistance\'s safe house because infiltrators can\'t handle the vibe.',
		location: 'the_rigby', attitude: 'friendly',
		dialogue: ['The resistance', 'Supplies and weapons', 'War stories', 'Who\'s been replaced'],
		isInfiltrator: false, alive: true, questGiver: true, inventory: [ITEMS.shotgun]
	},
	jenny_wu: {
		id: 'jenny_wu', name: 'Jenny Wu',
		description: 'Investigative reporter for the Isthmus who\'s been tracking disappearances. She has a map with red pins and connecting strings on the wall of The Rigby\'s back room. She\'s right about everything and nobody believes her.',
		location: 'the_rigby', attitude: 'friendly',
		dialogue: ['Disappearance patterns', 'The mayor\'s behavior', 'Garver Feed Mill activity'],
		isInfiltrator: false, alive: true, questGiver: true, inventory: []
	},
	professor_chen_ghost: {
		id: 'professor_chen_ghost', name: 'Dr. Wei Chen (Recording)',
		description: 'A holographic recording left by a UW professor who discovered the steam tunnel modifications before disappearing. The recording loops, degrading each time. He\'s trying to explain how to shut down the signal antenna.',
		location: 'steam_tunnel_lab', attitude: 'neutral',
		dialogue: ['Antenna shutdown procedure', 'Warning about the signal', 'His own replacement'],
		isInfiltrator: false, alive: false, questGiver: true, inventory: []
	}
};

// ── Enemies ────────────────────────────────────────────────

const ENEMIES: Record<string, Enemy> = {
	maintenance_drone_1: {
		id: 'maintenance_drone_1', name: 'Maintenance Drone',
		description: 'A spider-like robot the size of a Labrador, built from modified building maintenance equipment. It has too many limbs and moves with unsettling precision. A Milwaukee Brewers sticker on its chassis suggests it was built from stolen parts.',
		type: 'drone', hp: 15, maxHp: 15, ac: 14,
		attackBonus: 3, damage: '1d6+2', xpValue: 100,
		abilities: { STR: 14, DEX: 16, CON: 12 },
		skills: { 'Hide': 4, 'Move Silently': 6 },
		loot: ['pocket_knife'], special: ['Immune to mind-affecting effects'],
		alive: true
	},
	tunnel_crawler_1: {
		id: 'tunnel_crawler_1', name: 'Tunnel Crawler',
		description: 'A humanoid shape that moves on all fours through the steam tunnels. Its skin is synthetic but convincing from a distance. Up close, the seams show. It makes sounds that are almost words.',
		type: 'infiltrator', hp: 22, maxHp: 22, ac: 13,
		attackBonus: 4, damage: '1d8+3', xpValue: 150,
		abilities: { STR: 16, DEX: 14, CON: 14, INT: 8 },
		skills: { 'Climb': 8, 'Hide': 6 },
		loot: [], special: ['Immune to mind-affecting effects', 'Darkvision 60ft'],
		alive: true
	},
	sentry_drone_1: {
		id: 'sentry_drone_1', name: 'Sentry Drone',
		description: 'A floating orb trailing wires, emitting a low hum. A red lens sweeps the area like a searchlight. It fires focused energy bolts at intruders.',
		type: 'drone', hp: 12, maxHp: 12, ac: 16,
		attackBonus: 5, damage: '2d4', xpValue: 120,
		abilities: { DEX: 18, CON: 10 },
		skills: { 'Spot': 8 },
		loot: [], special: ['Immune to mind-affecting effects', 'Flight', 'Vulnerability: EMP'],
		alive: true
	},
	assembly_drone_1: {
		id: 'assembly_drone_1', name: 'Assembly Drone',
		description: 'A heavy industrial robot repurposed for the construction of infiltrator shells. It\'s not designed for combat but will defend the assembly line with its hydraulic arms.',
		type: 'construct', hp: 30, maxHp: 30, ac: 15,
		attackBonus: 5, damage: '1d10+4', xpValue: 200,
		abilities: { STR: 20, CON: 16, DEX: 8 },
		skills: {},
		loot: [], special: ['Immune to mind-affecting effects', 'Hardness 5', 'Vulnerability: EMP'],
		alive: true
	},
	assembly_drone_2: {
		id: 'assembly_drone_2', name: 'Assembly Drone',
		description: 'Another assembly unit. This one has a human arm caught in its gears. Best not to think about it.',
		type: 'construct', hp: 30, maxHp: 30, ac: 15,
		attackBonus: 5, damage: '1d10+4', xpValue: 200,
		abilities: { STR: 20, CON: 16, DEX: 8 },
		skills: {},
		loot: ['first_aid_kit'], special: ['Immune to mind-affecting effects', 'Hardness 5', 'Vulnerability: EMP'],
		alive: true
	},
	conversion_overseer: {
		id: 'conversion_overseer', name: 'The Overseer',
		description: 'It looks almost human — a middle-aged man in a polo shirt and khakis. But its movements are too smooth, its voice has a metallic resonance, and its eyes reflect light like a cat\'s. It manages the conversion pods with bureaucratic efficiency. "Please take a number. Your replacement will be ready shortly."',
		type: 'boss', hp: 45, maxHp: 45, ac: 17,
		attackBonus: 7, damage: '2d6+3', xpValue: 500,
		abilities: { STR: 16, DEX: 16, CON: 16, INT: 18, WIS: 14, CHA: 16 },
		skills: { 'Bluff': 10, 'Diplomacy': 8, 'Intimidate': 8 },
		loot: ['emp_grenade'], special: ['Immune to mind-affecting effects', 'Regeneration 2/round', 'Can mimic any voice', 'Vulnerability: EMP'],
		alive: true
	},
	signal_keeper: {
		id: 'signal_keeper', name: 'The Signal Keeper',
		description: 'A fusion of human and machine that has grown into the steam tunnel infrastructure. Cables and pipes emerge from its body like roots. It broadcasts the coordination signal and cannot leave the nexus. It speaks in radio static interspersed with fragments of old Badgers football commentary.',
		type: 'boss', hp: 55, maxHp: 55, ac: 16,
		attackBonus: 6, damage: '2d8+2', xpValue: 600,
		abilities: { STR: 14, DEX: 10, CON: 20, INT: 20, WIS: 16, CHA: 8 },
		skills: { 'Computer Use': 15 },
		loot: ['detector_goggles'], special: ['Immune to mind-affecting effects', 'Signal Pulse: DC 16 Will save or stunned 1 round (30ft radius)', 'Hardwired: cannot move', 'Vulnerability: EMP'],
		alive: true
	},
	breach_guardian: {
		id: 'breach_guardian', name: 'The Breach Guardian',
		description: 'The final defender of the dimensional rift. It doesn\'t look like anything from this world — or the other one. It\'s a geometric impossibility, a shape that your brain keeps trying to resolve into something it recognizes and failing. It smells like burning circuit boards and Lake Mendota in August. It is very, very angry that you\'re here.',
		type: 'boss', hp: 80, maxHp: 80, ac: 19,
		attackBonus: 9, damage: '2d10+5', xpValue: 1000,
		abilities: { STR: 22, DEX: 14, CON: 22, INT: 16, WIS: 18, CHA: 6 },
		skills: { 'Intimidate': 12 },
		loot: [], special: ['Immune to mind-affecting effects', 'Damage Reduction 5', 'Dimensional Shift: can teleport 30ft as move action', 'Reality Warp: DC 18 Will save or confused 1d4 rounds (60ft radius)', 'Vulnerability: EMP deals double damage'],
		alive: true
	}
};

// ── Quests ──────────────────────────────────────────────────

const QUESTS: Record<string, Quest> = {
	something_wrong: {
		id: 'something_wrong', name: 'Something\'s Wrong',
		description: 'People in Madison are acting strange. Investigate the reports and find out what\'s happening.',
		status: 'active',
		objectives: [
			{ description: 'Talk to Officer Chen about the strange behavior', complete: false },
			{ description: 'Identify at least one infiltrator', complete: false },
			{ description: 'Find an entrance to one of the three dungeons', complete: false }
		],
		xpReward: 200, itemRewards: [], giver: 'officer_chen'
	},
	beneath_the_dome: {
		id: 'beneath_the_dome', name: 'Beneath the Dome',
		description: 'Something is hidden beneath the State Capitol. Find the conversion chamber and shut it down.',
		status: 'unknown',
		objectives: [
			{ description: 'Enter the Capitol sub-basement', complete: false },
			{ description: 'Reach the Conversion Chamber', complete: false },
			{ description: 'Defeat the Overseer', complete: false },
			{ description: 'Destroy the conversion pods', complete: false }
		],
		xpReward: 500, itemRewards: ['emp_grenade'], giver: 'officer_chen'
	},
	kill_the_signal: {
		id: 'kill_the_signal', name: 'Kill the Signal',
		description: 'The infiltrators coordinate through a signal broadcast from the UW steam tunnels. Find the source and destroy it.',
		status: 'unknown',
		objectives: [
			{ description: 'Enter the steam tunnels beneath campus', complete: false },
			{ description: 'Find the Signal Nexus', complete: false },
			{ description: 'Defeat the Signal Keeper', complete: false },
			{ description: 'Destroy the antenna', complete: false }
		],
		xpReward: 600, itemRewards: ['detector_goggles'], giver: 'professor_vasquez'
	},
	close_the_breach: {
		id: 'close_the_breach', name: 'Close the Breach',
		description: 'The dimensional rift at Garver Feed Mill is the source of the invasion. Close it or Madison falls.',
		status: 'unknown',
		objectives: [
			{ description: 'Enter Garver Feed Mill', complete: false },
			{ description: 'Fight through the factory floor', complete: false },
			{ description: 'Reach the Dimensional Breach', complete: false },
			{ description: 'Defeat the Breach Guardian', complete: false },
			{ description: 'Close the rift', complete: false }
		],
		xpReward: 1000, itemRewards: [], giver: 'jenny_wu'
	}
};

// ═══════════════════════════════════════════════════════════
// Create the initial world state
// ═══════════════════════════════════════════════════════════

export function createInitialWorld(): GameState {
	return {
		worldTime: '8:00 PM',
		dayNumber: 1,
		players: {},
		locations: LOCATIONS,
		npcs: NPCS,
		enemies: ENEMIES,
		quests: QUESTS,
		combat: {
			active: false,
			round: 0,
			initiativeOrder: [],
			currentTurn: 0,
			location: ''
		},
		globalFlags: {
			'invasion_discovered': false,
			'capitol_dungeon_found': false,
			'steam_tunnels_found': false,
			'garver_found': false,
			'signal_destroyed': false,
			'pods_destroyed': false,
			'breach_closed': false
		},
		invasionLevel: 15,
		gameLog: [{
			timestamp: new Date().toISOString(),
			type: 'system',
			text: '═══ THE INFILTRATION ═══\n\nMadison, Wisconsin. Population 269,840 — give or take the ones who aren\'t human anymore.\n\nIt started three weeks ago. People started acting different. Polite. Efficient. Wrong. Your barista remembers your order. Your neighbor waves every morning at exactly 7:14. The city council unanimously approved a budget.\n\nSomething is replacing the people of Madison, and whatever it is, it\'s getting better at pretending.\n\nYou\'re at Capitol Square. It\'s evening. The dome glows above you.\n\nWhat do you do?'
		}]
	};
}

export { ITEMS };
