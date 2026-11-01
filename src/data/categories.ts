import { isValidDate, nowIso, today, type LocalDate } from '../domain/dates';
import { fail } from '../domain/errors';
import type { Category, CategoryKind, CategoryNature } from '../domain/types';
import { newId } from './ids';
import type { Db } from './sql';

type Seed = { key: string; kind: CategoryKind; icon: string; color: string; nature?: CategoryNature };

/** Stored names are the Arabic defaults; the UI translates seeded categories by key. */
const SEEDS: (Seed & { name: string })[] = [
  { key: 'salary', name: 'الراتب', kind: 'income', icon: 'cash-outline', color: '#2E7D5B' },
  { key: 'freelance', name: 'عمل حر', kind: 'income', icon: 'laptop-outline', color: '#3B7EA1' },
  { key: 'business', name: 'دخل تجاري', kind: 'income', icon: 'briefcase-outline', color: '#6B6BB0' },
  { key: 'gifts_received', name: 'هدايا مستلمة', kind: 'income', icon: 'gift-outline', color: '#B0668F' },
  { key: 'other_income', name: 'دخل آخر', kind: 'income', icon: 'add-circle-outline', color: '#7A8691' },
  { key: 'housing', name: 'السكن', kind: 'expense', icon: 'home-outline', color: '#3B7EA1', nature: 'essential' },
  { key: 'food', name: 'الطعام', kind: 'expense', icon: 'fast-food-outline', color: '#C77D2E', nature: 'essential' },
  { key: 'groceries', name: 'البقالة', kind: 'expense', icon: 'basket-outline', color: '#5E9A4B', nature: 'essential' },
  { key: 'restaurants', name: 'المطاعم', kind: 'expense', icon: 'restaurant-outline', color: '#C2573F', nature: 'discretionary' },
  { key: 'transport', name: 'المواصلات', kind: 'expense', icon: 'bus-outline', color: '#4B7FBF', nature: 'essential' },
  { key: 'fuel', name: 'الوقود', kind: 'expense', icon: 'car-outline', color: '#8A6D3B', nature: 'essential' },
  { key: 'utilities', name: 'الماء والكهرباء', kind: 'expense', icon: 'flash-outline', color: '#C9A227', nature: 'essential' },
  { key: 'internet_phone', name: 'الإنترنت والهاتف', kind: 'expense', icon: 'wifi-outline', color: '#2F8F9D', nature: 'essential' },
  { key: 'health', name: 'الصحة', kind: 'expense', icon: 'medkit-outline', color: '#C2453F', nature: 'essential' },
  { key: 'clothing', name: 'الملابس', kind: 'expense', icon: 'shirt-outline', color: '#9A5FB0', nature: 'discretionary' },
  { key: 'shopping', name: 'التسوق', kind: 'expense', icon: 'bag-handle-outline', color: '#B0668F', nature: 'discretionary' },
  { key: 'family', name: 'العائلة', kind: 'expense', icon: 'people-outline', color: '#5F7DB0', nature: 'essential' },
  { key: 'education', name: 'التعليم', kind: 'expense', icon: 'school-outline', color: '#3F8F6F', nature: 'essential' },
  { key: 'entertainment', name: 'الترفيه', kind: 'expense', icon: 'film-outline', color: '#7D5FB0', nature: 'discretionary' },
  { key: 'subscriptions', name: 'الاشتراكات', kind: 'expense', icon: 'repeat-outline', color: '#5B6FB5', nature: 'discretionary' },
  { key: 'travel', name: 'السفر', kind: 'expense', icon: 'airplane-outline', color: '#2E8FB5', nature: 'discretionary' },
  { key: 'gifts', name: 'الهدايا', kind: 'expense', icon: 'gift-outline', color: '#C2577F', nature: 'discretionary' },
  { key: 'fees', name: 'الرسوم', kind: 'expense', icon: 'receipt-outline', color: '#7A7A5F', nature: 'essential' },
  { key: 'other_expense', name: 'مصاريف أخرى', kind: 'expense', icon: 'ellipsis-horizontal-circle-outline', color: '#7A8691' },
];

