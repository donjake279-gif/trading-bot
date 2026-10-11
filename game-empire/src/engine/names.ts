// Procedural names for studios, people and games.
import type { GenreId } from './types';
import { type RngHost, chance, pick, randInt } from './rng';

const STUDIO_A = [
  'Iron', 'Crimson', 'Nova', 'Pixel', 'Quantum', 'Silver', 'Obsidian', 'Lunar', 'Solar', 'Neon', 'Cobalt', 'Arcane',
  'Wild', 'Hollow', 'Golden', 'Shadow', 'Frost', 'Ember', 'Vortex', 'Titanium', 'Velvet', 'Rogue', 'Paper', 'Clockwork',
  'Atomic', 'Stellar', 'Northern', 'Red', 'Blue', 'Black', 'White', 'Thunder', 'Mammoth', 'Kraken', 'Phoenix', 'Raven',
  'Bright', 'Hidden', 'Deep', 'Electric', 'Cosmic', 'Owl', 'Fox', 'Wolf', 'Bear', 'Stone', 'Glass', 'Cinder', 'Moss',
  'Saffron', 'Zenith', 'Apex', 'Prism', 'Echo', 'Nimbus', 'Harbor', 'Summit', 'Copper', 'Jade', 'Onyx', 'Lumen',
];
const STUDIO_B = [
  'Forge', 'Studios', 'Interactive', 'Games', 'Entertainment', 'Works', 'Labs', 'Softworks', 'Digital', 'Pictures',
  'Collective', 'Gameworks', 'Arts', 'Media', 'Systems', 'Foundry', 'House', 'Bytes', 'Play', 'Mill', 'Garage',
];
const STUDIO_SINGLE = [
  'Hexabyte', 'Lumora', 'Strato', 'Kinetic', 'Ubiquity', 'Novacore', 'Brightloop', 'Vantage', 'Questa', 'Gamesmith',
  'Polygone', 'Starbound', 'Nexon Peak', 'Arcadia', 'Bitwise', 'Tidal', 'Monolith Peak', 'Lucent', 'Aether', 'Mirage',
];

const FIRST = [
  'Alex', 'Sam', 'Jordan', 'Taylor', 'Morgan', 'Riley', 'Casey', 'Jamie', 'Avery', 'Quinn', 'Hana', 'Kenji', 'Yuki',
  'Mei', 'Wei', 'Arjun', 'Priya', 'Ravi', 'Aisha', 'Omar', 'Fatima', 'Lucas', 'Sofia', 'Mateo', 'Valentina', 'Liam',
  'Emma', 'Noah', 'Olivia', 'Elena', 'Ivan', 'Nadia', 'Kwame', 'Amara', 'Tunde', 'Zara', 'Lars', 'Freya', 'Mikko',
  'Aino', 'Pierre', 'Camille', 'Hugo', 'Ines', 'Marco', 'Giulia', 'Diego', 'Camila', 'Sven', 'Ingrid', 'Min-jun',
  'Seo-yeon', 'Dmitri', 'Anya', 'Kofi', 'Leila', 'Tomas', 'Maya', 'Rafael', 'Chloe', 'Felix', 'Nora', 'Theo', 'Iris',
];
const LAST = [
  'Chen', 'Kim', 'Park', 'Tanaka', 'Sato', 'Nguyen', 'Patel', 'Singh', 'Khan', 'Garcia', 'Rodriguez', 'Silva',
  'Santos', 'Rossi', 'Bianchi', 'Muller', 'Schmidt', 'Novak', 'Kowalski', 'Ivanova', 'Petrov', 'Johansson', 'Larsen',
  'Virtanen', 'Dubois', 'Martin', 'Bernard', 'Smith', 'Jones', 'Brown', 'Williams', 'Okafor', 'Mensah', 'Adeyemi',
  'Haddad', 'Mansour', 'Cohen', 'Levi', 'Murphy', 'Kelly', 'Walsh', 'Hughes', 'Lopez', 'Herrera', 'Morales', 'Costa',
  'Fischer', 'Weber', 'Yamamoto', 'Ito', 'Wong', 'Lee', 'Ali', 'Hassan', 'Andersen', 'Nakamura', 'Moreau', 'Reyes',
];

