import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { TeamSupportProductOption, TicketOptionsResponse } from "../api/types";
import { SearchablePicker } from "./SearchablePicker";

export interface TicketChoices {
  productId?: string;
  nature?: string;
  groupId?: string;
  ticketTypeId?: string;
}

// The step between clicking "Create TeamSupport ticket" and the ticket actually being created:
// shows where the ticket will go (the group), and lets the person pick its Product and Nature.
// Both are optional. Create is the confirmation, so there's no separate "are you sure" prompt.
export function TicketOptionsPanel({
  pending,
  onCreate,
  onCancel,
}: {
  pending: boolean;
  onCreate: (choices: TicketChoices) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  // Products are all of TeamSupport's (~830, one call) and the server keeps them for hours, so
  // this is cheap to open repeatedly; it fails quietly and the panel still lets you create a
  // ticket without a product.
  const { data, isLoading, isError } = useQuery({
    queryKey: ["teamsupport-ticket-options"],
    queryFn: () => api.get<TicketOptionsResponse>("/teamsupport-ticket-options"),
    retry: false,
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
  const [product, setProduct] = useState<TeamSupportProductOption | null>(null);
  const [nature, setNature] = useState("");
  const [groupId, setGroupId] = useState("");
  const [ticketTypeId, setTicketTypeId] = useState("");

  const products = data?.products ?? [];

  return (
    <div className="card" style={{ marginTop: 8, maxWidth: 520 }}>
      <div className="section-title">{t("ticketOptions.title")}</div>

      {data?.routing && (
        <>
          <div className="field">
            <label>{t("ticketOptions.group")}</label>
            <div>{data.routing.groupName}</div>
          </div>
          <div className="field">
            <label>{t("ticketOptions.ticketType")}</label>
            <div>{data.routing.typeName}</div>
          </div>
        </>
      )}
      {data && !data.routing && (
        <>
          <div className="field">
            <label>
              {t("ticketOptions.group")} <span className="required-marker">{t("taskDetail.requiredMarker")}</span>
            </label>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} style={{ maxWidth: 420 }}>
              <option value="">{t("ticketOptions.chooseGroup")}</option>
              {data.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>
              {t("ticketOptions.ticketType")} <span className="required-marker">{t("taskDetail.requiredMarker")}</span>
            </label>
            <select value={ticketTypeId} onChange={(e) => setTicketTypeId(e.target.value)} style={{ maxWidth: 420 }}>
              <option value="">{t("ticketOptions.chooseType")}</option>
              {data.ticketTypes.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      <div className="field">
        <label>{t("ticketOptions.product")}</label>
        <SearchablePicker
          items={products}
          browseItems={products.filter((p) => p.preferred)}
          value={product}
          onChange={(p) => setProduct(p ? (products.find((x) => x.id === p.id) ?? null) : null)}
          width={420}
          isLoading={isLoading}
          isError={isError}
          labels={{
            placeholder: t("ticketOptions.productPlaceholder"),
            loading: t("ticketOptions.loading"),
            unavailable: t("ticketOptions.unavailable"),
            clear: t("ticketOptions.clearProduct"),
            noMatches: t("ticketOptions.noProductMatches"),
            typeToSearch: t("ticketOptions.typeToSearchProducts"),
          }}
        />
      </div>

      <div className="field">
        <label>{t("ticketOptions.nature")}</label>
        <select value={nature} onChange={(e) => setNature(e.target.value)} style={{ maxWidth: 420 }}>
          <option value="">{t("ticketOptions.natureNone")}</option>
          {(data?.natures ?? []).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <div className="gap-8">
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || (!!data && !data.routing && (!groupId || !ticketTypeId))}
          onClick={() =>
            onCreate({
              productId: product?.id,
              nature: nature || undefined,
              groupId: data && !data.routing ? groupId : undefined,
              ticketTypeId: data && !data.routing ? ticketTypeId : undefined,
            })
          }
        >
          {pending ? t("projectDetail.creatingTeamSupportTicket") : t("projectDetail.createTeamSupportTicket")}
        </button>
        <button type="button" className="btn" disabled={pending} onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
