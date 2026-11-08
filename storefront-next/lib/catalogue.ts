export type GameField = { key: string; label: string; type: 'text' | 'select'; required: boolean; options?: string[] };
export type GameCategory = {
  id: string; game: string; name: string; region: string; restriction: string; fields: GameField[];
};

export const launchCategories: GameCategory[] = [
  { id: 'blood_strike', game: 'Blood Strike', name: 'Blood Strike Global', region: 'GLOBAL', restriction: 'GLOBAL VERSION', fields: [{ key: 'player_id', label: 'Player ID', type: 'text', required: true }] },
  { id: 'genshin_impact_global', game: 'Genshin Impact', name: 'Genshin Impact Global', region: 'GLOBAL', restriction: 'CHOOSE YOUR GAME SERVER', fields: [{ key: 'player_id', label: 'UID', type: 'text', required: true }, { key: 'server', label: 'Server', type: 'select', required: true, options: ['America', 'Asia', 'Europe', 'TW HK MO'] }] },
  { id: 'honkai_star_rail_global', game: 'Honkai: Star Rail', name: 'Honkai: Star Rail Global', region: 'GLOBAL', restriction: 'CHOOSE YOUR GAME SERVER', fields: [{ key: 'player_id', label: 'UID', type: 'text', required: true }, { key: 'server', label: 'Server', type: 'select', required: true, options: ['Asia', 'America', 'Europe', 'TW HK MO'] }] },
  { id: 'marvel_rivals', game: 'Marvel Rivals', name: 'Marvel Rivals', region: 'GLOBAL', restriction: 'CHECK ACCOUNT COMPATIBILITY', fields: [{ key: 'player_id', label: 'Player ID', type: 'text', required: true }] },
  { id: 'mobile_legends_global', game: 'Mobile Legends', name: 'Mobile Legends Global', region: 'GLOBAL', restriction: 'GLOBAL ONLY · NOT ID / BR', fields: [{ key: 'player_id', label: 'Player ID', type: 'text', required: true }, { key: 'server_id', label: 'Zone / Server ID', type: 'text', required: true }] },
  { id: 'mobile_legends_philippines', game: 'Mobile Legends', name: 'Mobile Legends Philippines', region: 'PH', restriction: 'PHILIPPINES ACCOUNTS ONLY', fields: [{ key: 'player_id', label: 'Player ID', type: 'text', required: true }, { key: 'server_id', label: 'Zone / Server ID', type: 'text', required: true }] },
  { id: 'mobile_legends_indonesia', game: 'Mobile Legends', name: 'Mobile Legends Indonesia', region: 'ID', restriction: 'INDONESIA ACCOUNTS ONLY', fields: [{ key: 'player_id', label: 'Player ID', type: 'text', required: true }, { key: 'server_id', label: 'Zone / Server ID', type: 'text', required: true }] },
  { id: 'mobile_legends_malaysia', game: 'Mobile Legends', name: 'Mobile Legends Malaysia', region: 'MY', restriction: 'MALAYSIA ACCOUNTS ONLY', fields: [{ key: 'player_id', label: 'Player ID', type: 'text', required: true }, { key: 'server_id', label: 'Zone / Server ID', type: 'text', required: true }] },
  { id: 'lords_mobile', game: 'Lords Mobile', name: 'Lords Mobile', region: 'GLOBAL', restriction: 'CHECK YOUR ACCOUNT DETAILS', fields: [{ key: 'player_id', label: 'Player ID', type: 'text', required: true }] },
  { id: 'codm_activision_in', game: 'Call of Duty: Mobile', name: 'CODM Activision India', region: 'IN', restriction: 'INDIA ONLY · ACTIVISION, NOT GARENA', fields: [{ key: 'user_id', label: 'User ID', type: 'text', required: true }] },
];