const CITIES = [
  'Seattle', 'San Francisco', 'Los Angeles', 'Austin', 'Montreal', 'Vancouver', 'Toronto', 'London', 'Paris', 'Berlin',
  'Stockholm', 'Helsinki', 'Warsaw', 'Kyiv', 'Tokyo', 'Osaka', 'Seoul', 'Shanghai', 'Shenzhen', 'Singapore', 'Sydney',
  'Melbourne', 'Sao Paulo', 'Mexico City', 'Lyon', 'Copenhagen', 'Amsterdam', 'Dublin', 'Edinburgh', 'Prague',
  'Bangalore', 'Dubai', 'Lagos', 'Cape Town', 'Raleigh', 'Boston', 'Chicago', 'Madrid', 'Barcelona', 'Milan',
];

const ADJ = [
  'Eternal', 'Fallen', 'Hollow', 'Crimson', 'Silent', 'Broken', 'Last', 'Infinite', 'Savage', 'Burning', 'Frozen',
  'Lost', 'Iron', 'Shattered', 'Forgotten', 'Wild', 'Neon', 'Dark', 'Golden', 'Rogue', 'Twisted', 'Final', 'Hidden',
  'Sacred', 'Cursed', 'Distant', 'Electric', 'Primal', 'Steel', 'Velvet', 'Midnight', 'Starlit', 'Feral', 'Sunken',
];
const NOUN = [
  'Horizon', 'Frontier', 'Legacy', 'Empire', 'Dominion', 'Echoes', 'Kingdom', 'Abyss', 'Odyssey', 'Requiem',
  'Vanguard', 'Protocol', 'Uprising', 'Crown', 'Tides', 'Shards', 'Realms', 'Skies', 'Ashes', 'Signal', 'Harvest',
  'Wasteland', 'Citadel', 'Paradox', 'Covenant', 'Outpost', 'Saga', 'Exodus', 'Bloodline', 'Spire', 'Hollows',
];

const GENRE_WORDS: Record<GenreId, string[]> = {
  fps: ['Strike', 'Warzone', 'Recon', 'Ballistic', 'Siege', 'Black Ops', 'Fireteam', 'Spec Ops', 'Killzone', 'Hardline'],
  battleRoyale: ['Drop Zone', 'Last Squad', 'Storm', 'Arena', 'Showdown', 'Circle', 'Royale', 'Clash', 'Island', 'Survivors'],
  survival: ['Outlast', 'Wilds', 'Ark', 'Rust', 'Stranded', 'Thaw', 'Exile', 'Raft', 'Ember', 'Grounded'],
  horror: ['Whispers', 'Dread', 'Asylum', 'Nightfall', 'Hollow House', 'Static', 'Lullaby', 'Visage', 'Pale', 'Below'],
  rpg: ['Chronicles', 'Legends', 'Quest', 'Sagas', 'Ballad', 'Oath', 'Tales', 'Heroes', 'Grimoire', 'Ascension'],
  mmorpg: ['Online', 'Worlds', 'Realm', 'Eternity', 'Guilds', 'Azeroth', 'Continents', 'Universe', 'Ages', 'Kingdoms'],
  sandbox: ['Craft', 'Blocks', 'Builder', 'Terra', 'Worlds', 'Garden', 'Colony', 'Workshop', 'Lands', 'Town'],
  racing: ['Velocity', 'Drift', 'Turbo', 'Grand Prix', 'Nitro', 'Rally', 'Apex', 'Overdrive', 'Circuit', 'Redline'],
  strategy: ['Conquest', 'Tactics', 'Command', 'Dynasty', 'Warlords', 'Empires', 'Total War', 'Supremacy', 'Crusade', 'Hegemony'],
  simulation: ['Tycoon', 'Simulator', 'City', 'Farm', 'Life', 'Manager', 'Planet', 'Park', 'Hospital', 'Airport'],
  sports: ['Football', 'Hoops', 'Golf Tour', 'Tennis Pro', 'Hockey', 'Soccer Stars', 'Pro League', 'Cricket', 'Baseball', 'Skate'],
  indie: ['Little', 'Lantern', 'Paper', 'Moth', 'Fern', 'Tiny', 'Kite', 'Hollow Knight', 'Bloom', 'Wander'],
  openWorld: ['Odyssey', 'Unbound', 'Wanderer', 'Horizon', 'Atlas', 'Expanse', 'Frontier', 'Nomad', 'Outlands', 'Badlands'],
};

