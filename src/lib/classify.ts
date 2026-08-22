import { CATEGORY_GROUP, type FoodGroup, type IfsacCategory } from './ifsac.js';

/**
 * Ordered keyword table: first match wins, so specific phrases must precede general ones
 * ("peanut butter" before "butter", "chicken salad" before "salad").
 * Unmatched text yields null — we log it rather than guessing a category.
 */
const RULES: Array<[IfsacCategory, string[]]> = [
  ['Nuts-seeds', ['trail mix', 'peanut butter', 'almond butter', 'nut butter', 'tahini', 'peanut', 'almond', 'cashew', 'pistachio', 'walnut', 'pecan', 'macadamia', 'sesame', 'sunflower seed', 'pine nut', 'nut ', 'nuts', 'seed butter']],
  ['Sprouts', ['sprout', 'alfalfa']],
  ['Fungi', ['mushroom', 'enoki', 'morel', 'wood ear', 'fungi']],
  ['Herbs', ['basil', 'cilantro', 'parsley', 'mint', 'herb']],
  ['Dairy', ['lassi', 'queso fresco', 'cotija', 'brie', 'camembert', 'cheese', 'milk', 'yogurt', 'ice cream', 'butter', 'cream', 'dairy', 'kefir']],
  ['Eggs', ['egg']],
  ['Chicken', ['chicken', 'poulet']],
  ['Turkey', ['turkey']],
  ['Other Poultry', ['duck', 'quail', 'goose', 'poultry']],
  ['Beef', ['ground beef', 'beef', 'steak', 'veal', 'hamburger', 'burger patt']],
  ['Pork', ['pork', 'bacon', 'ham ', 'sausage', 'charcuterie', 'salami', 'prosciutto', 'carnitas', 'chorizo']],
  ['Game', ['venison', 'deer', 'bear meat', 'elk', 'bison', 'game meat']],
  ['Other Meat', ['lamb', 'goat meat', 'deli meat', 'lunch meat', 'meat']],
  ['Mollusks', ['oyster', 'clam', 'mussel', 'scallop']],
  ['Crustaceans', ['shrimp', 'crab', 'lobster', 'crawfish', 'prawn']],
  ['Fish', ['salmon', 'tuna', 'tilapia', 'cod', 'trout', 'halibut', 'sardine', 'anchovy', 'fish']],
  ['Other Aquatic Animals', ['seaweed', 'frog leg', 'octopus', 'squid', 'calamari', 'eel', 'seafood']],
  ['Vegetable Row Crops', ['romaine', 'lettuce', 'spinach', 'kale', 'arugula', 'leafy green', 'salad', 'cabbage', 'celery', 'broccoli', 'cauliflower', 'brussels sprout', 'greens']],
  ['Seeded Vegetables', ['cucumber', 'tomato', 'pepper', 'squash', 'zucchini', 'eggplant', 'jalapeno']],
  ['Root/Underground', ['onion', 'potato', 'carrot', 'garlic', 'beet', 'radish', 'turnip', 'ginger', 'yam', 'leek', 'scallion', 'green onion']],
  ['Fruits', ['cantaloupe', 'melon', 'strawberry', 'blueberry', 'raspberry', 'blackberry', 'berry', 'apple', 'peach', 'nectarine', 'plum', 'mango', 'papaya', 'pineapple', 'grape', 'orange', 'lemon', 'lime', 'banana', 'pear', 'cherry', 'avocado', 'coconut', 'date', 'fig', 'fruit', 'juice']],
  ['Grains-beans', ['flour', 'bread', 'cereal', 'oat', 'rice', 'pasta', 'noodle', 'tortilla', 'cookie dough', 'dough', 'grain', 'bean', 'lentil', 'chickpea', 'hummus', 'tofu', 'soy', 'quinoa', 'corn meal', 'cornmeal', 'granola', 'wrapper', 'chips', 'cracker', 'pretzel', 'muffin', 'pastry', 'cake', 'corn']],
  ['Oils-sugars', ['olive oil', 'oil', 'honey', 'syrup', 'sugar', 'chocolate', 'candy', 'frosting']],
  ['Multiple', ['multiple food', 'various food', 'several food', 'assorted']],
  ['Other', ['seasoning', 'spice blend', 'curry powder', 'coffee', 'cold brew', 'tea ', 'beverage', 'drink', 'capsule', 'tablet', 'gummy', 'spray', 'supplement', 'infant formula', 'baby food', 'pet food', 'ice ', 'water', 'protein shake', 'prepared meal', 'frozen meal', 'sandwich', 'burrito', 'pizza', 'soup', 'dip', 'salsa', 'guacamole']],
];

const UNKNOWN_PHRASES = [
  'unknown', 'not identified', 'not yet identified', 'under investigation',
  'tbd', 'pending', 'n/a', 'none', 'undetermined', '',
];

/**
 * Keywords match whole words only. Plain substring matching classifies "product code: GJ96"
 * as Fish, because "cod" appears inside "code" — the kind of error nobody notices until a
 * recall is filed under the wrong food.
 */
const MATCHERS = new Map<string, RegExp>();
function matcher(keyword: string): RegExp {
  const cached = MATCHERS.get(keyword);
  if (cached) return cached;
  const trimmed = keyword.trim();
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Plural tolerance so "onion" matches "onions" and "blueberry" matches "blueberries",
  // without letting "ice" match "iceberg".
  const plural = trimmed.endsWith('y') ? `${escaped.slice(0, -1)}(?:y|ies)` : `${escaped}(?:s|es)?`;
  const re = new RegExp(`\\b${plural}\\b`, 'i');
  MATCHERS.set(keyword, re);
  return re;
}

export interface Classification {
  foodCategory: IfsacCategory | null;
  foodGroup: FoodGroup | null;
}

/** Accents are dropped so "Jalapeños" and "Requesón" match plain ASCII keywords. */
function normalizeText(raw: string | null | undefined): string {
  return (raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function classifyFood(raw: string | null | undefined): Classification {
  const text = normalizeText(raw);
  if (!text || UNKNOWN_PHRASES.includes(text)) {
    return { foodCategory: null, foodGroup: null };
  }
  for (const [category, keywords] of RULES) {
    if (keywords.some((k) => matcher(k).test(text))) {
      return { foodCategory: category, foodGroup: CATEGORY_GROUP[category] };
    }
  }
  return { foodCategory: null, foodGroup: null };
}

/** Collects text the keyword table missed so the table can be extended deliberately. */
export function classifyAndTrack(raw: string | null | undefined, misses: Set<string>): Classification {
  const result = classifyFood(raw);
  const text = (raw ?? '').trim();
  if (!result.foodCategory && text && !UNKNOWN_PHRASES.includes(text.toLowerCase())) {
    misses.add(text);
  }
  return result;
}
