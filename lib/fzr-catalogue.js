'use strict';

// Launch catalogue metadata confirmed with the store owner and FZR docs.
// Prices/offers are synced separately; this file only defines category identity,
// customer-facing region guidance and the exact FZR field contract.
const FZR_CATEGORIES = [
  {
    id: 'blood_strike', game: 'Blood Strike', name: 'Blood Strike Global', region: 'GLOBAL',
    restriction: 'Global version', fields: [{ key: 'player_id', label: 'Player ID', type: 'text', required: true }]
  },
  {
    id: 'genshin_impact_global', game: 'Genshin Impact', name: 'Genshin Impact Global', region: 'GLOBAL',
    restriction: 'Choose the server linked to your game account', fields: [
      { key: 'player_id', label: 'UID', type: 'text', required: true },
      { key: 'server', label: 'Server', type: 'select', required: true, options: ['America', 'Asia', 'Europe', 'TW HK MO'] }
    ]
  },
  {
    id: 'honkai_star_rail_global', game: 'Honkai: Star Rail', name: 'Honkai: Star Rail Global', region: 'GLOBAL',
    restriction: 'Choose the server linked to your game account', fields: [
      { key: 'player_id', label: 'UID', type: 'text', required: true },
      { key: 'server', label: 'Server', type: 'select', required: true, options: ['Asia', 'America', 'Europe', 'TW HK MO'] }
    ]
  },
  {
    id: 'marvel_rivals', game: 'Marvel Rivals', name: 'Marvel Rivals', region: 'GLOBAL',
    restriction: 'Check that your account supports this top-up', fields: [{ key: 'player_id', label: 'Player ID', type: 'text', required: true }]
  },
  {
    id: 'mobile_legends_global', game: 'Mobile Legends', name: 'Mobile Legends Global', region: 'GLOBAL',
    restriction: 'GLOBAL ONLY — not available for Indonesia or Brazil. Some packs have additional MY, SG, PH, ID and RU restrictions; check each offer before checkout.',
    fields: [
      { key: 'player_id', label: 'Player ID', type: 'text', required: true },
      { key: 'server_id', label: 'Zone / Server ID', type: 'text', required: true }
    ]
  },
  {
    id: 'mobile_legends_philippines', game: 'Mobile Legends', name: 'Mobile Legends Philippines', region: 'PH',
    restriction: 'PHILIPPINES REGION ONLY', fields: [
      { key: 'player_id', label: 'Player ID', type: 'text', required: true },
      { key: 'server_id', label: 'Zone / Server ID', type: 'text', required: true }
    ]
  },
  {
    id: 'mobile_legends_indonesia', game: 'Mobile Legends', name: 'Mobile Legends Indonesia', region: 'ID',
    restriction: 'INDONESIA REGION ONLY', fields: [
      { key: 'player_id', label: 'Player ID', type: 'text', required: true },
      { key: 'server_id', label: 'Zone / Server ID', type: 'text', required: true }
    ]
  },
  {
    id: 'mobile_legends_malaysia', game: 'Mobile Legends', name: 'Mobile Legends Malaysia', region: 'MY',
    restriction: 'MALAYSIA REGION ONLY', fields: [
      { key: 'player_id', label: 'Player ID', type: 'text', required: true },
      { key: 'server_id', label: 'Zone / Server ID', type: 'text', required: true }
    ]
  },
  {
    id: 'lords_mobile', game: 'Lords Mobile', name: 'Lords Mobile', region: 'GLOBAL',
    restriction: 'Confirm your Lords Mobile account details before payment', fields: [{ key: 'player_id', label: 'Player ID', type: 'text', required: true }]
  },
  {
    id: 'codm_activision_in', game: 'Call of Duty: Mobile', name: 'CODM Activision India', region: 'IN',
    restriction: 'INDIA ONLY — Activision version, not Garena', fields: [{ key: 'user_id', label: 'User ID', type: 'text', required: true }]
  }
];

const CATEGORY_BY_ID = new Map(FZR_CATEGORIES.map(category => [category.id, category]));

function getCategory(categoryId) {
  return CATEGORY_BY_ID.get(String(categoryId || '').trim()) || null;
}

function getOfferRestriction(categoryId, offerId, offerName = '') {
  const category = String(categoryId || '').trim();
  const offer = String(offerId || '').trim();
  const label = `${offer} ${offerName}`.toLowerCase().replace(/\s+/g, '');
  if (category === 'mobile_legends_global') {
    const restrictedPack = ['78+8', '156+16', '234+23', '625+81', '1860+335', '3099+589', '4649+883', '7740+1548']
      .some(denomination => label.includes(denomination));
    if (offer === 'weekly_pass' || label.includes('weeklypass') || restrictedPack) return 'GLOBAL VERSION ONLY — this pack is not available for MY, SG, PH, ID or RU accounts.';
    return 'GLOBAL VERSION ONLY — not available for Indonesia or Brazil accounts.';
  }
  if (category === 'mobile_legends_philippines') return 'PHILIPPINES REGION ONLY.';
  if (category === 'mobile_legends_indonesia') return 'INDONESIA REGION ONLY.';
  if (category === 'mobile_legends_malaysia') return 'MALAYSIA REGION ONLY.';
  if (category === 'codm_activision_in') return 'INDIA ONLY — Activision version, not Garena.';
  if (category === 'blood_strike') return 'GLOBAL VERSION.';
  if (category === 'genshin_impact_global' || category === 'honkai_star_rail_global') return 'Choose the server matching your game account.';
  return '';
}

function normalizePlayerFields(categoryId, suppliedFields, legacy = {}) {
  const category = getCategory(categoryId);
  if (!category) throw new Error('This game region is not enabled in the Hiro launch catalogue.');
  const input = suppliedFields && typeof suppliedFields === 'object' && !Array.isArray(suppliedFields)
    ? suppliedFields : {};
  const values = { ...input };
  if (legacy.playerId && !values.player_id) values.player_id = legacy.playerId;
  if (legacy.serverId && !values.server_id) values.server_id = legacy.serverId;
  const normalized = {};
  for (const field of category.fields) {
    const value = values[field.key];
    const clean = value === undefined || value === null ? '' : String(value).trim();
    if (field.required && !clean) throw new Error(`${field.label} is required for ${category.name}.`);
    if (clean && field.options && !field.options.includes(clean)) {
      throw new Error(`Choose a valid ${field.label} for ${category.name}.`);
    }
    if (clean) normalized[field.key] = clean;
  }
  return normalized;
}

function mapFzrStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (['completed', 'success', 'successful'].includes(normalized)) return 'Completed';
  if (['failed', 'cancelled', 'canceled', 'refunded', 'refund'].includes(normalized)) return 'Failed';
  if (['created', 'processing', 'pending', 'queued', 'in_progress', 'in-progress'].includes(normalized)) return 'Processing';
  return 'Review Required';
}

module.exports = { FZR_CATEGORIES, getCategory, getOfferRestriction, normalizePlayerFields, mapFzrStatus };
