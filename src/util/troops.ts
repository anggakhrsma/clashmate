import { RawData } from 'clashofclans.js';
import { ALL_TROOPS, SUPER_TROOPS } from './emojis.js';

const COMMON_UPGRADE_COST = [
  120, 240, 400, 600, 840, 1120, 1440, 1800, 1900, 2000, 2100, 2200, 2300, 2400, 2500, 2600, 2700
];
const COMMON_UPGRADE_RESOURCES = [
  [{ resource: 'Shiny Ore', cost: 120 }],
  [{ resource: 'Shiny Ore', cost: 240 }, { resource: 'Glowy Ore', cost: 20 }],
  [{ resource: 'Shiny Ore', cost: 400 }],
  [{ resource: 'Shiny Ore', cost: 600 }],
  [{ resource: 'Shiny Ore', cost: 840 }, { resource: 'Glowy Ore', cost: 100 }],
  [{ resource: 'Shiny Ore', cost: 1120 }],
  [{ resource: 'Shiny Ore', cost: 1440 }],
  [{ resource: 'Shiny Ore', cost: 1800 }, { resource: 'Glowy Ore', cost: 200 }],
  [{ resource: 'Shiny Ore', cost: 1900 }],
  [{ resource: 'Shiny Ore', cost: 2000 }],
  [{ resource: 'Shiny Ore', cost: 2100 }, { resource: 'Glowy Ore', cost: 400 }],
  [{ resource: 'Shiny Ore', cost: 2200 }],
  [{ resource: 'Shiny Ore', cost: 2300 }],
  [{ resource: 'Shiny Ore', cost: 2400 }, { resource: 'Glowy Ore', cost: 600 }],
  [{ resource: 'Shiny Ore', cost: 2500 }],
  [{ resource: 'Shiny Ore', cost: 2600 }],
  [{ resource: 'Shiny Ore', cost: 2700 }, { resource: 'Glowy Ore', cost: 600 }]
];

const LOCAL_UNITS = [
  {
    name: 'Fire Heart',
    village: 'home',
    category: 'equipment',
    subCategory: 'equipment',
    unlock: { hall: 15, cost: 0, time: 0, resource: 'Elixir', building: 'Blacksmith', buildingLevel: 1 },
    upgrade: { cost: COMMON_UPGRADE_COST, time: [], resource: 'Shiny Ore', resources: COMMON_UPGRADE_RESOURCES },
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
    upgrade: { cost: COMMON_UPGRADE_COST, time: [], resource: 'Shiny Ore', resources: COMMON_UPGRADE_RESOURCES },
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
    upgrade: { cost: COMMON_UPGRADE_COST, time: [], resource: 'Shiny Ore', resources: COMMON_UPGRADE_RESOURCES },
    allowedCharacters: ['Dragon Duke'],
    minLevel: 1,
    seasonal: false,
    levels: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12, 15, 18, 18]
  }
];

export const RAW_TROOPS = [...RawData.RawUnits, ...LOCAL_UNITS].map((u) =>
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