const SUBTITLES = [
  'Reborn', 'Origins', 'Awakening', 'Resurgence', 'Legacy', 'Requiem', 'Ascension', 'Revelations', 'Eclipse',
  'Dawn', 'Ragnarok', 'Genesis', 'Undying', 'Reckoning', 'Retribution', 'Homecoming', 'Endgame', 'Rebellion',
];

const ROMAN = ['', '', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export function personName(r: RngHost): string {
  return `${pick(r, FIRST)} ${pick(r, LAST)}`;
}

export function cityName(r: RngHost): string {
  return pick(r, CITIES);
}

export function studioName(r: RngHost, taken: Set<string>): string {
  for (let i = 0; i < 40; i++) {
    const name = chance(r, 0.22) ? pick(r, STUDIO_SINGLE) : `${pick(r, STUDIO_A)} ${pick(r, STUDIO_B)}`;
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
  const fallback = `${pick(r, STUDIO_A)} ${pick(r, STUDIO_B)} ${randInt(r, 2, 99)}`;
  taken.add(fallback);
  return fallback;
}

export function gameTitle(r: RngHost, genre: GenreId): string {
  const words = GENRE_WORDS[genre];
  const roll = randInt(r, 0, 5);
  switch (roll) {
    case 0:
      return `${pick(r, ADJ)} ${pick(r, NOUN)}`;
    case 1:
      return `${pick(r, NOUN)} of ${pick(r, NOUN)}`;
    case 2:
      return `${pick(r, words)}: ${pick(r, ADJ)} ${pick(r, NOUN)}`;
    case 3:
      return `${pick(r, ADJ)} ${pick(r, words)}`;
    case 4:
      return `${pick(r, NOUN)} ${pick(r, words)}`;
    default:
      return `${pick(r, words)} ${pick(r, NOUN)}`;
  }
}

export function sequelTitle(r: RngHost, ipName: string, sequelNo: number): string {
  const n = ROMAN[sequelNo] ?? String(sequelNo);
  if (chance(r, 0.4)) return `${ipName} ${n}: ${pick(r, SUBTITLES)}`;
  if (chance(r, 0.5)) return `${ipName} ${sequelNo}`;
  return `${ipName} ${n}`;
}

const INVESTORS = [
  'Sequoia Peaks Capital', 'Andromeda Ventures', 'Blue Harbor Partners', 'Lightspeed Arcade Fund', 'Tencent-ish Holdings',
  'Northstar Growth', 'Kepler Ventures', 'Gamechanger Capital', 'Polaris Equity', 'Index Arcade', 'Redpoint Pixel Fund',
  'Atlas Strategic', 'Summit Crossover Fund', 'Meridian Capital', 'Foundry Seed Partners',
];

export function investorName(r: RngHost): string {
  return pick(r, INVESTORS);
}

const BANKS = ['First Pixel Bank', 'Continental Trust', 'Harbor Credit Union', 'Ironclad Lending', 'Global Commerce Bank'];
export function bankName(r: RngHost): string {
  return pick(r, BANKS);
}

export const STUDIO_COLORS = [
  '#f97316', '#22c55e', '#3b82f6', '#a855f7', '#ef4444', '#eab308', '#14b8a6', '#ec4899', '#6366f1', '#84cc16',
  '#06b6d4', '#f43f5e', '#8b5cf6', '#10b981', '#f59e0b', '#0ea5e9', '#d946ef', '#64748b', '#fb7185', '#4ade80',
];
