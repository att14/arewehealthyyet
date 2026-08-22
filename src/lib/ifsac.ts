/**
 * IFSAC food categories — the tri-agency (CDC/FDA/USDA) scheme CDC uses in NORS.
 *
 * The leaf values below are the exact distinct values in the NORS dataset, taken from
 *   data.cdc.gov/resource/5xkq-dg7x.json?$select=distinct ifsac_category
 * rather than transcribed from a PDF, so our categories line up with the official
 * historical data instead of being invented.
 */

export const FOOD_GROUPS = ['Land Animals', 'Aquatic Animals', 'Plants', 'Other'] as const;
export type FoodGroup = (typeof FOOD_GROUPS)[number];

export const IFSAC_CATEGORIES = [
  'Beef', 'Pork', 'Chicken', 'Turkey', 'Other Meat', 'Other Poultry', 'Game', 'Dairy', 'Eggs',
  'Fish', 'Mollusks', 'Crustaceans', 'Other Aquatic Animals',
  'Fruits', 'Vegetable Row Crops', 'Seeded Vegetables', 'Root/Underground', 'Sprouts',
  'Herbs', 'Fungi', 'Grains-beans', 'Nuts-seeds', 'Oils-sugars',
  'Multiple', 'Other',
] as const;
export type IfsacCategory = (typeof IFSAC_CATEGORIES)[number];

export const CATEGORY_GROUP: Record<IfsacCategory, FoodGroup> = {
  Beef: 'Land Animals', Pork: 'Land Animals', Chicken: 'Land Animals', Turkey: 'Land Animals',
  'Other Meat': 'Land Animals', 'Other Poultry': 'Land Animals', Game: 'Land Animals',
  Dairy: 'Land Animals', Eggs: 'Land Animals',
  Fish: 'Aquatic Animals', Mollusks: 'Aquatic Animals', Crustaceans: 'Aquatic Animals',
  'Other Aquatic Animals': 'Aquatic Animals',
  Fruits: 'Plants', 'Vegetable Row Crops': 'Plants', 'Seeded Vegetables': 'Plants',
  'Root/Underground': 'Plants', Sprouts: 'Plants', Herbs: 'Plants', Fungi: 'Plants',
  'Grains-beans': 'Plants', 'Nuts-seeds': 'Plants', 'Oils-sugars': 'Plants',
  Multiple: 'Other', Other: 'Other',
};

/** What the category is called on the page — words someone already uses at the grocery store. */
export const CATEGORY_LABEL: Record<IfsacCategory, string> = {
  Beef: 'Beef', Pork: 'Pork', Chicken: 'Chicken', Turkey: 'Turkey',
  'Other Meat': 'Other meat (lamb, goat, deli meat)',
  'Other Poultry': 'Other poultry (duck, quail)',
  Game: 'Game meat',
  Dairy: 'Milk & cheese',
  Eggs: 'Eggs',
  Fish: 'Fish',
  Mollusks: 'Oysters, clams & mussels',
  Crustaceans: 'Shrimp, crab & lobster',
  'Other Aquatic Animals': 'Other seafood',
  Fruits: 'Fruit',
  'Vegetable Row Crops': 'Leafy greens & salad vegetables',
  'Seeded Vegetables': 'Tomatoes, cucumbers & peppers',
  'Root/Underground': 'Onions, potatoes & root vegetables',
  Sprouts: 'Sprouts',
  Herbs: 'Fresh herbs',
  Fungi: 'Mushrooms',
  'Grains-beans': 'Grains, flour & beans',
  'Nuts-seeds': 'Nuts, seeds & nut butters',
  'Oils-sugars': 'Oils, sugars & sweets',
  Multiple: 'Several different foods',
  Other: 'Other prepared foods',
};

export function groupFor(category: IfsacCategory | null): FoodGroup | null {
  return category ? CATEGORY_GROUP[category] : null;
}

export function labelFor(category: IfsacCategory | null): string {
  return category ? CATEGORY_LABEL[category] : 'Food not identified yet';
}
