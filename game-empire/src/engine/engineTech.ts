// The engine's tech tree. Each of the six modules has features you research
// one by one; which ones you pick shapes what your engine is good at. A
// rendering pipeline built for pixel art helps different games than one
// built for photoreal path tracing. A module's level is 1 + the features
// researched in it (up to 5); levels still gate major versions.
import type { ArtStyleId, EngineModuleId, GenreId, MultiplayerId, PlatformId } from './types';

export interface FeatureEffect {
  /** Raises the quality ceiling of every game on the engine. */
  cap?: number;
  /** Flat quality for every game on the engine. */
  quality?: number;
  /** Extra quality for games that match any of these. */
  genres?: GenreId[];
  art?: ArtStyleId[];
  mp?: MultiplayerId[];
  platforms?: PlatformId[];
  match?: number;
  /** Share less development work. */
  work?: number;
  /** Share fewer bugs. */
  bugs?: number;
  /** Server cost discount for your online games. */
  server?: number;
  /** Port work discount. */
  port?: number;
  /** Patch and update work discount for your live games. */
  patch?: number;
  /** Lower churn for matching online games. */
  churn?: number;
  /** Rival studios are more likely to license the engine. */
  adoption?: number;
  /** Buzz when it ships. */
  hype?: number;
}

export interface EngineFeature {
  id: string;
  module: EngineModuleId;
  tier: 1 | 2 | 3 | 4;
  name: string;
  blurb: string;
  requires?: string[];
  fx: FeatureEffect;
}

const COMPETITIVE: GenreId[] = ['fps', 'battleRoyale', 'sports', 'racing', 'strategy'];
const REAL: ArtStyleId[] = ['realistic', 'photoreal'];

