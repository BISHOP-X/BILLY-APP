import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-provider';

import type {
  ActivityCursor,
  ActivityPage,
  DashboardSnapshot,
} from './domain';
import {
  billyDataSource,
  billyDemoScenario,
  isBillyDevDemo,
  billyMainRepository,
} from './repository';

const keys = {
  activity: (userId: string) =>
    ['main', billyDataSource, billyDemoScenario, userId, 'activity'] as const,
  dashboard: (userId: string) =>
    ['main', billyDataSource, billyDemoScenario, userId, 'dashboard'] as const,
  notifications: (userId: string) =>
    ['main', billyDataSource, billyDemoScenario, userId, 'notifications'] as const,
  transaction: (userId: string, id: string) =>
    ['main', billyDataSource, billyDemoScenario, userId, 'transaction', id] as const,
};

export function useDashboardQuery() {
  const { user } = useAuth();
  const userId = isBillyDevDemo ? 'demo-reviewer' : (user?.id ?? 'signed-out');

  return useQuery({
    enabled: isBillyDevDemo || Boolean(user),
    queryFn: () => billyMainRepository.getDashboard(),
    queryKey: keys.dashboard(userId),
  });
}

export function useActivityQuery() {
  const { user } = useAuth();
  const userId = isBillyDevDemo ? 'demo-reviewer' : (user?.id ?? 'signed-out');

  return useInfiniteQuery<
    ActivityPage,
    Error,
    InfiniteData<ActivityPage>,
    ReturnType<typeof keys.activity>,
    ActivityCursor | null
  >({
    enabled: isBillyDevDemo || Boolean(user),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null,
    queryFn: ({ pageParam }) =>
      billyMainRepository.getActivityPage(pageParam),
    queryKey: keys.activity(userId),
  });
}

export function useTransactionQuery(id: string) {
  const { user } = useAuth();
  const userId = isBillyDevDemo ? 'demo-reviewer' : (user?.id ?? 'signed-out');

  return useQuery({
    enabled: Boolean(id) && (isBillyDevDemo || Boolean(user)),
    queryFn: () => billyMainRepository.getTransaction(id),
    queryKey: keys.transaction(userId, id),
  });
}

export function useNotificationsQuery() {
  const { user } = useAuth();
  const userId = isBillyDevDemo ? 'demo-reviewer' : (user?.id ?? 'signed-out');

  return useQuery({
    enabled: isBillyDevDemo || Boolean(user),
    queryFn: () => billyMainRepository.getNotifications(),
    queryKey: keys.notifications(userId),
  });
}

export function useMarkNotificationRead() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = isBillyDevDemo ? 'demo-reviewer' : (user?.id ?? 'signed-out');

  return useMutation({
    mutationFn: (id: string) => billyMainRepository.markNotificationRead(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.notifications(userId) }),
        queryClient.invalidateQueries({ queryKey: keys.dashboard(userId) }),
      ]);
    },
  });
}

export function useSetHideBalance() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = isBillyDevDemo ? 'demo-reviewer' : (user?.id ?? 'signed-out');
  const queryKey = keys.dashboard(userId);

  return useMutation<void, Error, boolean, { previous?: DashboardSnapshot }>({
    mutationFn: (hidden: boolean) => billyMainRepository.setHideBalance(hidden),
    onError: (_error, _hidden, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onMutate: async (hidden) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<DashboardSnapshot>(queryKey);
      if (previous?.wallet) {
        queryClient.setQueryData<DashboardSnapshot>(queryKey, {
          ...previous,
          wallet: {
            ...previous.wallet,
            hideBalance: hidden,
          },
        });
      }
      return { previous };
    },
  });
}
