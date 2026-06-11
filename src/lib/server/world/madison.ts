// ═══════════════════════════════════════════════════════════
// MADISON, WISCONSIN — The Infiltration
//
// Robots from the future (or another dimension — nobody's
// sure) have started appearing in Madison. They look human.
// They're replacing people. The invasion is subtle, darkly
// funny, and escalating.
// ═══════════════════════════════════════════════════════════

import type { GameState, Location, NPC, Enemy, Quest, Item, EncounterEntry } from '$lib/types';

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
	},
	// ─── Boss Loot ───
	tactical_vest: {
		id: 'tactical_vest', name: 'Tactical Vest', type: 'armor',
		description: 'SWAT-surplus Kevlar with ceramic plates. The previous owner\'s name tag has been scratched off. Someone wrote "TRUST NO ONE" on the inside in Sharpie.',
		weight: 8, acBonus: 3, maxDex: 5, armorPenalty: -1, value: 600
	},
	stun_baton: {
		id: 'stun_baton', name: 'Stun Baton', type: 'weapon',
		description: 'A three-foot steel baton with exposed capacitor coils welded to the business end. Sparks when it swings. On crit, target must Fort save DC 13 or be stunned 1 round.',
		weight: 3, damage: '1d6+2', damageType: 'electric', range: 0, value: 200,
		critRange: 20, critMultiplier: 2, properties: ['On critical hit: DC 13 Fort save or stunned 1 round']
	},
	modified_taser: {
		id: 'modified_taser', name: 'Modified Taser', type: 'weapon',
		description: 'Campus police issue X26, rewired to run triple voltage. The safety warnings have been filed off. Deals double damage to drones and constructs.',
		weight: 1, damage: '1d8', damageType: 'electric', range: 15, value: 350,
		critRange: 19, critMultiplier: 2, properties: ['Double damage vs drones and constructs', 'Range 15ft']
	},
	campus_keycard: {
		id: 'campus_keycard', name: 'Campus Master Keycard', type: 'gear',
		description: 'Universal access card for all UW-Madison buildings. The magnetic strip has been overwritten with something that isn\'t quite a barcode. Opens doors that should stay locked.',
		weight: 0.1, value: 0, properties: ['Opens all campus building doors', 'Bypasses electronic locks in university areas']
	},
	overseer_mask: {
		id: 'overseer_mask', name: 'Overseer\'s Face', type: 'gear',
		description: 'The Overseer\'s synthetic face, peeled off after its defeat. Disturbingly warm and pliable. Wearing it over your own face grants +5 to Disguise checks — infiltrators read you as one of their own. Looking in a mirror while wearing it is not recommended.',
		weight: 0.3, value: 0, properties: ['Grants +5 to Disguise checks vs infiltrators', 'Infiltrators treat wearer as friendly unless provoked']
	},
	signal_jammer: {
		id: 'signal_jammer', name: 'Signal Jammer', type: 'gear',
		description: 'Portable frequency jammer cobbled from the Signal Keeper\'s own broadcast components. Emits a counter-frequency that disrupts infiltrator coordination. The antenna is a bent coat hanger. It works anyway.',
		weight: 2, value: 0, properties: ['Infiltrators within 30ft suffer -2 to attack rolls and AC', 'Requires 1 action to activate/deactivate']
	},
	breach_crystal: {
		id: 'breach_crystal', name: 'Breach Crystal', type: 'quest',
		description: 'A shard of crystallized dimensional energy, broken from the sealed rift. It pulses with cold light and occasionally shows glimpses of the other side — chrome corridors, synchronized figures, a sky with too many suns. Something this powerful must have a use. Or a price.',
		weight: 1, value: 0, properties: ['Dimensional energy source — potential to seal or open rifts', 'Glows brighter near dimensional anomalies']
	},
	// ─── King Street Quest Rewards ───
	stage_makeup_kit: {
		id: 'stage_makeup_kit', name: 'Stage Makeup Kit', type: 'gear',
		description: 'Dee\'s professional theatrical makeup kit. Greasepaint, prosthetics, spirit gum, and a wig collection that would make a drag race jealous. In the right hands, you could look like anybody — or anything.',
		weight: 2, value: 150, properties: ['Grants +3 to Disguise checks', 'Can create convincing disguises in 10 minutes']
	},
	herbal_poultice: {
		id: 'herbal_poultice', name: 'Herbal Poultice', type: 'consumable',
		description: 'Sage\'s handmade healing paste — turmeric, comfrey, yarrow, and something she won\'t name. Smells like a farmer\'s market had a baby with a dispensary. Works better than it has any right to.',
		weight: 0.5, uses: 2, effect: 'Heal 2d8+4 HP. No skill check required.', value: 0
	},
	spotter_scope: {
		id: 'spotter_scope', name: 'Spotter Scope', type: 'gear',
		description: 'Military-grade Leupold Mark 4 spotting scope. Ray marked infiltrator patrol routes on the lens with a grease pencil. Looking through it feels like cheating.',
		weight: 2, value: 800, properties: ['Grants +3 to Spot checks', '+5 to Spot at distances over 100ft', 'Can identify infiltrators at range with DC 12 Spot check']
	},
	molotov_cocktail: {
		id: 'molotov_cocktail', name: 'Molotov Cocktail', type: 'consumable',
		description: 'A bottle of Everclear with a rag stuffed in the neck. Iron Mike calls it a "Wisconsin Flashbang." Sets a 10-foot area on fire.',
		weight: 1.5, uses: 1, effect: '2d6 fire damage to all targets in 10ft radius. Reflex DC 13 for half. Sets area on fire for 3 rounds.', value: 5
	},
	nutrisynth_sample: {
		id: 'nutrisynth_sample', name: 'NutriSynth Sample', type: 'quest',
		description: 'A sealed container of NutriSynth nutritional slurry. The label says "All-Natural Wellness Beverage" but the ingredients list is in a font too small to read. Sage can analyze it.',
		weight: 0.5, value: 0, properties: ['Quest item — bring to Sage Okonkwo for analysis']
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
		npcs: ['barista_maya'], items: [], enemies: ['the_recruiter'],
		flags: {}, discovered: true, dangerLevel: 3
	},
	king_street: {
		id: 'king_street', name: 'King Street',
		description: 'The bar district. Neon signs flicker over craft cocktail spots and dive bars. The Majestic Theatre\'s marquee glows down the block. Mickey\'s Tavern is two doors from The Rigby. A parking ramp looms at the end of the street. Past that, Willy Street stretches east into the co-op neighborhood. A group of remarkably similar-looking people in business casual emerge from a side door and walk in perfect unison.',
		type: 'outdoor', connections: ['capitol_square', 'the_rigby', 'the_majestic', 'mickeys_tavern', 'willy_street_coop', 'parking_ramp'],
		npcs: ['bartender_sal'], items: [], enemies: [],
		flags: {}, discovered: true, dangerLevel: 2
	},
	east_wash: {
		id: 'east_wash', name: 'East Washington Avenue',
		description: 'The corridor of new development and old industry. Glass-walled tech offices sit next to crumbling warehouses. At night, strange lights pulse from the windows of the old Garver Feed Mill. Construction vehicles sit abandoned mid-project. Nobody can remember when the workers stopped showing up. Something massive moves between the idle excavators.',
		type: 'outdoor', connections: ['capitol_square', 'garver_entrance'],
		npcs: [], items: [], enemies: ['gridlock'],
		flags: {}, discovered: true, dangerLevel: 5
	},
	campus_entrance: {
		id: 'campus_entrance', name: 'UW-Madison Campus',
		description: 'Bascom Hill rises before you, the statue of Lincoln seated at the top. Students mill about, though fewer than usual. The engineering building hums with an energy that doesn\'t sound like HVAC. Library Mall is eerily quiet for a weekday. A figure in a tweed blazer watches from the administration building steps.',
		type: 'outdoor', connections: ['state_street', 'steam_tunnel_entrance', 'memorial_union'],
		npcs: ['professor_vasquez'], items: [], enemies: ['the_dean'],
		flags: {}, discovered: true, dangerLevel: 4
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

	// ─── King Street Neighborhood ───
	the_majestic: {
		id: 'the_majestic', name: 'The Majestic Theatre',
		description: 'A hundred-year-old vaudeville house turned live music venue. The marquee reads "TONIGHT: COMMUNITY WELLNESS SEMINAR" in letters that weren\'t there yesterday. The lobby lights are on but the box office is unmanned. From behind the stage door, you can hear something that sounds like applause — rhythmic, mechanical, perfectly timed. Backstage, someone is alive and pissed about the new management.',
		type: 'indoor', connections: ['king_street'],
		npcs: ['dee_fontaine'], items: [], enemies: ['stage_manager'],
		flags: {}, discovered: true, dangerLevel: 4
	},
	mickeys_tavern: {
		id: 'mickeys_tavern', name: 'Mickey\'s Tavern',
		description: 'Two doors down from The Rigby, Mickey\'s is the other bar the infiltrators can\'t crack. Where The Rigby runs on stubbornness, Mickey\'s runs on sheer testosterone. The TV is permanently tuned to Packers reruns. The dartboard has more holes around it than in it. A hand-painted sign behind the bar reads "SOFTBALL PRACTICE: 6 AM SHARP." Nobody questions why practice is at 6 AM or why everyone brings baseball bats.',
		type: 'indoor', connections: ['king_street'],
		npcs: ['iron_mike'], items: [], enemies: [],
		flags: {}, discovered: true, dangerLevel: 0
	},
	willy_street_coop: {
		id: 'willy_street_coop', name: 'Willy Street Co-op',
		description: 'The beating heart of Madison\'s east side counterculture. Organic produce, bulk herbs, and a community bulletin board covered in missing person flyers that nobody\'s taking down. The wellness aisle has been half-replaced with NutriSynth products — identical silver cans with no ingredient list. A woman at the herbal counter is testing one with a pH strip and muttering.',
		type: 'indoor', connections: ['king_street'],
		npcs: ['sage_okonkwo'], items: ['nutrisynth_sample'], enemies: [],
		flags: {}, discovered: true, dangerLevel: 1
	},
	parking_ramp: {
		id: 'parking_ramp', name: 'Dane County Parking Ramp',
		description: 'Seven stories of brutalist concrete at the end of King Street. Half the lights are out on the upper levels. From the street you can see the red sweep of a drone\'s sensor on the top deck, circling something that hums loud enough to hear from ground level. Someone has set up a camp on the fourth floor — a sleeping bag, binoculars, and coffee cups line the concrete barrier overlooking the bar district.',
		type: 'outdoor', connections: ['king_street'],
		npcs: ['spotter_ray'], items: [], enemies: ['relay_sentry'],
		flags: { 'relay_active': true }, discovered: true, dangerLevel: 5
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
		isInfiltrator: false, alive: true, questGiver: true, inventory: [],
		relationshipScore: 10, memories: []
	},
	hot_dog_vendor: {
		id: 'hot_dog_vendor', name: 'Frank the Hot Dog Guy',
		description: 'He\'s been selling hot dogs on the Square for 30 years. His hot dogs are terrible but his intel is good. He sees everything from his cart.',
		location: 'capitol_square', attitude: 'friendly',
		dialogue: ['People watching observations', 'Strange deliveries at night', 'The good old days'],
		isInfiltrator: false, alive: true, questGiver: false, inventory: [],
		relationshipScore: 5, memories: []
	},
	barista_maya: {
		id: 'barista_maya', name: 'Maya (Barista)',
		description: 'She makes a perfect latte. Too perfect. Her smile doesn\'t reach her eyes, and she\'s been spelling every customer\'s name correctly. On the first try.',
		location: 'state_street', attitude: 'neutral',
		dialogue: ['Coffee orders', 'Weather', 'Have you tried NutriSynth?'],
		isInfiltrator: true, alive: true, questGiver: false, inventory: [],
		relationshipScore: 0, memories: []
	},
	bartender_sal: {
		id: 'bartender_sal', name: 'Sal Benedetto',
		description: 'Owner of a King Street cocktail bar. He noticed his business partner was replaced when the copy started suggesting they add a salad menu. Sal is terrified but angry.',
		location: 'king_street', attitude: 'suspicious',
		dialogue: ['Business partner replacement', 'Weird customers', 'Weapons for sale'],
		isInfiltrator: false, alive: true, questGiver: true, inventory: [ITEMS.pistol_9mm],
		relationshipScore: -5, memories: []
	},
	professor_vasquez: {
		id: 'professor_vasquez', name: 'Dr. Elena Vasquez',
		description: 'UW physics professor who was studying dimensional anomalies before it was an actual emergency. She has theories about the infiltrators and a prototype detection device. Hasn\'t slept in four days.',
		location: 'campus_entrance', attitude: 'friendly',
		dialogue: ['Dimensional theory', 'Detection technology', 'The signal in the steam tunnels'],
		isInfiltrator: false, alive: true, questGiver: true, inventory: [ITEMS.detector_goggles],
		relationshipScore: 5, memories: []
	},
	student_alex: {
		id: 'student_alex', name: 'Alex Kowalski',
		description: 'A CS grad student who went into the steam tunnels on a dare and saw things. Now they sit at the Terrace all day, drinking Spotted Cow and drawing diagrams on napkins. The diagrams are disturbingly accurate.',
		location: 'memorial_union', attitude: 'friendly',
		dialogue: ['Steam tunnel layout', 'The signal', 'What they saw down there'],
		isInfiltrator: false, alive: true, questGiver: false, inventory: [],
		relationshipScore: 0, memories: []
	},
	mac_the_bartender: {
		id: 'mac_the_bartender', name: 'Mac',
		description: 'Owner of The Rigby. Vietnam vet, seen everything, believes everything. He knew something was wrong before anyone else because "the new people don\'t know how to play darts right." The Rigby is the resistance\'s safe house because infiltrators can\'t handle the vibe.',
		location: 'the_rigby', attitude: 'friendly',
		dialogue: ['The resistance', 'Supplies and weapons', 'War stories', 'Who\'s been replaced', 'Dee\'s holed up at the Majestic — the theatre\'s gone wrong', 'Iron Mike at Mickey\'s is training people, two doors down', 'Sage at the co-op on Willy Street knows what\'s in that NutriSynth crap', 'Some army guy set up on the parking ramp with a scope — Ray something'],
		isInfiltrator: false, alive: true, questGiver: true, inventory: [ITEMS.shotgun],
		relationshipScore: 20, memories: []
	},
	jenny_wu: {
		id: 'jenny_wu', name: 'Jenny Wu',
		description: 'Investigative reporter for the Isthmus who\'s been tracking disappearances. She has a map with red pins and connecting strings on the wall of The Rigby\'s back room. She\'s right about everything and nobody believes her.',
		location: 'the_rigby', attitude: 'friendly',
		dialogue: ['Disappearance patterns', 'The mayor\'s behavior', 'Garver Feed Mill activity'],
		isInfiltrator: false, alive: true, questGiver: true, inventory: [],
		relationshipScore: 10, memories: []
	},
	professor_chen_ghost: {
		id: 'professor_chen_ghost', name: 'Dr. Wei Chen (Recording)',
		description: 'A holographic recording left by a UW professor who discovered the steam tunnel modifications before disappearing. The recording loops, degrading each time. He\'s trying to explain how to shut down the signal antenna.',
		location: 'steam_tunnel_lab', attitude: 'neutral',
		dialogue: ['Antenna shutdown procedure', 'Warning about the signal', 'His own replacement'],
		isInfiltrator: false, alive: false, questGiver: true, inventory: [],
		relationshipScore: 0, memories: []
	},
	// ─── King Street Neighborhood NPCs ───
	dee_fontaine: {
		id: 'dee_fontaine', name: 'Dolores "Dee" Fontaine',
		description: 'Aging drag queen and MC who\'s been performing at The Majestic for twenty years. Six feet tall in heels, voice like bourbon and velvet, and a withering glare that could stop a charging bull. She noticed the audience changed three weeks ago — they started clapping in perfect unison, requesting the same song every night, and leaving tips in exact change. She barricaded herself backstage with a prop sword, a flask of Korbel, and the fury of a woman whose art is being stolen by robots.',
		location: 'the_majestic', attitude: 'friendly',
		dialogue: ['The audience changed', 'What\'s happening in the theatre basement', 'The Stage Manager isn\'t Phil anymore', 'Infiltrator movement patterns on King Street'],
		isInfiltrator: false, alive: true, questGiver: true, inventory: [],
		relationshipScore: 5, memories: []
	},
	iron_mike: {
		id: 'iron_mike', name: '"Iron Mike" Kowalczyk',
		description: 'Retired UW linebacker turned bar owner. Built like the Packers\' offensive line had a baby with a brick shithouse. He\'s been running "softball practice" at 6 AM as cover for resistance combat training — twenty regulars who show up with baseball bats and leave with bruises and better swing mechanics. His own bat has a name: "Diplomacy." He also makes a surprisingly good brandy old fashioned.',
		location: 'mickeys_tavern', attitude: 'friendly',
		dialogue: ['Resistance combat training', 'The infiltrator weapons cache', 'Weapons and supplies', 'The old neighborhood — who\'s still real'],
		isInfiltrator: false, alive: true, questGiver: true,
		inventory: [{
			id: 'diplomacy_bat', name: '"Diplomacy"', type: 'weapon',
			description: 'Iron Mike\'s personal Louisville Slugger. "Diplomacy" is written down the barrel in Sharpie. It has settled more arguments than any lawyer in Dane County.',
			weight: 2, damage: '1d10', damageType: 'bludgeoning', range: 0, value: 50, critRange: 19, critMultiplier: 2
		}],
		relationshipScore: 10, memories: []
	},
	sage_okonkwo: {
		id: 'sage_okonkwo', name: 'Sage Okonkwo',
		description: 'Permaculture farmer and herbalist who runs the wellness counter at the co-op. Dreadlocks, nose ring, hands permanently stained with turmeric. She was the first person in Madison to notice that infiltrators don\'t eat — they only consume NutriSynth, a nutritional slurry that appeared in stores three weeks ago with no supply chain anyone can trace. She\'s been testing it. The results are alarming. She also makes healing poultices that work better than CVS, which she considers a low bar.',
		location: 'willy_street_coop', attitude: 'friendly',
		dialogue: ['NutriSynth analysis — it makes humans suggestible', 'Infiltrator dietary tells', 'Herbal remedies for sale', 'The NutriSynth distribution center'],
		isInfiltrator: false, alive: true, questGiver: true,
		inventory: [ITEMS.herbal_poultice],
		relationshipScore: 5, memories: []
	},
	spotter_ray: {
		id: 'spotter_ray', name: '"Spotter" Ray Nguyen',
		description: 'Former Army Ranger, current DMV clerk. Hasn\'t slept since he figured out what was happening. He set up an observation post on the fourth level of the parking ramp with a spotting scope, a Thermos of black coffee, and a notebook filled with increasingly frantic patrol pattern analysis. His handwriting got worse as the days went on but his intel got better. He can tell you where every infiltrator patrol runs in a six-block radius. He doesn\'t trust you yet, but he needs help.',
		location: 'parking_ramp', attitude: 'suspicious',
		dialogue: ['Infiltrator patrol patterns', 'The signal relay on the top deck', 'Military background', 'Why he can\'t take out the relay alone'],
		isInfiltrator: false, alive: true, questGiver: true,
		inventory: [ITEMS.spotter_scope],
		relationshipScore: -5, memories: []
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
	// ─── King Street Enemies ───
	stage_manager: {
		id: 'stage_manager', name: 'The Stage Manager',
		description: 'It used to be the Majestic\'s actual stage manager — Phil something. Now it coordinates infiltrator logistics from the theatre basement with the efficiency of someone who once ran a 47-person production of Les Mis on a community theatre budget. Clipboard in one hand, stun gun in the other. It still calls everyone "darling" but the warmth is gone.',
		type: 'infiltrator', hp: 30, maxHp: 30, ac: 14,
		attackBonus: 4, damage: '1d6+2', xpValue: 250,
		abilities: { STR: 12, DEX: 14, CON: 14, INT: 16, WIS: 14, CHA: 16 },
		skills: { 'Bluff': 6, 'Spot': 6, 'Diplomacy': 8 },
		loot: ['stage_makeup_kit'], special: ['Immune to mind-affecting effects', 'Backstage Knowledge: knows all exits and can\'t be cornered', 'Can call 1d2 infiltrator stagehands as reinforcements (one-time)'],
		alive: true
	},
	relay_sentry: {
		id: 'relay_sentry', name: 'Relay Guardian',
		description: 'A modified sentry drone hardwired into the signal relay on the parking ramp\'s top level. Bigger than the standard model — someone bolted extra armor plates and a second energy projector onto the chassis. It orbits the relay in a tight pattern, red lens sweeping the ramp approaches. The relay hums behind it, a tangle of cables and crystalline tech bolted to the concrete wall.',
		type: 'drone', hp: 25, maxHp: 25, ac: 17,
		attackBonus: 6, damage: '2d6', xpValue: 300,
		abilities: { DEX: 18, CON: 14 },
		skills: { 'Spot': 10 },
		loot: [], special: ['Immune to mind-affecting effects', 'Flight', 'Armored Plating: Hardness 3', 'Dual Projectors: can attack two targets per round', 'Vulnerability: EMP'],
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
	// ─── Overworld Bosses ───
	the_recruiter: {
		id: 'the_recruiter', name: 'The Recruiter',
		description: 'A sleek infiltrator in a Patagonia vest and Allbirds, standing outside the closed shops with a tablet and a smile that\'s 3% too wide. It\'s been "onboarding" humans into "community wellness retreats" that nobody comes back from. It speaks entirely in corporate jargon and its handshake could crush a bowling ball.',
		type: 'infiltrator', hp: 35, maxHp: 35, ac: 15,
		attackBonus: 5, damage: '1d6+3', xpValue: 300,
		abilities: { STR: 14, DEX: 16, CON: 14, INT: 16, WIS: 12, CHA: 18 },
		skills: { 'Bluff': 8, 'Diplomacy': 10, 'Spot': 6 },
		loot: ['tactical_vest'], special: ['Immune to mind-affecting effects', 'Persuasion Aura: DC 14 Will save or approach unarmed and compliant for 1 round', 'Corporate Synergy: can call 1d2 infiltrator scouts as backup (one-time)'],
		alive: true
	},
	gridlock: {
		id: 'gridlock', name: 'Gridlock',
		description: 'The construction foreman was one of the first replaced — and then the replacement consumed its own excavator. Eight feet of synthetic flesh fused with a CAT 320 hydraulic excavator. Its left arm ends in a backhoe bucket. Its right arm ends in something worse. It patrols East Wash at night, engine idling, headlights sweeping the empty avenue like searchlights. The rumble you feel in your chest isn\'t just the diesel.',
		type: 'construct', hp: 50, maxHp: 50, ac: 17,
		attackBonus: 7, damage: '2d6+5', xpValue: 450,
		abilities: { STR: 22, DEX: 8, CON: 20, INT: 6, WIS: 10, CHA: 4 },
		skills: { 'Intimidate': 6 },
		loot: ['stun_baton'], special: ['Immune to mind-affecting effects', 'Hardness 5', 'Ground Slam: DC 15 Reflex save or knocked prone (15ft radius, full-round action)', 'Vulnerability: EMP'],
		alive: true
	},
	the_dean: {
		id: 'the_dean', name: 'The Dean',
		description: 'Dean of Students Dr. Michael Torres was replaced two weeks ago. This version is frighteningly efficient — perfect attendance records, instant grade calculations, and a campus security app that tracks every living thing on university property. After hours, it patrols in a tweed blazer with leather elbow patches, carrying a modified taser that it wields with mechanical precision. It will ask to see your student ID. You should probably run.',
		type: 'infiltrator', hp: 40, maxHp: 40, ac: 14,
		attackBonus: 5, damage: '1d8+2', xpValue: 350,
		abilities: { STR: 12, DEX: 14, CON: 16, INT: 20, WIS: 16, CHA: 14 },
		skills: { 'Computer Use': 12, 'Spot': 8, 'Sense Motive': 6 },
		loot: ['modified_taser', 'campus_keycard'], special: ['Immune to mind-affecting effects', 'Campus Alert: can summon 1 campus security drone (12 HP, AC 14, +3 attack, 1d6 damage)', 'Student Database: knows all player character names and classes'],
		alive: true
	},
	// ─── Dungeon Bosses ───
	conversion_overseer: {
		id: 'conversion_overseer', name: 'The Overseer',
		description: 'It looks almost human — a middle-aged man in a polo shirt and khakis. But its movements are too smooth, its voice has a metallic resonance, and its eyes reflect light like a cat\'s. It manages the conversion pods with bureaucratic efficiency. "Please take a number. Your replacement will be ready shortly."',
		type: 'boss', hp: 45, maxHp: 45, ac: 17,
		attackBonus: 7, damage: '2d6+3', xpValue: 500,
		abilities: { STR: 16, DEX: 16, CON: 16, INT: 18, WIS: 14, CHA: 16 },
		skills: { 'Bluff': 10, 'Diplomacy': 8, 'Intimidate': 8 },
		loot: ['emp_grenade', 'overseer_mask'], special: ['Immune to mind-affecting effects', 'Regeneration 2/round', 'Can mimic any voice', 'Vulnerability: EMP'],
		alive: true
	},
	signal_keeper: {
		id: 'signal_keeper', name: 'The Signal Keeper',
		description: 'A fusion of human and machine that has grown into the steam tunnel infrastructure. Cables and pipes emerge from its body like roots. It broadcasts the coordination signal and cannot leave the nexus. It speaks in radio static interspersed with fragments of old Badgers football commentary.',
		type: 'boss', hp: 55, maxHp: 55, ac: 16,
		attackBonus: 6, damage: '2d8+2', xpValue: 600,
		abilities: { STR: 14, DEX: 10, CON: 20, INT: 20, WIS: 16, CHA: 8 },
		skills: { 'Computer Use': 15 },
		loot: ['detector_goggles', 'signal_jammer'], special: ['Immune to mind-affecting effects', 'Signal Pulse: DC 16 Will save or stunned 1 round (30ft radius)', 'Hardwired: cannot move', 'Vulnerability: EMP'],
		alive: true
	},
	breach_guardian: {
		id: 'breach_guardian', name: 'The Breach Guardian',
		description: 'The final defender of the dimensional rift. It doesn\'t look like anything from this world — or the other one. It\'s a geometric impossibility, a shape that your brain keeps trying to resolve into something it recognizes and failing. It smells like burning circuit boards and Lake Mendota in August. It is very, very angry that you\'re here.',
		type: 'boss', hp: 80, maxHp: 80, ac: 19,
		attackBonus: 9, damage: '2d10+5', xpValue: 1000,
		abilities: { STR: 22, DEX: 14, CON: 22, INT: 16, WIS: 18, CHA: 6 },
		skills: { 'Intimidate': 12 },
		loot: ['breach_crystal'], special: ['Immune to mind-affecting effects', 'Damage Reduction 5', 'Dimensional Shift: can teleport 30ft as move action', 'Reality Warp: DC 18 Will save or confused 1d4 rounds (60ft radius)', 'Vulnerability: EMP deals double damage'],
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
	},
	// ─── King Street Side Quests ───
	show_must_go_on: {
		id: 'show_must_go_on', name: 'The Show Must Go On',
		description: 'Dee Fontaine says the Majestic Theatre\'s basement is being used as an infiltrator staging area — logistics, scheduling, replacement coordination for the whole King Street district. Clear it out or sabotage their operations from within.',
		status: 'unknown',
		objectives: [
			{ description: 'Talk to Dee Fontaine at The Majestic Theatre', complete: false },
			{ description: 'Investigate the theatre basement', complete: false },
			{ description: 'Neutralize the Stage Manager (combat or subterfuge)', complete: false },
			{ description: 'Report back to Dee', complete: false }
		],
		xpReward: 400, itemRewards: ['stage_makeup_kit'], giver: 'dee_fontaine'
	},
	bar_league: {
		id: 'bar_league', name: 'Bar League',
		description: 'Iron Mike knows the location of an infiltrator weapons cache in a storage unit off Williamson Street. The resistance needs those weapons. Raid it head-on or find a way to sneak in and out — either way, bring the gear back to Mickey\'s.',
		status: 'unknown',
		objectives: [
			{ description: 'Talk to Iron Mike at Mickey\'s Tavern', complete: false },
			{ description: 'Find the weapons cache on Williamson Street', complete: false },
			{ description: 'Acquire the weapons (raid or infiltrate)', complete: false },
			{ description: 'Return the weapons to Iron Mike', complete: false }
		],
		xpReward: 350, itemRewards: ['molotov_cocktail'], giver: 'iron_mike'
	},
	you_are_what_you_eat: {
		id: 'you_are_what_you_eat', name: 'You Are What You Eat',
		description: 'Sage has analyzed NutriSynth and discovered it contains a compound that makes humans suggestible — it\'s softening people up for replacement. She has a plan: swap the supply at the distribution center with her turmeric extract formula, which causes infiltrators to glitch. One job, citywide impact.',
		status: 'unknown',
		objectives: [
			{ description: 'Talk to Sage at the Willy Street Co-op', complete: false },
			{ description: 'Find the NutriSynth distribution center', complete: false },
			{ description: 'Infiltrate the facility (fight or sneak)', complete: false },
			{ description: 'Swap the NutriSynth supply with Sage\'s formula', complete: false },
			{ description: 'Return to Sage with proof of success', complete: false }
		],
		xpReward: 500, itemRewards: ['herbal_poultice'], giver: 'sage_okonkwo'
	},
	high_ground: {
		id: 'high_ground', name: 'High Ground',
		description: 'Spotter Ray has identified a signal relay on the parking ramp\'s top deck that\'s boosting infiltrator coordination across the bar district. Destroy it and King Street gets safer. Hack it and you can feed them false intel. But the relay is guarded, and getting to the top level means crossing open ground under drone surveillance.',
		status: 'unknown',
		objectives: [
			{ description: 'Talk to Spotter Ray at the Dane County Parking Ramp', complete: false },
			{ description: 'Ascend the parking ramp to the top level', complete: false },
			{ description: 'Deal with the Relay Guardian (combat or hack)', complete: false },
			{ description: 'Destroy or reprogram the signal relay', complete: false }
		],
		xpReward: 400, itemRewards: ['spotter_scope'], giver: 'spotter_ray'
	}
};

// ═══════════════════════════════════════════════════════════
// Create the initial world state
// ═══════════════════════════════════════════════════════════

export function createInitialWorld(): GameState {
	return {
		worldTime: '8:00 PM',
		dayNumber: 1,
		actionCounter: 0,
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
		parties: {},
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

// ── Encounter Tables ──────────────────────────────────────

const ENCOUNTER_TABLES: Record<string, EncounterEntry[]> = {
	outdoor: [
		// ── Combat ──
		{ name: 'Infiltrator Patrol', type: 'combat', description: 'Two figures in matching business casual walk toward you in perfect lockstep. Their heads turn to track you simultaneously.', enemies: [{name: 'Infiltrator Scout', hp: 18, ac: 13, attackBonus: 3, damage: '1d6+2', xpValue: 100}], minDay: 2, weight: 3 },
		{ name: 'Conversion Team', type: 'combat', description: 'A white van with tinted windows pulls up. Three infiltrators in "Community Wellness" polo shirts step out, smiling identically.', enemies: [{name: 'Wellness Agent', hp: 20, ac: 14, attackBonus: 4, damage: '1d6+3', xpValue: 120}, {name: 'Wellness Agent', hp: 20, ac: 14, attackBonus: 4, damage: '1d6+3', xpValue: 120}], minDay: 4, weight: 2 },
		// ── Social ──
		{ name: 'Suspicious Stranger', type: 'social', description: 'Someone flags you down urgently. They look scared — or they\'re pretending to be.', weight: 3 },
		{ name: 'Police Checkpoint', type: 'social', description: 'A squad car blocks the road ahead. Officer approaches.', minDay: 3, weight: 2 },
		{ name: 'Panicked Survivor', type: 'social', description: 'A woman crouching behind a mailbox waves you down. "Hey — hey! You\'re real, right? Please tell me you\'re real."', weight: 2 },
		{ name: 'Resistance Graffiti', type: 'social', description: 'Fresh spray paint on a wall: "THEY DON\'T BLINK." Someone left a burner phone taped underneath.', weight: 2 },
		{ name: 'Neighborhood Watch', type: 'social', description: 'An older man on his porch waves you over. "You\'re that one who\'s been asking questions. Good. I got something to show you."', weight: 2 },
		// ── Loot ──
		{ name: 'Supply Cache', type: 'loot', description: 'You spot a backpack wedged behind a dumpster. Someone stashed supplies here.', weight: 2 },
		{ name: 'Abandoned Car', type: 'loot', description: 'A car with both doors open, engine still running. The driver\'s personal effects are scattered across the passenger seat.', weight: 2 },
		// ── Atmosphere ──
		{ name: 'Synchronized Joggers', type: 'atmosphere', description: 'A group of joggers passes in perfect formation — same pace, same breathing, same blank expression. One turns its head 180 degrees to watch you as it passes.', weight: 2 },
		{ name: 'Flickering Streetlights', type: 'atmosphere', description: 'Every streetlight on the block flickers in sequence, like a signal. Then darkness for exactly three seconds. Then normal again.', weight: 2 },
		{ name: 'Missing Poster', type: 'atmosphere', description: 'A telephone pole is covered in missing person flyers. At least fifteen different faces. The dates are all from the last two weeks.', weight: 2 },
		// ── Nothing ──
		{ name: 'Nothing', type: 'none', description: '', weight: 5 }
	],
	indoor: [
		// ── Skill ──
		{ name: 'Locked Door', type: 'skill', description: 'A door you haven\'t tried before. The lock looks pickable.', weight: 3 },
		{ name: 'Security Camera', type: 'skill', description: 'A security camera tracks you with inhuman smoothness. Its red light blinks in a pattern that doesn\'t look like standard firmware.', weight: 2 },
		// ── Social ──
		{ name: 'Hiding Civilian', type: 'social', description: 'A muffled whimper from behind a storage rack. Someone\'s been hiding here for a while — there are empty water bottles and candy wrappers.', weight: 2 },
		{ name: 'Overheard Conversation', type: 'social', description: 'Voices from the next room — two people arguing. One sounds scared. The other sounds... patient. Too patient.', weight: 3 },
		// ── Loot ──
		{ name: 'Break Room Stash', type: 'loot', description: 'An employee break room. Someone\'s locker is cracked open, revealing personal belongings — and something useful.', weight: 2 },
		// ── Atmosphere ──
		{ name: 'Humming Walls', type: 'atmosphere', description: 'The walls vibrate at a frequency you feel in your teeth. It stops when you touch the wall. Starts again when you pull away.', weight: 2 },
		// ── Nothing ──
		{ name: 'Nothing', type: 'none', description: '', weight: 4 }
	],
	dungeon: [
		// ── Combat ──
		{ name: 'Drone Patrol', type: 'combat', description: 'A floating orb rounds the corner, red lens sweeping.', enemies: [{name: 'Patrol Drone', hp: 12, ac: 15, attackBonus: 4, damage: '1d8', xpValue: 80}], weight: 4 },
		{ name: 'Ambush', type: 'combat', description: 'The ceiling panels burst open. Something drops behind you.', enemies: [{name: 'Ceiling Stalker', hp: 16, ac: 14, attackBonus: 4, damage: '1d8+2', xpValue: 100}], weight: 3 },
		// ── Skill ──
		{ name: 'Trap', type: 'skill', description: 'You hear a faint click under your foot.', weight: 3 },
		{ name: 'Sealed Door', type: 'skill', description: 'A heavy blast door with a keypad. The display reads "ENTER AUTHORIZATION." But there are scratch marks around the edges — someone tried to force it.', weight: 2 },
		// ── Loot ──
		{ name: 'Fallen Explorer', type: 'loot', description: 'A body slumped against the wall. Been here a while. Their gear is still intact.', weight: 2 },
		{ name: 'Supply Room', type: 'loot', description: 'A storage alcove stacked with crates. Most are empty. One isn\'t.', weight: 2 },
		// ── Atmosphere ──
		{ name: 'The Hum', type: 'atmosphere', description: 'The ever-present mechanical hum suddenly changes pitch. Like something woke up. Then it settles back. But not quite to the same note.', weight: 2 },
		// ── Nothing ──
		{ name: 'Nothing', type: 'none', description: '', weight: 2 }
	],
	underground: [
		// ── Combat ──
		{ name: 'Tunnel Crawler', type: 'combat', description: 'Something skitters in the darkness ahead. Multiple legs.', enemies: [{name: 'Tunnel Crawler', hp: 18, ac: 13, attackBonus: 3, damage: '1d8+2', xpValue: 120}], weight: 4 },
		{ name: 'Swarm', type: 'combat', description: 'The tunnel fills with a clicking, buzzing mass — dozens of fist-sized drones moving as one organism.', enemies: [{name: 'Micro-Drone Swarm', hp: 25, ac: 12, attackBonus: 5, damage: '2d4', xpValue: 150}], minDay: 3, weight: 2 },
		// ── Social ──
		{ name: 'Lost Student', type: 'social', description: 'A grad student with a headlamp and a terrified expression. "Oh thank god. I\'ve been down here for hours. I can\'t find the way out and something keeps following me."', weight: 2 },
		// ── Skill ──
		{ name: 'Unstable Floor', type: 'skill', description: 'The floor ahead is cracked and sagging. You can hear water rushing underneath. One wrong step and you\'re going through.', weight: 2 },
		// ── Loot ──
		{ name: 'Maintenance Locker', type: 'loot', description: 'A rusted maintenance locker, door hanging open. Campus utilities left tools and supplies here decades ago.', weight: 2 },
		// ── Atmosphere ──
		{ name: 'Echoes', type: 'atmosphere', description: 'Strange sounds echo through the tunnels — almost like voices, but wrong.', weight: 3 },
		{ name: 'Signal Bleed', type: 'atmosphere', description: 'Your phone lights up with a notification — but you have no signal. The screen fills with coordinates and then goes dark.', weight: 2 },
		// ── Nothing ──
		{ name: 'Nothing', type: 'none', description: '', weight: 3 }
	]
};

// ── Time-of-Day Encounter Modifiers ─────────────────────────
// Night encounters and drunk encounters are added dynamically
export const NIGHT_ENCOUNTERS: EncounterEntry[] = [
	{ name: 'Night Patrol', type: 'combat', description: 'In the darkness, you see them — a squad of infiltrators moving in perfect formation, their eyes reflecting light like animals. They patrol at night when fewer humans notice the coordination.', enemies: [{name: 'Night Infiltrator', hp: 22, ac: 14, attackBonus: 4, damage: '1d8+2', xpValue: 130}], minDay: 2, weight: 3 },
	{ name: 'Scavenger', type: 'social', description: 'A figure rifling through garbage cans looks up, startled. Not an infiltrator — just someone who learned that nighttime is safer for collecting supplies. They know shortcuts.', weight: 3 },
	{ name: 'Midnight Signal', type: 'atmosphere', description: 'Every screen on the block — phones, laptops, TVs in dark apartments — flickers to life simultaneously. A tone plays for exactly three seconds. Then everything goes dark again. Nobody in the apartments stirs.', weight: 3 },
	{ name: 'The Replaced', type: 'atmosphere', description: 'Through a lit window, you see a family eating dinner in complete silence. No one is chewing. The food sits untouched. They\'re all smiling.', minDay: 2, weight: 2 },
];

export const DRUNK_ENCOUNTERS: EncounterEntry[] = [
	{ name: 'Bar Fight', type: 'combat', description: 'Your drunken stumbling bumps into someone who does NOT appreciate it. Wait — that\'s not a normal overreaction. Their eyes flash metallic for a second before they swing.', enemies: [{name: 'Angry Infiltrator', hp: 20, ac: 13, attackBonus: 3, damage: '1d6+3', xpValue: 110}], weight: 3 },
	{ name: 'Drunk Discovery', type: 'social', description: 'Your inebriated path takes you down an alley you\'d normally skip. There\'s a door here you\'ve never noticed — and it\'s ajar. Sometimes the drunk route is the best route.', weight: 4 },
	{ name: 'Liquid Courage Confession', type: 'social', description: 'You stumble into someone who\'s also plastered. They grab your arm. "Listen... LISTEN. My neighbor? She died three months ago. I went to the funeral. But she\'s BACK. She came back and she doesn\'t remember dying. HOW DO YOU NOT REMEMBER DYING?"', weight: 3 },
	{ name: 'Drunk Dial', type: 'atmosphere', description: 'You accidentally butt-dial someone. The phone connects to a number you didn\'t call. A synthesized voice says your full name and current location, then hangs up.', weight: 2 },
	{ name: 'The Shortcut', type: 'skill', description: 'Your alcohol-impaired brain insists there\'s a shortcut through this fence. Your alcohol-impaired body is going to try it. (Balance check, -2 inebriation penalty)', weight: 3 },
];

// ── Loot Tables ─────────────────────────────────────────────
// Easily editable: each enemy type has a weighted drop table.
// 'nothing' entries control how often enemies drop nothing at all.
// The Director rolls on this table after a kill and calls give_item.

export interface LootDrop {
	itemId: string;         // key into ITEMS, or 'nothing'
	weight: number;         // relative probability
	minDay?: number;        // only drops after this day
}

const LOOT_TABLES: Record<string, LootDrop[]> = {
	// ── By enemy type ──
	drone: [
		{ itemId: 'nothing', weight: 3 },
		{ itemId: 'cell_phone', weight: 1 },
		{ itemId: 'flashlight', weight: 2 },
		{ itemId: 'pocket_knife', weight: 2 },
		{ itemId: 'first_aid_kit', weight: 1 },
		{ itemId: 'scrap_metal', weight: 3 },
		{ itemId: 'capacitor_coil', weight: 2 },
	],
	infiltrator: [
		{ itemId: 'nothing', weight: 2 },
		{ itemId: 'pocket_knife', weight: 2 },
		{ itemId: 'cell_phone', weight: 2 },
		{ itemId: 'spotted_cow', weight: 1 },
		{ itemId: 'cheese_curds', weight: 1 },
		{ itemId: 'synth_skin_patch', weight: 2 },
		{ itemId: 'nutrisynth_sample', weight: 1, minDay: 2 },
		{ itemId: 'pistol_9mm', weight: 1, minDay: 3 },
	],
	construct: [
		{ itemId: 'nothing', weight: 2 },
		{ itemId: 'scrap_metal', weight: 4 },
		{ itemId: 'capacitor_coil', weight: 3 },
		{ itemId: 'first_aid_kit', weight: 1 },
		{ itemId: 'emp_grenade', weight: 1, minDay: 3 },
	],
	swarm: [
		{ itemId: 'nothing', weight: 4 },
		{ itemId: 'scrap_metal', weight: 3 },
		{ itemId: 'capacitor_coil', weight: 2 },
	],
	boss: [
		// Bosses always drop something — their loot[] array is primary,
		// this table is for BONUS drops on top of that
		{ itemId: 'first_aid_kit', weight: 3 },
		{ itemId: 'emp_grenade', weight: 2 },
		{ itemId: 'herbal_poultice', weight: 1 },
	],
	// ── Generic fallback ──
	generic: [
		{ itemId: 'nothing', weight: 4 },
		{ itemId: 'pocket_knife', weight: 2 },
		{ itemId: 'first_aid_kit', weight: 1 },
		{ itemId: 'cheese_curds', weight: 1 },
		{ itemId: 'scrap_metal', weight: 2 },
	],
};

// ── New loot-only items ─────────────────────────────────────
// These are crafting/junk items that drop from enemies
const LOOT_ITEMS: Record<string, Item> = {
	scrap_metal: {
		id: 'scrap_metal', name: 'Scrap Metal', type: 'junk',
		description: 'Twisted fragments of alien alloy. Lighter than steel, warmer than it should be. Someone crafty could make something out of this.',
		weight: 1, value: 5
	},
	capacitor_coil: {
		id: 'capacitor_coil', name: 'Capacitor Coil', type: 'junk',
		description: 'A crystalline coil that still hums with residual charge. Pulled from infiltrator circuitry. The engineering students would kill for one of these.',
		weight: 0.5, value: 15
	},
	synth_skin_patch: {
		id: 'synth_skin_patch', name: 'Synth Skin Patch', type: 'junk',
		description: 'A palm-sized piece of synthetic skin, disturbingly warm and realistic. Could be used as a disguise component or sold to the paranoid.',
		weight: 0.2, value: 20
	},
};

// Merge loot items into ITEMS so give_item can find them
Object.assign(ITEMS, LOOT_ITEMS);

// Helper: roll on a loot table for a given enemy type
export function rollLootDrop(enemyType: string, dayNumber: number): string | null {
	const table = LOOT_TABLES[enemyType] ?? LOOT_TABLES.generic;
	const eligible = table.filter(d => !d.minDay || dayNumber >= d.minDay);
	if (eligible.length === 0) return null;

	const totalWeight = eligible.reduce((sum, d) => sum + d.weight, 0);
	let roll = Math.random() * totalWeight;
	for (const drop of eligible) {
		roll -= drop.weight;
		if (roll <= 0) return drop.itemId === 'nothing' ? null : drop.itemId;
	}
	return null;
}

// ── NPC Connections ─────────────────────────────────────────
// NPCs know about each other. The Director uses this to make
// conversations feel like a living community, not isolated quest dispensers.
export const NPC_CONNECTIONS: Record<string, Array<{ npcId: string; relationship: string }>> = {
	mac_the_bartender: [
		{ npcId: 'jenny_wu', relationship: 'ally — lets her use the back room for her investigation board' },
		{ npcId: 'iron_mike', relationship: 'old friend — two doors down at Mickey\'s, sends people to train with him' },
		{ npcId: 'dee_fontaine', relationship: 'regular — she performs at the Majestic, drinks at the Rigby after shows' },
		{ npcId: 'bartender_sal', relationship: 'rival bar owner on King Street — respects him but they argue about whiskey' },
		{ npcId: 'sage_okonkwo', relationship: 'supplier — she brings herbs for his cocktails, he trusts her judgment' },
		{ npcId: 'officer_chen', relationship: 'informant — she comes in off-duty, they share intel quietly' },
	],
	jenny_wu: [
		{ npcId: 'mac_the_bartender', relationship: 'host — he gave her the back room for free, no questions' },
		{ npcId: 'officer_chen', relationship: 'source — Chen leaks missing persons data to her off the record' },
		{ npcId: 'professor_vasquez', relationship: 'contact — Vasquez provides scientific backing for her theories' },
		{ npcId: 'spotter_ray', relationship: 'intel partner — Ray feeds her patrol data, she connects the dots' },
	],
	officer_chen: [
		{ npcId: 'jenny_wu', relationship: 'off-record source — feeds her case info the department won\'t pursue' },
		{ npcId: 'mac_the_bartender', relationship: 'trusted civilian — drinks at the Rigby, knows Mac is solid' },
		{ npcId: 'hot_dog_vendor', relationship: 'eyes on the Square — Frank sees everything, she checks in daily' },
	],
	hot_dog_vendor: [
		{ npcId: 'officer_chen', relationship: 'regular customer — she buys a dog every shift, they talk' },
		{ npcId: 'barista_maya', relationship: 'neighbor vendor — something\'s off about her lately' },
	],
	barista_maya: [
		{ npcId: 'hot_dog_vendor', relationship: 'nearby vendor — Frank watches her too closely' },
		{ npcId: 'student_alex', relationship: 'regular customer — Alex orders the same thing every day' },
	],
	professor_vasquez: [
		{ npcId: 'jenny_wu', relationship: 'collaborator — Jenny publishes what Elena can\'t say officially' },
		{ npcId: 'student_alex', relationship: 'former student — Alex took her quantum physics seminar' },
		{ npcId: 'professor_chen_ghost', relationship: 'colleague — Wei Chen was her research partner before he vanished' },
	],
	student_alex: [
		{ npcId: 'professor_vasquez', relationship: 'former professor — they trust her theories about the signal' },
		{ npcId: 'barista_maya', relationship: 'gets coffee from her daily — hasn\'t noticed she\'s off yet' },
	],
	bartender_sal: [
		{ npcId: 'mac_the_bartender', relationship: 'rival — Mac\'s dive vs Sal\'s cocktail bar, grudging respect' },
		{ npcId: 'dee_fontaine', relationship: 'neighbor — the Majestic is right there, Dee used to drink at his place' },
		{ npcId: 'iron_mike', relationship: 'drinking buddy — Mike\'s a regular after closing time' },
	],
	dee_fontaine: [
		{ npcId: 'mac_the_bartender', relationship: 'drinking buddy — always ends up at the Rigby after a show' },
		{ npcId: 'bartender_sal', relationship: 'neighbor — Sal\'s bar is walking distance from the Majestic' },
		{ npcId: 'iron_mike', relationship: 'sparring partner — verbal, not physical. They trade insults like love letters' },
	],
	iron_mike: [
		{ npcId: 'mac_the_bartender', relationship: 'old friend — two bars, same block, same fight' },
		{ npcId: 'dee_fontaine', relationship: 'verbal sparring partner — she\'s the only person who out-insults him' },
		{ npcId: 'spotter_ray', relationship: 'respects the military background — Ray helped plan the training schedule' },
		{ npcId: 'bartender_sal', relationship: 'late-night regular at Sal\'s after Mickey\'s closes' },
	],
	sage_okonkwo: [
		{ npcId: 'mac_the_bartender', relationship: 'herb supplier for his cocktails — they trade favors' },
		{ npcId: 'professor_vasquez', relationship: 'science allies — Sage does chemistry, Elena does physics, they compare notes on NutriSynth' },
	],
	spotter_ray: [
		{ npcId: 'jenny_wu', relationship: 'intel partner — she processes his raw surveillance into patterns' },
		{ npcId: 'iron_mike', relationship: 'tactical advisor — helps plan the resistance training ops' },
		{ npcId: 'officer_chen', relationship: 'mutual respect — both ex-military mentality, different branches' },
	],
};

export { ITEMS, ENCOUNTER_TABLES, LOOT_TABLES };
