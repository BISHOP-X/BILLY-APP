import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, Text } from 'react-native';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { useAuth } from '@/features/auth/auth-provider';
import { invokeAction } from '@/features/services/supabase-service-repository';

export function AdminPanelLink() {
  const theme = useBillyTheme();
  const color = theme.dark ? theme.colors.accent : theme.colors.brandDeep;
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Admin Panel"
      onPress={() => router.push('/admin')}
      style={{
        alignSelf: 'flex-end',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minHeight: 44,
        paddingHorizontal: 12,
      }}
    >
      <Ionicons name="options-outline" size={16} color={color} />
      <Text style={{ color, fontSize: 13, fontWeight: '600' }}>
        Admin Panel
      </Text>
      <Ionicons name="arrow-forward" size={16} color={color} />
    </Pressable>
  );
}
