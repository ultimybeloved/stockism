// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
import ShopSearchResults from './ShopSearchResults';
import { COSMETICS } from '../../../../constants/cosmetics';
import type { ShopEntry } from '../../utils/shopCatalog';
expect.extend(matchers);

vi.mock('./ShopItemCard', () => ({
  default: ({ cosmetic }: { cosmetic: { name: string } }) => <p>{cosmetic.name}</p>,
}));
vi.mock('./ProfileShopShelf', () => ({ PhoneWarning: () => <p>Desktop only.</p> }));

const entry = (type: string): ShopEntry =>
  ({
    kind: 'cosmetic',
    item: COSMETICS.find((c) => c.type === type && !c.earned)!,
  }) as ShopEntry;

const renderWith = (results: ShopEntry[]) =>
  render(
    <ShopSearchResults
      results={results}
      selectedIds={new Set()}
      selectedPinId={null}
      owned={new Set()}
      salePriceOf={() => undefined}
      style={{}}
      onStyle={() => {}}
      onPick={() => {}}
    />,
  );

describe('ShopSearchResults', () => {
  afterEach(cleanup);

  it('warns that backgrounds are desktop only when one is in the results', () => {
    renderWith([entry('nameColor'), entry('profileBg')]);
    expect(screen.getByText('Desktop only.')).toBeInTheDocument();
  });

  it('shows no warning without a background', () => {
    renderWith([entry('nameColor')]);
    expect(screen.queryByText('Desktop only.')).not.toBeInTheDocument();
  });
});
