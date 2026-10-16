// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MenuShowcase } from '../features/guest/MenuShowcase';
import type { Product } from '../features/guest/ProductDetailModal';

const espresso: Product & { categoryId: string } = {
  _id: 'espresso',
  name: 'Espresso Mây',
  description: 'Espresso đậm đà, hậu chocolate, phù hợp buổi sáng.',
  image: '/espresso.jpg',
  basePrice: 35000,
  categoryId: 'coffee',
  variants: [],
  allowedOptions: { sizes: [], sugarLevels: ['50%'], iceLevels: ['normal-ice'], toppingIds: [] },
  toppingIds: [],
  tags: [],
  isAvailable: true,
};
const coconut = {
  ...espresso,
  _id: 'coconut',
  name: 'Cà phê Dừa',
  description: 'Cà phê Việt kết hợp cốt dừa béo, ít ngọt.',
  image: '/coconut.jpg',
  basePrice: 45000,
};
const categories = [{ _id: 'coffee', name: 'Cà phê' }];
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('guest menu showcase', () => {
  it('previews a different product without ordering, then forwards only the selected product to customization', () => {
    const choose = vi.fn();
    const { container } = render(
      <MenuShowcase products={[espresso, coconut]} categories={categories} onChoose={choose}>
        <h1>Hôm nay uống gì?</h1>
      </MenuShowcase>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Xem món Cà phê Dừa' }));
    expect(screen.getByRole('heading', { name: coconut.name })).toBeTruthy();
    expect(screen.getByText(coconut.description)).toBeTruthy();
    expect(container.querySelector('.menu-backdrop img')?.getAttribute('src')).toBe('/coconut.jpg');
    expect(
      screen.getByRole('button', { name: 'Xem món Cà phê Dừa' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(choose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Chọn món' }));
    expect(choose).toHaveBeenCalledOnce();
    expect(choose).toHaveBeenCalledWith(coconut);
  });
  it('keeps the preview within the filtered catalog and disables navigation for a single remaining product', () => {
    const choose = vi.fn();
    const { rerender } = render(
      <MenuShowcase products={[espresso, coconut]} categories={categories} onChoose={choose}>
        {null}
      </MenuShowcase>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Món tiếp theo' }));
    expect(screen.getByRole('heading', { name: coconut.name })).toBeTruthy();
    rerender(
      <MenuShowcase products={[espresso]} categories={categories} onChoose={choose}>
        {null}
      </MenuShowcase>,
    );
    expect(screen.getByRole('heading', { name: espresso.name })).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Món tiếp theo' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: 'Món trước' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
  it('lets guests inspect an unavailable item but blocks choosing it', () => {
    const choose = vi.fn();
    render(
      <MenuShowcase
        products={[{ ...espresso, isAvailable: false }]}
        categories={categories}
        onChoose={choose}
      >
        {null}
      </MenuShowcase>,
    );
    expect(screen.getByRole('heading', { name: espresso.name })).toBeTruthy();
    const button = screen.getByRole('button', {
      name: /^Tạm hết$/,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(choose).not.toHaveBeenCalled();
  });
});