export const ENGINE_FEATURES: EngineFeature[] = [
  // rendering
  { id: 'deferred', module: 'rendering', tier: 1, name: 'Deferred lighting', blurb: 'Hundreds of lights per scene.', fx: { cap: 2, art: REAL, match: 1 } },
  { id: 'toonShader', module: 'rendering', tier: 1, name: 'Stylized shading', blurb: 'Cel shading, outlines and painterly looks.', fx: { art: ['stylized', 'anime', 'handDrawn'], match: 2.5 } },
  { id: 'pbr', module: 'rendering', tier: 2, name: 'Physically based materials', blurb: 'Metal looks like metal, skin like skin.', fx: { cap: 3, art: REAL, match: 2 } },
  { id: 'spritePipeline', module: 'rendering', tier: 2, name: '2D sprite pipeline', blurb: 'Pixel-perfect sprites, tilemaps and 2D lighting.', fx: { art: ['pixel', 'handDrawn', 'lowPoly'], match: 3, work: 0.03 } },
  { id: 'globalIllum', module: 'rendering', tier: 3, name: 'Real-time global illumination', blurb: 'Light bounces around the world, no baking.', fx: { cap: 4, art: REAL, match: 2.5, adoption: 0.02 } },
  { id: 'upscaling', module: 'rendering', tier: 3, name: 'Neural upscaling', blurb: 'Sharp images on weak hardware.', fx: { cap: 2, platforms: ['handheld', 'mobile', 'cloud'], match: 2.5 } },
  { id: 'pathTracing', module: 'rendering', tier: 4, name: 'Path tracing', blurb: 'Film-quality light in real time.', requires: ['globalIllum'], fx: { cap: 5, art: REAL, match: 3, hype: 10, adoption: 0.03 } },
  { id: 'virtualGeo', module: 'rendering', tier: 4, name: 'Virtualized geometry', blurb: 'Film-quality assets straight into the game. No LODs.', fx: { cap: 3, work: 0.05, genres: ['openWorld', 'sandbox'], match: 2, hype: 6 } },
  // physics & animation
  { id: 'ragdoll', module: 'physics', tier: 1, name: 'Ragdolls & hit reactions', blurb: 'Bodies that fall the way they should.', fx: { genres: ['fps', 'battleRoyale', 'horror', 'sports'], match: 2 } },
  { id: 'vehicles', module: 'physics', tier: 1, name: 'Vehicle physics', blurb: 'Suspension, tires and drifting.', fx: { genres: ['racing', 'openWorld', 'sandbox'], match: 3 } },
  { id: 'destruction', module: 'physics', tier: 2, name: 'Destructible environments', blurb: 'Blow a hole in any wall.', fx: { genres: ['fps', 'battleRoyale', 'sandbox', 'survival'], match: 3, hype: 5 } },
  { id: 'cloth', module: 'physics', tier: 2, name: 'Cloth & hair simulation', blurb: 'Capes that flow, hair that moves.', fx: { cap: 2, genres: ['rpg', 'mmorpg', 'horror'], match: 1.5 } },
  { id: 'motionMatching', module: 'physics', tier: 3, name: 'Motion-matched animation', blurb: 'Characters move like people, not puppets.', fx: { cap: 3, quality: 1 } },
  { id: 'fluids', module: 'physics', tier: 3, name: 'Fluid & weather simulation', blurb: 'Rivers, storms and mud.', fx: { genres: ['survival', 'openWorld', 'simulation'], match: 3 } },
  { id: 'deterministic', module: 'physics', tier: 4, name: 'Deterministic physics', blurb: 'Every client sees the exact same physics. Perfect for multiplayer.', requires: ['rollback'], fx: { mp: ['online', 'massive'], match: 2, churn: 0.03 } },
  // tools
  { id: 'visualScript', module: 'tools', tier: 1, name: 'Visual scripting', blurb: 'Designers build gameplay without code.', fx: { work: 0.04, adoption: 0.02 } },
  { id: 'hotReload', module: 'tools', tier: 1, name: 'Live hot reload', blurb: 'Change code while the game runs.', fx: { work: 0.02, patch: 0.15 } },
  { id: 'procgen', module: 'tools', tier: 2, name: 'Procedural generation', blurb: 'Worlds, dungeons and loot from rules.', fx: { genres: ['survival', 'sandbox', 'openWorld', 'indie'], match: 2, work: 0.04 } },
  { id: 'worldStream', module: 'tools', tier: 2, name: 'Open-world streaming', blurb: 'Seamless worlds with no loading screens.', fx: { genres: ['openWorld', 'mmorpg', 'sandbox', 'rpg'], match: 3 } },
  { id: 'marketplace', module: 'tools', tier: 3, name: 'Asset marketplace', blurb: 'A store of ready-made assets. Licensees pay to use it.', requires: ['visualScript'], fx: { work: 0.05, adoption: 0.05 } },
  { id: 'aiAssist', module: 'tools', tier: 3, name: 'AI-assisted tooling', blurb: 'Generated textures, code and dialogue drafts.', fx: { work: 0.06 } },
  { id: 'cloudBuild', module: 'tools', tier: 4, name: 'Cloud build farm', blurb: 'Every build tested on every platform overnight.', fx: { work: 0.04, patch: 0.15, bugs: 0.05 } },
  // networking
  { id: 'dedicated', module: 'networking', tier: 1, name: 'Dedicated server framework', blurb: 'Authoritative servers out of the box.', fx: { mp: ['online', 'massive'], match: 1.5, server: 0.03 } },
  { id: 'relay', module: 'networking', tier: 1, name: 'Peer-to-peer relay', blurb: 'Cheap co-op without big server bills.', fx: { mp: ['localCoop', 'online'], match: 1.5, server: 0.02 } },
  { id: 'rollback', module: 'networking', tier: 2, name: 'Rollback netcode', blurb: 'No input lag, even across oceans.', fx: { genres: COMPETITIVE, match: 3, churn: 0.04 } },
  { id: 'crossplay', module: 'networking', tier: 2, name: 'Cross-play services', blurb: 'Accounts, friends and lobbies across every platform.', fx: { port: 0.1, mp: ['online', 'massive'], churn: 0.02 } },
  { id: 'matchmaking', module: 'networking', tier: 3, name: 'Skill-based matchmaking', blurb: 'Fair matches keep players coming back.', fx: { genres: COMPETITIVE, match: 1, churn: 0.04 } },
  { id: 'shards', module: 'networking', tier: 3, name: 'Massive shard tech', blurb: 'Tens of thousands of players in one world.', requires: ['dedicated'], fx: { mp: ['massive'], genres: ['mmorpg'], match: 4, server: 0.05 } },
  { id: 'edgeSync', module: 'networking', tier: 4, name: 'Edge synchronization', blurb: 'Game state replicated at the network edge.', fx: { server: 0.08, mp: ['online', 'massive'], match: 2 } },
  // platforms
  { id: 'consoleSdk', module: 'platforms', tier: 1, name: 'Console SDKs', blurb: 'Certified builds for every console.', fx: { platforms: ['console', 'handheld'], match: 1.5, port: 0.08 } },
  { id: 'mobileRenderer', module: 'platforms', tier: 1, name: 'Mobile renderer', blurb: 'Runs on a five-year-old phone.', fx: { platforms: ['mobile'], match: 2.5, port: 0.06 } },
  { id: 'webExport', module: 'platforms', tier: 2, name: 'Web & cloud export', blurb: 'Play in a browser tab or a stream.', fx: { platforms: ['cloud'], match: 2.5, port: 0.06 } },
  { id: 'vrRuntime', module: 'platforms', tier: 2, name: 'VR runtime', blurb: 'Hands, head tracking and comfort settings.', fx: { platforms: ['vr'], match: 4 } },
  { id: 'oneBuild', module: 'platforms', tier: 3, name: 'Build once, ship everywhere', blurb: 'One project, every platform.', fx: { port: 0.15, adoption: 0.03 } },
  { id: 'autoScale', module: 'platforms', tier: 4, name: 'Automatic hardware scaling', blurb: 'The engine tunes itself to any device.', fx: { cap: 2, platforms: ['handheld', 'mobile', 'vr'], match: 2 } },
  // AI & scripting
  { id: 'behaviorTrees', module: 'scripting', tier: 1, name: 'Behavior trees', blurb: 'Readable, debuggable enemy brains.', fx: { quality: 1, bugs: 0.03 } },
  { id: 'navmesh', module: 'scripting', tier: 1, name: 'Navigation meshes', blurb: 'Characters find their way anywhere.', fx: { genres: ['rpg', 'strategy', 'survival', 'horror'], match: 2 } },
  { id: 'dialogue', module: 'scripting', tier: 2, name: 'Dialogue & quest system', blurb: 'Branching stories without spaghetti.', fx: { genres: ['rpg', 'mmorpg', 'openWorld'], match: 2.5, work: 0.02 } },
  { id: 'testBots', module: 'scripting', tier: 2, name: 'Automated test bots', blurb: 'Bots play every build and file the bugs.', fx: { bugs: 0.08, patch: 0.1 } },
  { id: 'learningNpcs', module: 'scripting', tier: 3, name: 'Learning NPCs', blurb: 'Enemies that adapt to how you play.', requires: ['behaviorTrees'], fx: { cap: 2, genres: ['strategy', 'horror', 'rpg', 'survival'], match: 2.5 } },
  { id: 'director', module: 'scripting', tier: 4, name: 'AI director', blurb: 'Pacing that reads the player and adapts every session.', fx: { quality: 2, churn: 0.02 } },
];

export const FEATURE_BY_ID: Record<string, EngineFeature> = Object.fromEntries(ENGINE_FEATURES.map((f) => [f.id, f]));

/** What each research tier costs (money and base days of work). */
export const TIER_COST = [0, 150000, 1000000, 6000000, 30000000];
export const TIER_DAYS = [0, 60, 90, 120, 160];

export function featureCost(f: EngineFeature): number {
  return TIER_COST[f.tier];
}

export function featureWork(f: EngineFeature): number {
  return TIER_DAYS[f.tier];
}

/** Default picks when converting an old level-based engine: one feature per tier, in order. */
export function defaultFeaturesFor(module: EngineModuleId, count: number): string[] {
  const pool = ENGINE_FEATURES.filter((f) => f.module === module);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const f = pool.find((x) => x.tier === Math.min(4, i + 1) && !out.includes(x.id)) ?? pool.find((x) => !out.includes(x.id));
    if (f) out.push(f.id);
  }
  return out;
}
