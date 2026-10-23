import { render, screen } from '@testing-library/react-native';
import { CatalogSelect } from '@/features/social-boost/catalog-select';

test('refreshing opaque service tokens does not erase the selected service label', async () => {
  await render(<CatalogSelect label="Service" placeholder="Choose a service" value="old-token" selectedLabel="Stable Followers" options={[{ value: 'fresh-token', label: 'Stable Followers' }]} onSelect={jest.fn()} />);
  expect(screen.getByLabelText('Service: Stable Followers')).toBeTruthy();
  expect(screen.queryByText('Choose a service')).toBeNull();
});

test('loading selectors expose their actual disabled state to assistive technology', async () => {
  await render(<CatalogSelect label="Category" placeholder="Choose a category" value="" options={[]} loading onSelect={jest.fn()} />);
  expect(screen.getByLabelText('Category: Choose a category')).toBeDisabled();
});
