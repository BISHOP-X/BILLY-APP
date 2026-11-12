import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import { AdminButton, AdminInput, AdminText, Badge, Panel } from "./components";
import { invokeAction } from "@/features/services/supabase-service-repository";

type Routing = {
  primary_provider: "pvadeals" | "getatext" | "off";
  version: number;
};
export function SmsRoutingControl() {
  const qc = useQueryClient(),
    [reason, setReason] = useState(""),
    [message, setMessage] = useState("");
  const query = useQuery({
    queryKey: ["admin", "sms-routing"],
    queryFn: () => invokeAction<Routing>("admin.sms.read", {}),
  });
  const save = useMutation({
    mutationFn: (provider: Routing["primary_provider"]) =>
      invokeAction<Routing>("admin.sms.change", {
        provider,
        version: query.data?.version,
        reason,
      }),
    retry: false,
    onSuccess: async () => {
      setReason("");
      setMessage(
        "Provider updated. Existing rentals stay with their original provider.",
      );
      await Promise.all([
        query.refetch(),
        qc.invalidateQueries({ queryKey: ["numbers"] }),
      ]);
    },
  });
  return (
    <Panel>
      <AdminText large>SMS provider</AdminText>
      <AdminText muted>
        PVA is the main catalogue. Switch to GetAText for US short rentals when
        needed. US and Canada long-term rentals are reserved for SMSBUS; its
        connection is still pending.
      </AdminText>
      {query.data
        ? (
          <Badge
            value={query.data.primary_provider === "pvadeals"
              ? "PVA active"
              : query.data.primary_provider === "getatext"
              ? "GetAText active"
              : "New purchases off"}
          />
        )
        : null}
      <AdminInput
        label="Reason for change"
        value={reason}
        onChangeText={setReason}
      />
      <View style={{ gap: 10 }}>
        {([{ key: "pvadeals", label: "Use PVA" }, {
          key: "getatext",
          label: "Use GetAText backup",
        }, { key: "off", label: "Pause new SMS purchases" }] as const).map(
          (p) => (
            <AdminButton
              key={p.key}
              label={p.label}
              secondary
              disabled={save.isPending || !query.data ||
                query.data.primary_provider === p.key ||
                reason.trim().length < 5}
              onPress={() => save.mutate(p.key)}
            />
          ),
        )}
      </View>
      {message || query.error || save.error
        ? (
          <AdminText>
            {save.error?.message ?? query.error?.message ?? message}
          </AdminText>
        )
        : null}
      <AdminText muted>
        Rate and markup use the US numbers pricing control below. Switching does
        not cancel existing orders or issue refunds.
      </AdminText>
    </Panel>
  );
}
