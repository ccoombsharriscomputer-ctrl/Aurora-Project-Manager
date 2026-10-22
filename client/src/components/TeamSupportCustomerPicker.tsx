import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { TeamSupportCustomer } from "../api/types";
import { SearchablePicker } from "./SearchablePicker";

// Searchable picker over TeamSupport's customer list. Picking one stores its ID and name on the
// project.
export function TeamSupportCustomerPicker({
  value,
  onChange,
  disabled,
  width,
}: {
  value: TeamSupportCustomer | null;
  onChange: (customer: TeamSupportCustomer | null) => void;
  disabled?: boolean;
  width?: number;
}) {
  const { t } = useTranslation();
  // Not every deployment has TeamSupport configured, and the list is ~4,000 customers read in
  // several API calls — so it fails quietly, and is kept for an hour (the server also caches it).
  const { data: customers, isLoading, isError } = useQuery({
    queryKey: ["teamsupport-customers"],
    queryFn: () => api.get<TeamSupportCustomer[]>("/teamsupport-customers"),
    retry: false,
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });

  return (
    <SearchablePicker
      items={customers ?? []}
      value={value}
      onChange={onChange}
      disabled={disabled}
      width={width}
      isLoading={isLoading}
      isError={isError}
      labels={{
        placeholder: t("customerPicker.placeholder"),
        loading: t("customerPicker.loading"),
        unavailable: t("customerPicker.unavailable"),
        clear: t("customerPicker.clear"),
        noMatches: t("customerPicker.noMatches"),
        typeToSearch: t("customerPicker.typeToSearch"),
      }}
    />
  );
}
