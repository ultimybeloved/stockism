import TabBar from '../../../../shared/components/TabBar';
import { SHOP_CATEGORIES, type ShopCategory } from '../../utils/shopCatalog';

interface ShopCategoryTabsProps {
  value: ShopCategory;
  counts: Partial<Record<ShopCategory, number>>;
  onChange: (category: ShopCategory) => void;
}

// The shop's category header.
const ShopCategoryTabs = ({ value, counts, onChange }: ShopCategoryTabsProps) => (
  <TabBar
    label="Shop categories"
    className="mx-4 mt-3"
    tabs={SHOP_CATEGORIES.map(([key, label]) => ({ value: key, label, count: counts[key] }))}
    value={value}
    onChange={onChange}
  />
);

export default ShopCategoryTabs;
