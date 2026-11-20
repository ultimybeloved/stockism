import TabBar from '../../../../shared/components/TabBar';
import { SHOP_CATEGORIES, type ShopCategory } from '../../utils/shopCatalog';

interface ShopCategoryTabsProps {
  value: ShopCategory;
  counts: Partial<Record<ShopCategory, number>>;
  /** Whether a category holds new items the player hasn't opened yet. */
  isNew: (category: ShopCategory) => boolean;
  onChange: (category: ShopCategory) => void;
}

// The shop's category header. Categories with new items carry a NEW! tag.
const ShopCategoryTabs = ({ value, counts, isNew, onChange }: ShopCategoryTabsProps) => (
  <TabBar
    label="Shop categories"
    className="mx-4 mt-3"
    tabs={SHOP_CATEGORIES.map(([key, label]) => ({ value: key, label, count: counts[key], isNew: isNew(key) }))}
    value={value}
    onChange={onChange}
  />
);

export default ShopCategoryTabs;
