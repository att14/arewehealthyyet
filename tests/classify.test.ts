import { describe, expect, it } from 'vitest';
import { classifyFood, classifyAndTrack } from '../src/lib/classify.js';
import { CATEGORY_GROUP, IFSAC_CATEGORIES, labelFor } from '../src/lib/ifsac.js';
import { normalizePathogen, pathogenNamesFrom, pathogenInfo } from '../src/lib/pathogens.js';

describe('IFSAC classification', () => {
  const cases: Array<[string, string]> = [
    ['Iceberg Lettuce', 'Vegetable Row Crops'],
    ['Romaine lettuce, bagged salad kits', 'Vegetable Row Crops'],
    ['Jalapeños', 'Seeded Vegetables'],
    ['Cucumbers', 'Seeded Vegetables'],
    ['Shell Eggs', 'Eggs'],
    ['Requesón/Soft Ricotta Cheese', 'Dairy'],
    ['queso fresco', 'Dairy'],
    ['Alfalfa Sprouts', 'Sprouts'],
    ['Frozen Blueberries', 'Fruits'],
    ['Ground beef', 'Beef'],
    ['Deli meat', 'Other Meat'],
    ['Enoki mushrooms', 'Fungi'],
    ['Fresh basil', 'Herbs'],
    ['Raw oysters', 'Mollusks'],
    ['Peanut butter', 'Nuts-seeds'],
    ['Raw flour', 'Grains-beans'],
    ['Onions', 'Root/Underground'],
    ['Powdered infant formula', 'Other'],
  ];

  for (const [food, expected] of cases) {
    it(`classifies "${food}" as ${expected}`, () => {
      expect(classifyFood(food).foodCategory).toBe(expected);
    });
  }

  it('puts peanut butter under nuts, not dairy', () => {
    // Rule order matters: "butter" alone is Dairy.
    expect(classifyFood('peanut butter').foodCategory).toBe('Nuts-seeds');
    expect(classifyFood('salted butter').foodCategory).toBe('Dairy');
  });

  it('matches whole words only', () => {
    // Regression: substring matching read "cod" inside "product code" as Fish.
    expect(classifyFood('Organic Moringa Powder; Product code: GJ96').foodCategory).not.toBe('Fish');
    expect(classifyFood('Atlantic cod fillets').foodCategory).toBe('Fish');
  });

  it('returns null rather than guessing when the food is unknown', () => {
    for (const unknown of ['Not Yet Identified', 'unknown', 'Under investigation', '', null]) {
      expect(classifyFood(unknown).foodCategory).toBeNull();
    }
  });

  it('assigns a food group to every category it can return', () => {
    for (const category of IFSAC_CATEGORIES) {
      expect(CATEGORY_GROUP[category]).toBeTruthy();
      expect(labelFor(category)).toBeTruthy();
    }
  });

  it('records unmatched text instead of silently guessing', () => {
    const misses = new Set<string>();
    classifyAndTrack('Menopause Bully 16 oz', misses);
    classifyAndTrack('Not Yet Identified', misses);
    expect([...misses]).toEqual(['Menopause Bully 16 oz']);
  });
});

describe('pathogens', () => {
  it('normalizes the many ways agencies name the same germ', () => {
    expect(normalizePathogen('Shiga toxin-producing E. coli (STEC)')).toBe('e-coli');
    expect(normalizePathogen('Salmonella Enteritidis')).toBe('salmonella');
    expect(normalizePathogen('Listeria monocytogenes')).toBe('listeria');
  });

  it('names both germs when a notice covers two', () => {
    expect(pathogenNamesFrom('E. coli and Salmonella')).toBe('E. coli and Salmonella');
    expect(pathogenNamesFrom('E. coli (multiple strains) & Salmonella Agona')).toBe('E. coli and Salmonella');
  });

  it('does not repeat a germ named twice', () => {
    expect(pathogenNamesFrom('Salmonella Typhimurium and Salmonella Newport')).toBe('Salmonella');
  });

  it('falls back to the raw name for something it does not know', () => {
    const info = pathogenInfo('Elevated Lead Levels');
    expect(info.name).toBe('Elevated Lead Levels');
    expect(info.what).toBeTruthy();
  });
});
