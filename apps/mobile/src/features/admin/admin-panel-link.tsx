import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { AppButton } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { invokeAction } from '@/features/services/supabase-service-repository';

export function AdminPanelLink() {
  const { user, status } = useAuth();
  const capability = useQuery({
    queryKey: ['admin', user?.id, 'session'],
    queryFn: () => invokeAction<{ admin: boolean }>('admin.session', {}),
    enabled: status === 'authenticated',
    retry: false,
    staleTime: 60_000,
  });
  if (capability.data?.admin !== true) return null;
  return (
    <AppButton
      label="Admin Panel"
      icon="shield-checkmark-outline"
      variant="secondary"
      onPress={() => router.push('/admin')}
    />
  );
}
