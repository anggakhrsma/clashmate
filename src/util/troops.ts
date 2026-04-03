import { RawData } from 'clashofclans.js';
import { ALL_TROOPS, SUPER_TROOPS } from './emojis.js';

const COMMON_UPGRADE = RawData.RawUnits.find((u: any) => u.name === 'Barbarian Puppet')?.upgrade ?? {
  cost: [],
  time: [],
  resource: 'Shiny Ore',
  resources: []
};

const LOCAL_UNITS = [
  {
    name: 'Fire Heart',
    village: 'home',
    category: 'equipment',
    subCategory: 'equipment',
    unlock: { hall: 15, cost: 0, time: 0, resource: 'Elixir', building: 'Blacksmith', buildingLevel: 1 },
    upgrade: COMMON_UPGRADE,
    allowedCharacters: ['Dragon Duke'],
    minLevel: 1,
    seasonal: false,
    levels: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12, 15, 18, 18]
  },
  {
    name: 'Flame Blower',
    village: 'home',
    category: 'equipment',
    subCategory: 'equipment',
    unlock: { hall: 15, cost: 0, time: 0, resource: 'Elixir', building: 'Blacksmith', buildingLevel: 1 },
    upgrade: COMMON_UPGRADE,
    allowedCharacters: ['Dragon Duke'],
    minLevel: 1,
    seasonal: false,
    levels: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12, 15, 18, 18]
  },
  {
    name: 'Stun Blaster',
    village: 'home',
    category: 'equipment',
    subCategory: 'equipment',
    unlock: { hall: 15, cost: 0, time: 0, resource: 'Elixir', building: 'Blacksmith', buildingLevel: 1 },
    upgrade: COMMON_UPGRADE,
    allowedCharacters: ['Dragon Duke'],
    minLevel: 1,
    seasonal: false,
    levels: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12, 15, 18, 18]
  }
];

// Only add LOCAL_UNITS if they are NOT already present in RawData.RawUnits
// This allows for a safe library upgrade in the future.
const FILTERED_LOCAL_UNITS = LOCAL_UNITS.filter(
  (local) => !RawData.RawUnits.some((raw: any) => raw.name === local.name)
);

export const RAW_TROOPS = [...RawData.RawUnits, ...FILTERED_LOCAL_UNITS].map((u) =>
  u.name === 'Dragon Duke' ? { ...u, seasonal: false } : u
);

export const RAW_SUPER_TROOPS = RawData.RawSuperUnits;

// For calculating rushed and remaining upgrades
export const RAW_TROOPS_FILTERED = RAW_TROOPS.filter((unit: any) => !unit.seasonal)
  .filter((u: any) => u.category !== 'equipment')
  .filter((unit: any) => !(unit.name in SUPER_TROOPS) && unit.name in ALL_TROOPS);

export const RAW_TROOPS_WITH_ICONS = RAW_TROOPS.filter((unit: any) => !unit.seasonal)
  // .filter((u: any) => u.category !== 'equipment')
  .filter((unit: any) => !(unit.name in SUPER_TROOPS) && unit.name in ALL_TROOPS);

export const ARMY_CAPACITY = [
  { hall: 1, troops: 20, spells: 0 },
  { hall: 2, troops: 30, spells: 0 },
  { hall: 3, troops: 70, spells: 0 },
  { hall: 4, troops: 80, spells: 0 },
  { hall: 5, troops: 135, spells: 2 },
  { hall: 6, troops: 150, spells: 4 },
  { hall: 7, troops: 200, spells: 6 },
  { hall: 8, troops: 200, spells: 7 },
  { hall: 9, troops: 220, spells: 9 },
  { hall: 10, troops: 240, spells: 11 },
  { hall: 11, troops: 260, spells: 11 },
  { hall: 12, troops: 280, spells: 11 },
  { hall: 13, troops: 300, spells: 11 },
  { hall: 14, troops: 300, spells: 11 },
  { hall: 15, troops: 320, spells: 11 },
  { hall: 16, troops: 320, spells: 11 },
  { hall: 17, troops: 320, spells: 11 },
  { hall: 18, troops: 320, spells: 11 }
];

export interface TroopJSON {
  [key: string]: {
    id: number;
    name: string;
    village: string;
    category: string;
    subCategory: string;
    unlock: {
      hall: number;
      cost: number;
      time: number;
      resource: string;
      building: string;
      buildingLevel: number;
    };
    upgrade: {
      cost: number[];
      time: number[];
      resource: string;
      resources: { resource: string; cost: number }[][];
    };
    allowedCharacters: string[];
    minLevel?: number | null;
    seasonal: boolean;
    levels: number[];
  }[];
}
