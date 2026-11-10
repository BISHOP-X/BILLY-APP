import { useLocalSearchParams } from 'expo-router';
import { AppScreen } from '@/components/layout/app-screen';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StatePanel } from '@/components/ui/state-panel';
import { CommerceScreen } from '@/features/commerce/commerce-screen';

export default function BillCategoryScreen() {
  const { category } = useLocalSearchParams<{ category?: string }>();
  if (category === 'airtime' || category === 'data' || category === 'electricity') {
    return <CommerceScreen kind={category} />;
  }
  return <AppScreen bottomSafe><ScreenHeader title="Pay bills" />
    <StatePanel icon="search-outline" title="Choose a supported service" message="Billy offers airtime, data and electricity." />
  </AppScreen>;
}