export async function seedDefaultCategories(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    const time = nowIso();
    let order = 0;
    for (const seed of SEEDS) {
      order += 1;
      await tx.run(
        `INSERT OR IGNORE INTO categories (id, key, name, kind, icon, color, nature, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [`cat_${seed.key}`, seed.key, seed.name, seed.kind, seed.icon, seed.color, seed.nature ?? null, order, time, time],
      );
    }
  });
}

type Row = {
  id: string;
  key: string | null;
  name: string;
  kind: CategoryKind;
  icon: string;
  color: string;
  nature: CategoryNature | null;
  archived_at: string | null;
  parent_id: string | null;
  expires_on: string | null;
};

const toCategory = (r: Row): Category => ({
  id: r.id,
  key: r.key,
  name: r.name,
  kind: r.kind,
  icon: r.icon,
  color: r.color,
  nature: r.nature,
  archivedAt: r.archived_at,
  parentId: r.parent_id,
  expiresOn: r.expires_on,
});

const COLUMNS = 'id, key, name, kind, icon, color, nature, archived_at, parent_id, expires_on';

export type CategoryQuery = {
  kind?: CategoryKind;
  includeArchived?: boolean;
  /** Only what should be offered when recording today: hides expired temporary categories. */
  pickable?: boolean;
};

export async function listCategories(db: Db, options: CategoryQuery = {}): Promise<Category[]> {
  const rows = await db.all<Row>(
    `SELECT ${COLUMNS} FROM categories
     WHERE (? IS NULL OR kind = ?) AND (? = 1 OR archived_at IS NULL)
       AND (? = 0 OR expires_on IS NULL OR expires_on >= ?)
     ORDER BY sort_order, name`,
    [options.kind ?? null, options.kind ?? null, options.includeArchived ? 1 : 0, options.pickable ? 1 : 0, today()],
  );
  return rows.map(toCategory);
}

export type CategoryInput = {
  name: string;
  kind: CategoryKind;
  icon: string;
  color: string;
  nature: CategoryNature | null;
  parentId?: string | null;
  expiresOn?: LocalDate | null;
};

/** One level only: a two-tap choice is the most a category should ever cost. */
async function assertParent(tx: Db, id: string | null, input: CategoryInput): Promise<void> {
  if (!input.parentId) return;
  if (input.parentId === id) fail('category_parent_invalid');
  const parent = await tx.get<Row>(`SELECT ${COLUMNS} FROM categories WHERE id = ?`, [input.parentId]);
  if (!parent || parent.parent_id || parent.kind !== input.kind) fail('category_parent_invalid');
  if (id && (await tx.get('SELECT 1 FROM categories WHERE parent_id = ? LIMIT 1', [id]))) fail('category_parent_invalid');
}

export async function saveCategory(db: Db, id: string | null, input: CategoryInput): Promise<string> {
  const name = input.name.trim();
  if (!name) fail('invalid_name');
  if (input.expiresOn && !isValidDate(input.expiresOn)) fail('invalid_date');
  return db.transaction(async (tx) => {
    const time = nowIso();
    await assertParent(tx, id, input);
    const parentId = input.parentId ?? null;
    const expiresOn = input.expiresOn ?? null;
    if (id) {
      const existing = await tx.get<Row>('SELECT * FROM categories WHERE id = ?', [id]);
      if (!existing) fail('not_found');
      if (existing.kind !== input.kind) {
        const used = await tx.get('SELECT 1 FROM transactions WHERE category_id = ? LIMIT 1', [id]);
        if (used) fail('category_kind_mismatch');
      }
      // A renamed seed stops following translations, because the person chose this name.
      const key = existing.name === name ? existing.key : null;
      await tx.run(
        'UPDATE categories SET key = ?, name = ?, kind = ?, icon = ?, color = ?, nature = ?, parent_id = ?, expires_on = ?, updated_at = ? WHERE id = ?',
        [key, name, input.kind, input.icon, input.color, input.nature, parentId, expiresOn, time, id],
      );
      return id;
    }
    const created = newId();
    const order = await tx.get<{ next: number }>('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM categories');
    await tx.run(
      `INSERT INTO categories (id, name, kind, icon, color, nature, parent_id, expires_on, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [created, name, input.kind, input.icon, input.color, input.nature, parentId, expiresOn, order?.next ?? 1, time, time],
    );
    return created;
  });
}

/** Archived categories leave the pickers; past transactions keep their label. */
export async function setCategoryArchived(db: Db, id: string, archived: boolean): Promise<void> {
  await db.run('UPDATE categories SET archived_at = ?, updated_at = ? WHERE id = ?', [archived ? nowIso() : null, nowIso(), id]);
}

/** Only an unused category can really be deleted. Anything else would rewrite history, so it is archived instead. */
export async function deleteCategory(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const used = await tx.get(
      `SELECT 1 FROM transactions WHERE category_id = ?
       UNION ALL SELECT 1 FROM recurring_rules WHERE category_id = ?
       UNION ALL SELECT 1 FROM budgets WHERE category_id = ?
       UNION ALL SELECT 1 FROM templates WHERE category_id = ?
       UNION ALL SELECT 1 FROM categories WHERE parent_id = ? LIMIT 1`,
      [id, id, id, id, id],
    );
    if (used) fail('category_in_use');
    await tx.run('DELETE FROM categories WHERE id = ?', [id]);
  });
}

/** Swaps with the neighbour in display order, among siblings of the same kind. */
export async function moveCategory(db: Db, id: string, direction: 'up' | 'down'): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await tx.get<{ kind: string; sort_order: number; parent_id: string | null }>('SELECT kind, sort_order, parent_id FROM categories WHERE id = ?', [id]);
    if (!current) fail('not_found');
    const neighbour = await tx.get<{ id: string; sort_order: number }>(
      `SELECT id, sort_order FROM categories
       WHERE kind = ? AND parent_id IS ? AND archived_at IS NULL AND sort_order ${direction === 'up' ? '<' : '>'} ?
       ORDER BY sort_order ${direction === 'up' ? 'DESC' : 'ASC'} LIMIT 1`,
      [current.kind, current.parent_id, current.sort_order],
    );
    if (!neighbour) return;
    await tx.run('UPDATE categories SET sort_order = ? WHERE id = ?', [neighbour.sort_order, id]);
    await tx.run('UPDATE categories SET sort_order = ? WHERE id = ?', [current.sort_order, neighbour.id]);
  });
}
